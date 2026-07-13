/**
 * Mints a customer license key, signed with the private key produced by
 * generate-license-keypair.mjs. Run offline; the output string is what you
 * hand to the customer.
 *
 *   node scripts/make-license-key.mjs "Dr. Yahia Benlaoukli"
 *
 * The key format is base64url(payloadJson).base64url(signature) — exactly
 * what verifyLicenseKey() in electron/services/trial.ts expects.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const name = process.argv[2];
if (!name) {
  console.error('Usage: node scripts/make-license-key.mjs "<customer name>"');
  process.exit(1);
}

const privatePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "keys", "license_private.pem");
if (!fs.existsSync(privatePath)) {
  console.error(`Private key not found: ${privatePath}`);
  console.error("Generate it first: node scripts/generate-license-keypair.mjs");
  process.exit(1);
}
const privatePem = fs.readFileSync(privatePath, "utf8");

const payload = Buffer.from(JSON.stringify({ name, issued: new Date().toISOString().slice(0, 10) }));
const signature = crypto.sign(null, payload, privatePem);
const licenseKey = `${payload.toString("base64url")}.${signature.toString("base64url")}`;

console.log(`License key for "${name}":`);
console.log("");
console.log(licenseKey);
