import crypto from "node:crypto";

/**
 * Activation tokens.
 *
 * The token is what actually unlocks the app. It is an Ed25519 signature over
 * a small JSON payload, formatted as `base64url(payload).base64url(signature)`
 * -- the same shape the desktop app already knew how to parse.
 *
 * The whole point is that verification needs no network: the app holds the
 * public key, so after a single online activation it can check the token
 * locally forever. The private key exists only here, in a Vercel env var, so
 * an attacker who redirects api.ausculta.site to their own machine still
 * cannot mint a token the app will accept.
 */

/** Bumped only on a breaking payload change; old clients reject unknown versions. */
export const TOKEN_VERSION = 1;

/**
 * How far ahead subscription tokens are issued. A revoked subscription stops
 * working within this window at worst, and the client silently renews well
 * before it lapses. Perpetual tokens ignore this entirely (exp = null).
 */
export const SUBSCRIPTION_TOKEN_DAYS = 30;

export type TokenPayload = {
  /** Payload format version. */
  v: number;
  /** License row id. */
  lic: string;
  /** Device fingerprint this token is bound to. */
  fp: string;
  /** 'perpetual' | 'subscription' */
  plan: string;
  /** Unix seconds. */
  iat: number;
  /** Unix seconds, or null for a token that never expires. */
  exp: number | null;
  /** Future ERP module flags. */
  feat: string[];
};

/**
 * Reads the PKCS#8 PEM from the environment. Vercel's dashboard preserves real
 * newlines, but shells and CI often turn them into a literal backslash-n, so
 * accept both rather than failing at activation time on a formatting detail.
 */
function privateKeyPem(): string {
  const raw = process.env.LICENSE_PRIVATE_KEY;
  if (!raw) {
    throw new Error("LICENSE_PRIVATE_KEY is not set.");
  }
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

/** Signs a payload, returning the token string handed to the client. */
export function signToken(payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload));
  // Ed25519 takes a null algorithm -- the curve implies the hash.
  const signature = crypto.sign(null, body, privateKeyPem());
  return `${body.toString("base64url")}.${signature.toString("base64url")}`;
}

/**
 * Verifies a token the client sent back (used by /refresh).
 *
 * We re-derive the public key from our own private key rather than storing it
 * separately, so the two can never drift apart. Returns null on any failure --
 * callers treat null as "not a token we minted".
 */
export function verifyToken(token: string): TokenPayload | null {
  try {
    const [bodyB64, sigB64] = token.split(".");
    if (!bodyB64 || !sigB64) return null;

    const body = Buffer.from(bodyB64, "base64url");
    const signature = Buffer.from(sigB64, "base64url");

    const publicKey = crypto
      .createPublicKey(privateKeyPem())
      .export({ type: "spki", format: "pem" });

    if (!crypto.verify(null, body, publicKey as string, signature)) return null;

    const payload = JSON.parse(body.toString()) as TokenPayload;
    if (payload.v !== TOKEN_VERSION) return null;
    if (typeof payload.lic !== "string" || typeof payload.fp !== "string") return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Builds the token for a given license/device pair.
 *
 * Perpetual licenses get `exp: null` -- sold once, works forever, never phones
 * home again. Subscriptions get a short expiry so the client comes back to
 * renew, which is also what makes revocation possible. Switching a customer
 * between the two is a single column change in Postgres; no client update.
 */
export function buildToken(input: {
  licenseId: string;
  fingerprint: string;
  plan: string;
  features: string[];
  licenseExpiresAt: string | null;
}): string {
  const nowSeconds = Math.floor(Date.now() / 1000);

  let exp: number | null = null;
  if (input.plan === "subscription") {
    const windowEnd = nowSeconds + SUBSCRIPTION_TOKEN_DAYS * 86_400;
    const licenseEnd = input.licenseExpiresAt
      ? Math.floor(new Date(input.licenseExpiresAt).getTime() / 1000)
      : null;
    // Never hand out a token that outlives the subscription itself.
    exp = licenseEnd === null ? windowEnd : Math.min(windowEnd, licenseEnd);
  }

  return signToken({
    v: TOKEN_VERSION,
    lic: input.licenseId,
    fp: input.fingerprint,
    plan: input.plan,
    iat: nowSeconds,
    exp,
    feat: input.features,
  });
}
