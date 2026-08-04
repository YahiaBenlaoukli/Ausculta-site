/**
 * Generates the Ed25519 keypair used to sign Ausculta activation tokens.
 *
 * Run ONCE, offline:
 *
 *   node scripts/generate-license-keypair.mjs
 *
 * Output:
 *   scripts/keys/license_private.pem  — SECRET. Never commit, never ship.
 *                                       Goes into the activation server as the
 *                                       LICENSE_PRIVATE_KEY environment
 *                                       variable (Vercel → Settings → Env).
 *   scripts/keys/license_public.pem   — paste its content into
 *                                       LICENSE_PUBLIC_KEY_PEM in
 *                                       electron/services/trial.ts.
 *
 * The private key signs activation tokens on the server; the public key, baked
 * into the app, verifies them offline on every launch. That split is what lets
 * an activated copy run forever without internet while still making tokens
 * impossible to forge — someone who points api.ausculta.site at their own
 * machine cannot produce a signature the app accepts.
 *
 * Re-running with an existing keypair is refused: replacing it invalidates
 * every activation already in the field, and every affected customer would
 * have to re-activate. Pass --force only if that is really what you want.
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
  console.error("A new keypair invalidates EVERY activation already issued.");
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
console.log("1. Paste this into LICENSE_PUBLIC_KEY_PEM in electron/services/trial.ts:");
console.log("");
console.log(publicPem);
console.log("2. Set the PRIVATE key as LICENSE_PRIVATE_KEY on the activation server");
console.log("   (Vercel → Project → Settings → Environment Variables), and in");
console.log("   license-server/.env.local for local testing.");
console.log("");
console.log("   Never commit scripts/keys/ — it is gitignored for this reason.");
