/**
 * Generates the Ed25519 keypair used for Ausculta license keys.
 *
 * Run ONCE, offline:
 *
 *   node scripts/generate-license-keypair.mjs
 *
 * Output:
 *   scripts/keys/license_private.pem  — SECRET. Never commit, never ship.
 *                                       Needed only to mint customer keys
 *                                       (see make-license-key.mjs).
 *   scripts/keys/license_public.pem   — paste its content into
 *                                       LICENSE_PUBLIC_KEY_PEM in
 *                                       electron/services/trial.ts.
 *
 * Re-running with an existing keypair is refused: replacing the keypair
 * invalidates every license key already issued to customers. Pass --force
 * only if that is really what you want.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const keysDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "keys");
const privatePath = path.join(keysDir, "license_private.pem");
const publicPath = path.join(keysDir, "license_public.pem");

if (fs.existsSync(privatePath) && !process.argv.includes("--force")) {
  console.error(`Refusing to overwrite existing keypair: ${privatePath}`);
  console.error("A new keypair invalidates ALL previously issued license keys.");
  console.error("Run with --force if you really intend to replace it.");
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });

fs.mkdirSync(keysDir, { recursive: true });
fs.writeFileSync(privatePath, privatePem, { mode: 0o600 });
fs.writeFileSync(publicPath, publicPem);

console.log(`Private key written to ${privatePath}`);
console.log(`Public key written to  ${publicPath}`);
console.log("");
console.log("Paste this into LICENSE_PUBLIC_KEY_PEM in electron/services/trial.ts:");
console.log("");
console.log(publicPem);
