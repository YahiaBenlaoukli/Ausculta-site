import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db, isLicenseExpired, type ActivationRow, type LicenseRow } from "./_lib/db.js";
import { buildToken, verifyToken } from "./_lib/token.js";
import { fail, ok, readJsonBody, requireMethod, str } from "./_lib/http.js";

/**
 * POST /api/refresh
 *
 * Body: { token }
 * 200:  { ok: true, token, plan, expiresAt }
 *
 * Exists entirely for the subscription future. Perpetual installs carry
 * `exp: null` and never call this -- they activate once and stay offline for
 * good, which is the behaviour that was asked for.
 *
 * It ships NOW because it cannot be added later: once a copy of the app is on
 * a doctor's PC, we can't teach it a renewal protocol it wasn't built with. So
 * v1 clients already know how to renew, and switching a customer to a
 * subscription becomes a column change in Postgres rather than a forced
 * reinstall for everyone.
 *
 * A refresh can never move a license to a different machine: the device
 * fingerprint is read from the signed token, not from the request body.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireMethod(req, res, "POST")) return;

  const body = readJsonBody(req);
  const token = str(body, "token", 4096);
  if (!token) {
    return fail(res, 400, "bad_request", "token is required.");
  }

  const payload = verifyToken(token);
  if (!payload) {
    return fail(res, 401, "invalid_token", "Token is not valid.");
  }

  try {
    const { data: license, error: licenseError } = await db()
      .from("licenses")
      .select("id, key_prefix, customer_name, plan, status, max_activations, expires_at, features")
      .eq("id", payload.lic)
      .maybeSingle<LicenseRow>();

    if (licenseError) throw licenseError;

    if (!license) {
      return fail(res, 404, "invalid_key", "This license no longer exists.");
    }
    if (license.status === "revoked") {
      return fail(res, 403, "revoked", "This license has been revoked.");
    }
    if (isLicenseExpired(license)) {
      return fail(res, 403, "license_expired", "This license has expired.");
    }

    // The device must still hold a slot. If support released it to make room
    // for a replacement PC, this machine stops renewing -- which is the point.
    const { data: activation, error: activationError } = await db()
      .from("activations")
      .select("id, license_id, fingerprint, released_at")
      .eq("license_id", license.id)
      .eq("fingerprint", payload.fp)
      .maybeSingle<ActivationRow>();

    if (activationError) throw activationError;

    if (!activation || activation.released_at) {
      return fail(res, 403, "released", "This device is no longer registered to the license.");
    }

    await db()
      .from("activations")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", activation.id);

    return ok(res, {
      token: buildToken({
        licenseId: license.id,
        fingerprint: payload.fp,
        plan: license.plan,
        features: license.features ?? [],
        licenseExpiresAt: license.expires_at,
      }),
      plan: license.plan,
      expiresAt: license.expires_at,
    });
  } catch (error) {
    console.error("refresh failed", error);
    return fail(res, 500, "server_error", "Refresh failed. Please try again.");
  }
}
