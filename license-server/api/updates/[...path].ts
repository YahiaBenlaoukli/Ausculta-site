import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAllowedUpdateFile, r2Configured, signDownloadUrl } from "../_lib/r2.js";
import { DEFAULT_PRODUCT, isProduct } from "../_lib/keys.js";

/**
 * GET /api/updates/<file>              -- Ausculta (legacy, no product segment)
 * GET /api/updates/<product>/<file>    -- everything else
 *
 * The update feed electron-updater points at. It asks for `latest.yml` first,
 * then for the installer named inside it (and optionally a `.blockmap` for
 * delta updates). Each request is answered with a 302 to a short-lived signed
 * R2 URL, so the bucket itself stays private and no credentials ever reach the
 * desktop app.
 *
 * ONE CATCH-ALL, NOT TWO ROUTES. This began as `[file].ts` plus a sibling
 * `[product]/[file].ts`, which looks additive and is not: two dynamic segments
 * at the same path level declare different slug names for the same position,
 * Vercel keeps one route and binds the parameter under the other name, and the
 * surviving handler then sees an empty filename and 404s EVERYTHING. That took
 * Ausculta's live feed down. A single catch-all cannot conflict with itself.
 *
 * The bare one-segment form has to keep working forever: Ausculta builds in
 * the field have `https://api.ausculta.site/api/updates` compiled into them and
 * cannot be told a new URL. It is treated as Ausculta, matching the same
 * default `/api/activate` applies to a request that names no product.
 *
 * Deliberately unauthenticated. Updates are for every install, including
 * trials -- an out-of-date clinic is a support problem, and gating patches
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

  // Same answer for every rejection below -- a bad product, a bad filename and
  // a missing object are indistinguishable from outside, so the endpoint
  // cannot be used to probe what the buckets contain.
  const notFound = () =>
    res.status(404).json({ ok: false, code: "not_found", message: "No such update file." });

  const raw = req.query.path;
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];

  let product: string;
  let file: string;

  if (segments.length === 1) {
    product = DEFAULT_PRODUCT;
    file = segments[0];
  } else if (segments.length === 2) {
    product = segments[0];
    file = segments[1];
  } else {
    return notFound();
  }

  // The product allowlist is shared with licensing (keys.ts) so there is one
  // list of what products exist. Validated BEFORE it reaches any R2 helper:
  // `product` selects both a bucket and a credential set by name, and an
  // unchecked value there would be attacker-controlled environment lookup.
  if (!isProduct(product) || !isAllowedUpdateFile(file)) return notFound();

  // Checked per product: Ausculta serving updates says nothing about whether
  // another product's bucket has been configured yet.
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
