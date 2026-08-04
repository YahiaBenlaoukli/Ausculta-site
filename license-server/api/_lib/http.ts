import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Shared HTTP plumbing for the activation endpoints.
 *
 * Every response uses the same envelope so the desktop client has exactly one
 * shape to parse:
 *
 *   success -> { ok: true,  ...payload }
 *   failure -> { ok: false, code: "invalid_key", message: "..." }
 *
 * `code` is a stable machine-readable slug. The client maps it to a translated
 * string from its own locale files -- the server never sends user-facing prose
 * in a particular language, because the app ships in fr/en/ar.
 */

export type ErrorCode =
  | "bad_request"
  | "invalid_key"
  | "revoked"
  | "license_expired"
  | "limit_reached"
  | "released"
  | "invalid_token"
  | "unauthorized"
  | "rate_limited"
  | "server_error";

export function ok(res: VercelResponse, payload: Record<string, unknown>) {
  return res.status(200).json({ ok: true, ...payload });
}

export function fail(
  res: VercelResponse,
  httpStatus: number,
  code: ErrorCode,
  message: string,
) {
  // `message` is developer-facing only (logs, curl, support). The client shows
  // its own translated copy keyed off `code`.
  return res.status(httpStatus).json({ ok: false, code, message });
}

/** Rejects anything that isn't the expected verb. */
export function requireMethod(
  req: VercelRequest,
  res: VercelResponse,
  method: "POST" | "GET",
): boolean {
  if (req.method !== method) {
    res.setHeader("Allow", method);
    fail(res, 405, "bad_request", `Use ${method}.`);
    return false;
  }
  return true;
}

/**
 * Vercel parses JSON bodies for us, but only when the content-type is right --
 * a client that forgets the header hands us a raw string instead.
 */
export function readJsonBody(req: VercelRequest): Record<string, unknown> {
  const body = req.body;
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return body as Record<string, unknown>;
}

/** Extracts a plain string field, or null if absent/blank/oversized. */
export function str(
  body: Record<string, unknown>,
  field: string,
  maxLength = 256,
): string | null {
  const value = body[field];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

/**
 * Caller IP for throttling. Vercel always sets x-forwarded-for; the leftmost
 * entry is the real client because Vercel appends, it does not pass through
 * whatever the caller claimed.
 */
export function clientIp(req: VercelRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(",")[0]?.trim();
  return first || "unknown";
}

/** Timing-safe string compare for the admin token. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
