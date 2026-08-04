/**
 * Mints a new Ausculta license key and registers it in Supabase.
 *
 *   node scripts/issue-license.mjs "Dr. Yahia Benlaoukli"
 *   node scripts/issue-license.mjs "Dr. X" --email dr.x@mail.com --devices 3
 *   node scripts/issue-license.mjs "Clinique Y" --plan subscription --expires 2027-01-01
 *
 * The key is printed ONCE and never stored anywhere: the database only keeps
 * its SHA-256. If a customer loses their key you issue a new one and revoke
 * the old -- there is no way to recover it, by design.
 *
 * Credentials are read from license-server/.env.local (the same file used by
 * `vercel dev`), or from the environment.
 *
 * NOTE: the key alphabet below must stay in sync with
 * license-server/api/_lib/keys.ts -- both sides hash the same normalized form.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ─── Config ──────────────────────────────────────────────────────────────

loadEnvFile(path.join(repoRoot, "license-server", ".env.local"));

// The dashboard shows the REST endpoint (".../rest/v1/"), but we append that
// path ourselves — trim it so either form pasted into .env.local works.
const SUPABASE_URL = process.env.SUPABASE_URL?.trim()
  .replace(/\/+$/, "")
  .replace(/\/rest\/v1$/, "");

// Supabase is replacing the legacy JWT `service_role` key with `sb_secret_…`
// keys (legacy ones stop working end of 2026). Accept either, preferring the
// new name, so switching over is a one-line change in .env.local.
const SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SECRET_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SECRET_KEY.");
  console.error("Put them in license-server/.env.local (see .env.example).");
  process.exit(1);
}

// ─── Arguments ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const customerName = args.find((a) => !a.startsWith("--"));

if (!customerName) {
  console.error('Usage: node scripts/issue-license.mjs "<customer name>" [options]');
  console.error("");
  console.error("  --email <address>       Customer email, for support lookup");
  console.error("  --devices <n>           Activation slots (default 3)");
  console.error("  --plan <perpetual|subscription>   Default perpetual");
  console.error("  --expires <YYYY-MM-DD>  Subscription end date");
  console.error("  --notes <text>          Free-form note");
  process.exit(1);
}

const email = flag("--email");
const notes = flag("--notes");
const plan = flag("--plan") ?? "perpetual";
const expires = flag("--expires");
const devices = Number(flag("--devices") ?? 3);

if (plan !== "perpetual" && plan !== "subscription") {
  console.error(`Invalid --plan "${plan}". Use "perpetual" or "subscription".`);
  process.exit(1);
}
if (!Number.isInteger(devices) || devices < 1) {
  console.error("--devices must be a positive integer.");
  process.exit(1);
}
if (expires && Number.isNaN(Date.parse(expires))) {
  console.error(`Invalid --expires "${expires}". Use YYYY-MM-DD.`);
  process.exit(1);
}
if (plan === "subscription" && !expires) {
  console.error("A subscription license needs --expires YYYY-MM-DD.");
  process.exit(1);
}

// ─── Mint ────────────────────────────────────────────────────────────────

const licenseKey = generateKey();

const response = await fetch(`${SUPABASE_URL}/rest/v1/licenses`, {
  method: "POST",
  headers: {
    // `apikey` only -- deliberately NOT `Authorization: Bearer`. The new
    // sb_secret_… keys are not JWTs and are rejected on the Bearer header,
    // whereas `apikey` alone works for both the legacy and the new key.
    apikey: SECRET_KEY,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  },
  body: JSON.stringify({
    key_hash: hashKey(licenseKey),
    key_prefix: licenseKey.slice(0, 9), // "AUSC-7K3M"
    customer_name: customerName,
    customer_email: email ?? null,
    notes: notes ?? null,
    plan,
    max_activations: devices,
    expires_at: expires ? new Date(expires).toISOString() : null,
  }),
});

if (!response.ok) {
  console.error(`Supabase rejected the insert (HTTP ${response.status}):`);
  console.error(await response.text());
  process.exit(1);
}

const [row] = await response.json();

console.log("");
console.log("  License issued");
console.log("  ─────────────────────────────────────────────");
console.log(`  Customer : ${customerName}${email ? ` <${email}>` : ""}`);
console.log(`  Plan     : ${plan}${expires ? ` (until ${expires})` : ""}`);
console.log(`  Devices  : ${devices}`);
console.log(`  Row id   : ${row.id}`);
console.log("");
console.log(`  KEY      : ${licenseKey}`);
console.log("");
console.log("  Send this key to the customer. It is not stored and cannot be");
console.log("  recovered -- if it is lost, revoke the row and issue a new one.");
console.log("");

// ─── Helpers ─────────────────────────────────────────────────────────────

function flag(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

/** Minimal .env reader -- avoids adding a dependency just for the admin CLI. */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, name, rawValue] = match;
    if (process.env[name]) continue; // real environment wins
    process.env[name] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function generateKey() {
  // Crockford base32: no I, L, O or U, so dictated keys survive the round trip.
  const KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const bytes = crypto.randomBytes(16);
  // Exactly 32 symbols, so a 5-bit mask samples uniformly with no modulo bias.
  const body = [...bytes].map((b) => KEY_ALPHABET[b & 31]).join("");
  return ["AUSC", ...body.match(/.{1,4}/g)].join("-");
}

function hashKey(raw) {
  const normalized = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}
