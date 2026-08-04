/**
 * Frees the device slots on a license, so a customer who has used all their
 * activations can install on a new machine.
 *
 *   node scripts/release-device.mjs AUSC-7K3M-9QP2-XR4T-8WNZ
 *   node scripts/release-device.mjs AUSC-... --fingerprint <sha256>
 *
 * Without --fingerprint every device on the key is released, which is the
 * usual support action ("reset my license, I changed computer"). The customer
 * then re-enters the same key on the new PC -- no new key needed.
 *
 * Reads ADMIN_TOKEN from license-server/.env.local or the environment.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFile(path.join(repoRoot, "license-server", ".env.local"));

const API_URL = process.env.AUSCULTA_API_URL ?? "https://api.ausculta.site";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

const args = process.argv.slice(2);
const licenseKey = args.find((a) => !a.startsWith("--"));
const fingerprint = flag("--fingerprint");

if (!licenseKey) {
  console.error("Usage: node scripts/release-device.mjs <LICENSE-KEY> [--fingerprint <sha256>]");
  process.exit(1);
}
if (!ADMIN_TOKEN) {
  console.error("Missing ADMIN_TOKEN (license-server/.env.local or environment).");
  process.exit(1);
}

const response = await fetch(`${API_URL}/api/release`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-admin-token": ADMIN_TOKEN,
  },
  body: JSON.stringify({ licenseKey, fingerprint }),
});

const result = await response.json().catch(() => null);

if (!response.ok || !result?.ok) {
  console.error(`Release failed (HTTP ${response.status}): ${result?.message ?? "unknown error"}`);
  process.exit(1);
}

console.log("");
console.log(`  Released ${result.released} device(s) for ${result.customerName ?? "this license"}.`);
console.log(`  Slots now free: ${result.slotsFree} of ${result.maxActivations}.`);
console.log("");
console.log("  The customer can now activate with the SAME key on their new PC.");
console.log("");

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
