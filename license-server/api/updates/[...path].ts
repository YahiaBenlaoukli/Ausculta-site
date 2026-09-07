import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAllowedUpdateFile, r2Configured, signDownloadUrl } from "../_lib/r2.js";
import { isProduct } from "../_lib/keys.js";

/**
 * GET /api/updates/<file>             — Ausculta (legacy shape)
 * GET /api/updates/<product>/<file>   — product-scoped
 *
 * The update feed electron-updater points at. It asks for `latest.yml` first,
 * then for the installer named inside it (and optionally a `.blockmap` for
 * delta updates). Each request is answered with a 302 to a short-lived signed
 * R2 URL, so the bucket itself stays private and no credentials ever reach the
 * desktop app.
 *
 * WHY ONE CATCH-ALL AND NOT TWO FILES. The obvious layout — leaving the
 * original `[file].ts` untouched and adding `[product]/[file].ts` beside it —
 * does not build. Vercel resolves routes by filename, and those two put
 * different slug names (`file` and `product`) at the same position under
 * `updates/`, which it rejects: "Two or more files have conflicting paths or
 * names." A single catch-all is the only layout that serves both shapes, so
 * the segment count is what selects between them here rather than the router.
 *
 * The one-segment form is load-bearing. Ausculta installs already in the field
 * have `https://api.ausculta.site/api/updates` compiled into them and cannot be
 * told a new URL, so that shape must keep resolving exactly as it did — which
 * means passing no product and letting r2.ts fall back to the bare `R2_*`
 * variables, the same environment those installs have always been served from.
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

  // Same answer for every malformed request, so the endpoint cannot be used to
  // probe what the buckets contain or which products exist.
  const notFound = () =>
    res.status(404).json({ ok: false, code: "not_found", message: "No such update file." });

  const raw = req.query.path;
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];

  // `undefined` for the legacy shape, not DEFAULT_PRODUCT: it makes r2.ts read
  // the bare `R2_*` names directly, so shipped installs keep being served from
  // the exact environment they always were even if `R2_BUCKET_AUSCULTA` is
  // later set to something else.
  let product: string | undefined;
  let file: string | undefined;

  if (segments.length === 1) {
    [file] = segments;
  } else if (segments.length === 2) {
    [product, file] = segments;
    // The product allowlist is shared with licensing (keys.ts) so there is one
    // list of what products exist. It is validated BEFORE it reaches any R2
    // helper: `product` selects both a bucket and a credential set by name, and
    // an unchecked value there would be attacker-controlled environment lookup.
    if (!isProduct(product)) return notFound();
  } else {
    return notFound();
  }

  if (!file || !isAllowedUpdateFile(file)) return notFound();

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
