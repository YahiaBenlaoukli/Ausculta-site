import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db, type LicenseRow } from "./_lib/db.js";
import { hashKey, isPlausibleKey } from "./_lib/keys.js";
import { fail, ok, readJsonBody, requireMethod, safeEqual, str } from "./_lib/http.js";

/**
 * POST /api/release  (admin only -- header: x-admin-token)
 *
 * Body: { licenseKey, fingerprint? }
 * 200:  { ok: true, released, slotsFree }
 *
 * Frees device slots. With three activations per key, most reinstalls sort
 * themselves out; this is for the case a doctor actually exhausts them --
 * three dead PCs, or a stolen machine. Omit `fingerprint` to release every
 * device on the key, which is the usual "just reset me" support action.
 *
 * Released rows are kept (soft delete) so the history of which machines ran
 * the license survives the reset.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireMethod(req, res, "POST")) return;

  const expected = process.env.ADMIN_TOKEN;
  const provided = req.headers["x-admin-token"];
  const providedValue = Array.isArray(provided) ? provided[0] : provided;

  // A missing ADMIN_TOKEN must fail closed -- otherwise a half-configured
  // deployment would expose license resets to anyone who found the URL.
  if (!expected || !providedValue || !safeEqual(expected, providedValue)) {
    return fail(res, 401, "unauthorized", "Missing or invalid admin token.");
  }

  const body = readJsonBody(req);
  const licenseKey = str(body, "licenseKey", 64);
  const fingerprint = str(body, "fingerprint", 128);

  if (!licenseKey || !isPlausibleKey(licenseKey)) {
    return fail(res, 400, "bad_request", "A valid licenseKey is required.");
  }

  try {
    const { data: license, error: licenseError } = await db()
      .from("licenses")
      .select("id, key_prefix, customer_name, plan, status, max_activations, expires_at, features")
      .eq("key_hash", hashKey(licenseKey))
      .maybeSingle<LicenseRow>();

    if (licenseError) throw licenseError;
    if (!license) return fail(res, 404, "invalid_key", "No such license key.");

    let query = db()
      .from("activations")
      .update({ released_at: new Date().toISOString() })
      .eq("license_id", license.id)
      .is("released_at", null);

    if (fingerprint) query = query.eq("fingerprint", fingerprint);

    const { data: released, error: releaseError } = await query.select("id");
    if (releaseError) throw releaseError;

    const { count, error: countError } = await db()
      .from("activations")
      .select("id", { count: "exact", head: true })
      .eq("license_id", license.id)
      .is("released_at", null);

    if (countError) throw countError;

    return ok(res, {
      released: released?.length ?? 0,
      slotsFree: license.max_activations - (count ?? 0),
      maxActivations: license.max_activations,
      customerName: license.customer_name,
    });
  } catch (error) {
    console.error("release failed", error);
    return fail(res, 500, "server_error", "Release failed.");
  }
}
