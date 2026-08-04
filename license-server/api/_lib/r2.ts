import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Cloudflare R2 access for serving app updates.
 *
 * R2 speaks the S3 API, so the standard AWS signer works against it. The
 * bucket stays private: nothing is publicly readable, and every download goes
 * through a short-lived signed URL minted here.
 *
 * Integrity does not depend on any of this. electron-updater checks the
 * SHA-512 recorded in latest.yml after downloading, so a corrupted or
 * substituted installer is rejected regardless of how it was fetched.
 */

/** Signed URLs live just long enough to start a large download on slow links. */
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

let cached: S3Client | null = null;

function client(): S3Client {
  if (cached) return cached;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are not set.");
  }

  cached = new S3Client({
    region: "auto", // R2 has no regions; the SDK still requires the field.
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cached;
}

export function updatesBucket(): string | undefined {
  return process.env.R2_BUCKET;
}

export function r2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
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
): Promise<string> {
  const bucket = updatesBucket();
  if (!bucket) throw new Error("R2_BUCKET is not set.");

  const command =
    method === "HEAD"
      ? new HeadObjectCommand({ Bucket: bucket, Key: key })
      : new GetObjectCommand({ Bucket: bucket, Key: key });

  return getSignedUrl(client(), command, { expiresIn: SIGNED_URL_TTL_SECONDS });
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
