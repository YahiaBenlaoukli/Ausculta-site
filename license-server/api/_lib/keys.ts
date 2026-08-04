import crypto from "node:crypto";

/**
 * License key format and hashing.
 *
 * A key looks like:  AUSC-7K3M-9QP2-XR4T-8WNZ
 *
 * 16 payload characters drawn from Crockford base32 = 80 bits of entropy,
 * which is far beyond brute-forcing over HTTP, while staying short enough to
 * read out over the phone or send on WhatsApp.
 *
 * Crockford's alphabet omits I, L, O and U specifically so handwritten and
 * dictated keys survive the round trip. We additionally fold the lookalikes
 * on the way in (O->0, I/L->1) so a customer who types what they *think* they
 * see still activates successfully.
 */

export const KEY_PREFIX = "AUSC";
export const KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const KEY_BODY_LENGTH = 16;

/**
 * Canonical form used for hashing and comparison: uppercase, no separators,
 * lookalike characters folded. `AUSC-7K3M-...` and `ausc 7k3m ...` hash equal.
 */
export function normalizeKey(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/** Cheap shape check so obviously-malformed input never reaches the database. */
export function isPlausibleKey(raw: string): boolean {
  const normalized = normalizeKey(raw);
  if (normalized.length !== KEY_PREFIX.length + KEY_BODY_LENGTH) return false;
  if (!normalized.startsWith(normalizeKey(KEY_PREFIX))) return false;
  const body = normalized.slice(KEY_PREFIX.length);
  return [...body].every((char) => KEY_ALPHABET.includes(char));
}

/** What we store instead of the key itself. */
export function hashKey(raw: string): string {
  return crypto.createHash("sha256").update(normalizeKey(raw)).digest("hex");
}

/**
 * Human-readable fragment kept in clear ("AUSC-7K3M"), so a customer reading
 * out the start of their key is enough to find their row in the dashboard.
 */
export function keyPrefixOf(raw: string): string {
  const normalized = normalizeKey(raw);
  return `${KEY_PREFIX}-${normalized.slice(KEY_PREFIX.length, KEY_PREFIX.length + 4)}`;
}

/** Formats 16 payload characters into the dashed display form. */
export function formatKey(body: string): string {
  const groups = body.match(/.{1,4}/g) ?? [];
  return [KEY_PREFIX, ...groups].join("-");
}

/** Mints a fresh key using rejection-free sampling over the 32-char alphabet. */
export function generateKey(): string {
  const bytes = crypto.randomBytes(KEY_BODY_LENGTH);
  // The alphabet is exactly 32 characters, so masking to 5 bits is uniform --
  // no modulo bias, no rejection loop needed.
  const body = [...bytes].map((byte) => KEY_ALPHABET[byte & 31]).join("");
  return formatKey(body);
}
