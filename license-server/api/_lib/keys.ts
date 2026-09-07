import crypto from "node:crypto";

/**
 * License key format and hashing.
 *
 * A key looks like:  AUSC-7K3M-9QP2-XR4T-8WNZ   (Ausculta)
 *                    DENT-7K3M-9QP2-XR4T-8WNZ   (Dentura)
 *
 * The four-letter prefix names the PRODUCT, and exists so support can tell
 * from a key read out over the phone which app the customer is running. It is
 * not a security boundary — `licenses.product` is what activation actually
 * checks — and every prefix is the same length, so nothing below changes
 * shape when one is added.
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

/**
 * Prefix per product. Keep every entry four characters and free of the folded
 * lookalikes (O, I, L) — normalizeKey() rewrites those, and a prefix that
 * changed under normalization would never match itself.
 */
export const PRODUCT_KEY_PREFIXES = {
  ausculta: "AUSC",
  dentura: "DENT",
} as const;

export type Product = keyof typeof PRODUCT_KEY_PREFIXES;

/**
 * The product assumed when a request does not name one.
 *
 * Every Ausculta build already in the field predates the `product` field and
 * sends nothing, so this default is load-bearing: changing it would break
 * activation for existing customers.
 */
export const DEFAULT_PRODUCT: Product = "ausculta";

export function isProduct(value: unknown): value is Product {
  return typeof value === "string" && value in PRODUCT_KEY_PREFIXES;
}

/** Legacy alias: Ausculta's prefix, kept so existing imports still resolve. */
export const KEY_PREFIX = PRODUCT_KEY_PREFIXES.ausculta;
export const KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const KEY_BODY_LENGTH = 16;
/** All prefixes share this length; the slicing below assumes it. */
const KEY_PREFIX_LENGTH = 4;

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

/**
 * Cheap shape check so obviously-malformed input never reaches the database.
 *
 * Accepts ANY known product's prefix rather than only the caller's own: a
 * Dentura user who pastes an Ausculta key should get "wrong product" from the
 * activation lookup, not "malformed key" from here. The two are very different
 * support calls, and only the first one is true.
 */
export function isPlausibleKey(raw: string): boolean {
  const normalized = normalizeKey(raw);
  if (normalized.length !== KEY_PREFIX_LENGTH + KEY_BODY_LENGTH) return false;

  const prefix = normalized.slice(0, KEY_PREFIX_LENGTH);
  const known = Object.values(PRODUCT_KEY_PREFIXES).some(
    (candidate) => normalizeKey(candidate) === prefix,
  );
  if (!known) return false;

  const body = normalized.slice(KEY_PREFIX_LENGTH);
  return [...body].every((char) => KEY_ALPHABET.includes(char));
}

/** Which product a key's prefix claims, or null if it names none. */
export function productOfKey(raw: string): Product | null {
  const prefix = normalizeKey(raw).slice(0, KEY_PREFIX_LENGTH);
  for (const [product, candidate] of Object.entries(PRODUCT_KEY_PREFIXES)) {
    if (normalizeKey(candidate) === prefix) return product as Product;
  }
  return null;
}

/** What we store instead of the key itself. */
export function hashKey(raw: string): string {
  return crypto.createHash("sha256").update(normalizeKey(raw)).digest("hex");
}

/**
 * Human-readable fragment kept in clear ("AUSC-7K3M" / "DENT-7K3M"), so a
 * customer reading out the start of their key is enough to find their row in
 * the dashboard. Echoes back the prefix the key actually carries — rewriting
 * it to a fixed one would file every product's keys under the same fragment.
 */
export function keyPrefixOf(raw: string): string {
  const normalized = normalizeKey(raw);
  const prefix = normalized.slice(0, KEY_PREFIX_LENGTH);
  return `${prefix}-${normalized.slice(KEY_PREFIX_LENGTH, KEY_PREFIX_LENGTH + 4)}`;
}

/** Formats 16 payload characters into the dashed display form. */
export function formatKey(body: string, product: Product = DEFAULT_PRODUCT): string {
  const groups = body.match(/.{1,4}/g) ?? [];
  return [PRODUCT_KEY_PREFIXES[product], ...groups].join("-");
}

/** Mints a fresh key using rejection-free sampling over the 32-char alphabet. */
export function generateKey(product: Product = DEFAULT_PRODUCT): string {
  const bytes = crypto.randomBytes(KEY_BODY_LENGTH);
  // The alphabet is exactly 32 characters, so masking to 5 bits is uniform --
  // no modulo bias, no rejection loop needed.
  const body = [...bytes].map((byte) => KEY_ALPHABET[byte & 31]).join("");
  return formatKey(body, product);
}
