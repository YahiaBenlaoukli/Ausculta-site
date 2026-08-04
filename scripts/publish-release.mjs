/**
 * Uploads a built release to Cloudflare R2, where the update endpoint on
 * api.ausculta.site serves it through signed URLs.
 *
 *   npm run release          # build, then upload
 *   node scripts/publish-release.mjs          # upload an existing build
 *   node scripts/publish-release.mjs --dry-run
 *
 * Uploads only what an updater actually needs: the manifests (latest*.yml),
 * the installers, and the .blockmap files that enable delta downloads.
 *
 * ORDER MATTERS. Installers go up first and latest.yml last, because
 * latest.yml is what tells every running copy of Ausculta that a new version
 * exists. Publishing it before the installer it names would send clinics
 * chasing a file that is not there yet.
 *
 * Credentials come from license-server/.env.local or the environment; they
 * never enter the app bundle.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFile(path.join(repoRoot, "license-server", ".env.local"));

const DRY_RUN = process.argv.includes("--dry-run");

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.error("Missing R2 credentials.");
  console.error("Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET");
  console.error("in license-server/.env.local (see .env.example).");
  process.exit(1);
}

const version = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
).version;

const releaseDir = path.join(repoRoot, "release", version);
if (!fs.existsSync(releaseDir)) {
  console.error(`No build found at ${releaseDir}`);
  console.error("Run `npm run build` first, or bump the version in package.json.");
  process.exit(1);
}

// Manifests last -- see the ordering note above.
const INSTALLER = /\.(exe|dmg|zip|AppImage|blockmap)$/i;
const MANIFEST = /^latest.*\.ya?ml$/i;

const all = fs.readdirSync(releaseDir).filter((f) =>
  fs.statSync(path.join(releaseDir, f)).isFile(),
);
const installers = all.filter((f) => INSTALLER.test(f));
const manifests = all.filter((f) => MANIFEST.test(f));

if (!manifests.length) {
  console.error("No latest.yml in the build output.");
  console.error('Check that electron-builder.json still has a "publish" provider —');
  console.error("without one it does not generate the update manifest.");
  process.exit(1);
}
if (!installers.length) {
  console.error("No installer found in the build output.");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

console.log(`\n  Publishing Ausculta ${version}${DRY_RUN ? "  (dry run)" : ""}`);
console.log("  ─────────────────────────────────────────────");

for (const file of [...installers, ...manifests]) {
  const full = path.join(releaseDir, file);
  const size = fs.statSync(full).size;
  const label = `${file}  (${(size / 1024 / 1024).toFixed(1)} MB)`;

  if (DRY_RUN) {
    console.log(`  would upload  ${label}`);
    continue;
  }

  process.stdout.write(`  uploading     ${label} ... `);
  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: file,
      Body: fs.createReadStream(full),
      ContentLength: size,
      ContentType: contentType(file),
      // Lets R2 reject a corrupted transfer rather than serving a broken
      // installer that every client would then fail to verify.
      ChecksumSHA256: sha256Base64(full),
    }),
  );
  console.log("done");
}

console.log("");
if (DRY_RUN) {
  console.log("  Dry run only, nothing uploaded.");
} else {
  console.log(`  Published. Clients will see ${version} within a few hours,`);
  console.log("  or immediately via Settings -> Updates -> Check for updates.");
  console.log("");
  console.log("  Verify:  curl -I https://api.ausculta.site/api/updates/latest.yml");
}
console.log("");

function contentType(file) {
  if (/\.ya?ml$/i.test(file)) return "text/yaml";
  if (/\.exe$/i.test(file)) return "application/vnd.microsoft.portable-executable";
  if (/\.dmg$/i.test(file)) return "application/x-apple-diskimage";
  if (/\.zip$/i.test(file)) return "application/zip";
  return "application/octet-stream";
}

function sha256Base64(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("base64");
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
