import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAllowedUpdateFile, r2Configured, signDownloadUrl } from "../_lib/r2.js";

/**
 * GET /api/updates-dentura/<file>
 *
 * Dentura's update feed. Identical to ../updates/[file].ts except for the
 * bucket it signs against; see that file for why the endpoint is public and
 * why it redirects rather than proxying.
 *
 * WHY A SIBLING DIRECTORY AND NOT `updates/<product>/<file>`. Two attempts at
 * putting the product in the path failed in production, both because this
 * runtime is not Next.js:
 *
 *   1. `updates/[file].ts` + `updates/[product]/[file].ts` -- two different
 *      slug names for the same path position. One route survived and bound the
 *      parameter under the other name, so `req.query.file` came back empty and
 *      Ausculta's live feed 404'd every request.
 *   2. `updates/[...path].ts` -- the bare-functions runtime does not implement
 *      Next.js catch-alls. It read the directory entry as an ordinary dynamic
 *      segment literally named `...path`, matching exactly ONE segment, so
 *      `req.query.path` was undefined and two-segment URLs matched no route.
 *
 * A separate top-level directory with a single `[file]` segment is the exact
 * shape that has served Ausculta in production for months. It cannot interact
 * with that route at all, which is the point: Dentura has no users yet and
 * Ausculta has paying ones, so the risk belongs on this side.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // electron-updater issues GETs, and HEAD when probing sizes.
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ ok: false, code: "bad_request", message: "Use GET." });
  }

  // Per product: Ausculta serving updates says nothing about whether Dentura's
  // bucket and credentials have been configured yet.
  if (!r2Configured("dentura")) {
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
    const url = await signDownloadUrl(file, req.method === "HEAD" ? "HEAD" : "GET", "dentura");

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
