import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAllowedUpdateFile, r2Configured, signDownloadUrl } from "../_lib/r2.js";

/**
 * GET /api/updates/<file>
 *
 * The update feed electron-updater points at. It asks for `latest.yml` first,
 * then for the installer named inside it (and optionally a `.blockmap` for
 * delta updates). Each request is answered with a 302 to a short-lived signed
 * R2 URL, so the bucket itself stays private and no credentials ever reach the
 * desktop app.
 *
 * Deliberately unauthenticated. Updates are for every install, including
 * trials — an out-of-date clinic is a support problem, and gating patches
 * behind a licence check would keep bug fixes from the people most likely to
 * be evaluating the product. Licence enforcement happens inside the app, not
 * at the download.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // electron-updater issues GETs, and HEAD when probing sizes.
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ ok: false, code: "bad_request", message: "Use GET." });
  }

  if (!r2Configured()) {
    return res
      .status(503)
      .json({ ok: false, code: "server_error", message: "Update storage is not configured." });
  }

  const raw = req.query.file;
  const file = Array.isArray(raw) ? raw[0] : raw;

  if (!file || !isAllowedUpdateFile(file)) {
    // Same answer for "bad name" and "not there", so the endpoint cannot be
    // used to probe what the bucket contains.
    return res.status(404).json({ ok: false, code: "not_found", message: "No such update file." });
  }

  try {
    // Sign for the method the client will actually replay against R2 --
    // a GET-signed URL 403s when followed with HEAD.
    const url = await signDownloadUrl(file, req.method === "HEAD" ? "HEAD" : "GET");

    // 302 rather than proxying the bytes: a 100 MB installer streamed through
    // a serverless function would be slow, expensive, and would hit execution
    // limits. The client follows the redirect straight to R2.
    res.setHeader("Location", url);
    // Signed URLs expire, so this response must never be cached.
    res.setHeader("Cache-Control", "no-store");
    return res.status(302).end();
  } catch (error) {
    console.error("update redirect failed", error);
    return res
      .status(500)
      .json({ ok: false, code: "server_error", message: "Could not prepare the download." });
  }
}
