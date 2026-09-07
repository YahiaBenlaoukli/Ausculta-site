import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Cloudflare R2 access for serving app updates.
 *
 * R2 speaks the S3 API, so the standard AWS signer works against it. The
 * bucket stays private: nothing is publicly readable, and every download goes
 * through a short-lived signed URL minted here.
 *
 * ONE BUCKET PER PRODUCT. Ausculta and Dentura share this server but not their
 * storage: each product's releases live in a bucket of their own, and the
 * per-product environment below is what selects between them. A bucket
 * boundary is a much harder mistake to make than a key prefix -- a release
 * script pointed at the wrong bucket fails on a missing name, where one that
 * forgets a prefix silently overwrites the other product's latest.yml and
 * ships the wrong app to every clinic running it.
 *
 * Integrity does not depend on any of this. electron-updater checks the
 * SHA-512 recorded in latest.yml after downloading, so a corrupted or
 * substituted installer is rejected regardless of how it was fetched.
 */

/** Signed URLs live just long enough to start a large download on slow links. */
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Reads `<NAME>_<PRODUCT>` if it is set, else the bare `<NAME>`.
 *
 * The bare names are Ausculta's, because they were the only ones when this
 * server had one product; adding a suffixed variant is how a second product
 * overrides any part of the config. The fallback is what keeps a shared setup
 * to a single new variable: if both products live in the same Cloudflare
 * account under one API token, only `R2_BUCKET_DENTURA` has to be set, and the
 * account id and credentials are inherited. If Dentura ever needs its own
 * account or a separately scoped token, the other three suffixed names take
 * over with no code change.
 */
function env(name: string, product?: string): string | undefined {
  if (product) {
    const scoped = process.env[`${name}_${product.toUpperCase()}`];
    if (scoped) return scoped;
  }
  return process.env[name];
}

// One client per credential set, keyed by the account it talks to. Two
// products in the same account share a client; separate accounts get one each.
const clients = new Map<string, S3Client>();

function client(product?: string): S3Client {
  const accountId = env("R2_ACCOUNT_ID", product);
  const accessKeyId = env("R2_ACCESS_KEY_ID", product);
  const secretAccessKey = env("R2_SECRET_ACCESS_KEY", product);

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are not set.");
  }

  const cacheKey = `${accountId}:${accessKeyId}`;
  const existing = clients.get(cacheKey);
  if (existing) return existing;

  const created = new S3Client({
    region: "auto", // R2 has no regions; the SDK still requires the field.
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  clients.set(cacheKey, created);
  return created;
}

/** The bucket holding one product's releases. */
export function updatesBucket(product?: string): string | undefined {
  return env("R2_BUCKET", product);
}

/**
 * Whether updates can be served for a product.
 *
 * Per-product, because one product being unconfigured says nothing about the
 * other: Dentura's bucket can be missing while Ausculta serves updates fine.
 */
export function r2Configured(product?: string): boolean {
  return Boolean(
    env("R2_ACCOUNT_ID", product) &&
      env("R2_ACCESS_KEY_ID", product) &&
      env("R2_SECRET_ACCESS_KEY", product) &&
      env("R2_BUCKET", product),
  );
}

/**
 * Mints a temporary download URL for one object.
 *
 * The signature covers the HTTP method, so a URL signed for GET is rejected
 * with 403 when used with HEAD. Callers must pass the method the client will
 * actually use, or size probes fail while downloads succeed -- a confusing
 * split that is easy to miss because the common path still works.
 */
export async function signDownloadUrl(
  key: string,
  method: "GET" | "HEAD" = "GET",
  product?: string,
): Promise<string> {
  const bucket = updatesBucket(product);
  if (!bucket) throw new Error("R2_BUCKET is not set.");

  const command =
    method === "HEAD"
      ? new HeadObjectCommand({ Bucket: bucket, Key: key })
      : new GetObjectCommand({ Bucket: bucket, Key: key });

  return getSignedUrl(client(product), command, { expiresIn: SIGNED_URL_TTL_SECONDS });
}

/**
 * Whitelist of things the update endpoint may hand out.
 *
 * Without this the endpoint would be an open proxy to the whole bucket: any
 * path a caller invented would come back signed. Only the files an updater
 * legitimately asks for are allowed through.
 *
 *   latest.yml / latest-mac.yml / latest-linux.yml  — the update manifests
 *   *.exe, *.dmg, *.zip, *.AppImage                 — the installers
 *   *.blockmap                                      — delta-update indexes
 */
const ALLOWED = /^[A-Za-z0-9._ -]+\.(ya?ml|exe|dmg|zip|AppImage|blockmap)$/;

export function isAllowedUpdateFile(name: string): boolean {
  // Reject anything with path structure before pattern-matching, so no amount
  // of encoding trickery can walk out of the updates prefix.
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  return ALLOWED.test(name);
}
