import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAllowedUpdateFile, r2Configured, signDownloadUrl } from "../../_lib/r2.js";
import { isProduct } from "../../_lib/keys.js";

/**
 * GET /api/updates/<product>/<file>
 *
 * The product-scoped twin of ../[file].ts, which serves Ausculta. Each product
 * has a bucket of its own; this route picks the one named by `<product>` and
 * signs the file inside it. Keys are bare filenames — the bucket IS the
 * separation, so nothing is prefixed.
 *
 * WHY THE ROOT ROUTE WAS NOT JUST WIDENED. Ausculta installs already in the
 * field have `https://api.ausculta.site/api/updates` compiled into them and
 * cannot be told a new URL. Their route stays exactly as it was; this file is
 * additive, and a bug here cannot reach them.
 *
 * Deliberately unauthenticated, for the same reason as the root route: an
 * out-of-date clinic is a support problem, and gating patches behind a licence
 * check would keep fixes from the people most likely to be evaluating the
 * product. Licence enforcement happens inside the app, not at the download.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // electron-updater issues GETs, and HEAD when probing sizes.
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ ok: false, code: "bad_request", message: "Use GET." });
  }

  const product = first(req.query.product);
  const file = first(req.query.file);

  // The product allowlist is shared with licensing (keys.ts) so there is one
  // list of what products exist. It is validated BEFORE it reaches any R2
  // helper: `product` selects both a bucket and a credential set by name, and
  // an unchecked value there would be attacker-controlled environment lookup.
  if (!product || !isProduct(product) || !file || !isAllowedUpdateFile(file)) {
    // Same answer for "bad name" and "not there", so the endpoint cannot be
    // used to probe what the bucket contains.
    return res.status(404).json({ ok: false, code: "not_found", message: "No such update file." });
  }

  // Checked per product: Ausculta serving updates says nothing about whether
  // Dentura's bucket has been configured yet.
  if (!r2Configured(product)) {
    return res
      .status(503)
      .json({ ok: false, code: "server_error", message: "Update storage is not configured." });
  }

  try {
    // Sign for the method the client will actually replay against R2 --
    // a GET-signed URL 403s when followed with HEAD.
    const url = await signDownloadUrl(file, req.method === "HEAD" ? "HEAD" : "GET", product);

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

function first(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}
