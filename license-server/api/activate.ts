import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db, isLicenseExpired, type ActivationRow, type LicenseRow } from "./_lib/db.js";
import { hashKey, isPlausibleKey, keyPrefixOf } from "./_lib/keys.js";
import { buildToken } from "./_lib/token.js";
import { isRateLimited, recordAttempt } from "./_lib/throttle.js";
import { clientIp, fail, ok, readJsonBody, requireMethod, str } from "./_lib/http.js";

/**
 * POST /api/activate
 *
 * Body: { licenseKey, fingerprint, appVersion?, os? }
 * 200:  { ok: true, token, plan, expiresAt, customerName, devicesInUse, maxActivations }
 *
 * This is the ONE moment the desktop app needs the internet. It trades a key
 * plus a device fingerprint for a signed token; from then on the app verifies
 * that token offline on every launch and never calls us again (unless the
 * license is a subscription, which refreshes via /api/refresh).
 *
 * Binding a key to a fingerprint here is what makes "one key, one clinic"
 * enforceable at all -- the old fully-offline signature scheme had no way to
 * know a key had already been used somewhere else.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireMethod(req, res, "POST")) return;

  const ip = clientIp(req);
  const body = readJsonBody(req);

  const licenseKey = str(body, "licenseKey", 64);
  const fingerprint = str(body, "fingerprint", 128);
  const appVersion = str(body, "appVersion", 32);
  const os = str(body, "os", 64);

  if (!licenseKey || !fingerprint) {
    return fail(res, 400, "bad_request", "licenseKey and fingerprint are required.");
  }

  // The client sends sha256 hex; anything else is a malformed or spoofed call.
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    return fail(res, 400, "bad_request", "fingerprint must be a sha256 hex digest.");
  }

  if (await isRateLimited(ip)) {
    return fail(res, 429, "rate_limited", "Too many failed attempts. Try again shortly.");
  }

  // Reject junk before it costs a database round trip.
  if (!isPlausibleKey(licenseKey)) {
    await recordAttempt(ip, null, "malformed");
    return fail(res, 404, "invalid_key", "No such license key.");
  }

  const prefix = keyPrefixOf(licenseKey);

  try {
    // ── Look the license up by hash; the plaintext key is never stored ──
    const { data: license, error: lookupError } = await db()
      .from("licenses")
      .select("id, key_prefix, customer_name, plan, status, max_activations, expires_at, features")
      .eq("key_hash", hashKey(licenseKey))
      .maybeSingle<LicenseRow>();

    if (lookupError) throw lookupError;

    if (!license) {
      await recordAttempt(ip, prefix, "invalid_key");
      return fail(res, 404, "invalid_key", "No such license key.");
    }

    if (license.status === "revoked") {
      await recordAttempt(ip, prefix, "revoked");
      return fail(res, 403, "revoked", "This license has been revoked.");
    }

    if (isLicenseExpired(license)) {
      await recordAttempt(ip, prefix, "license_expired");
      return fail(res, 403, "license_expired", "This license has expired.");
    }

    // ── Has this exact device been here before? ──
    const { data: existing, error: existingError } = await db()
      .from("activations")
      .select("id, license_id, fingerprint, released_at")
      .eq("license_id", license.id)
      .eq("fingerprint", fingerprint)
      .maybeSingle<ActivationRow>();

    if (existingError) throw existingError;

    // Same device, still bound: reinstalling the app or clearing app data must
    // NOT burn a second slot. Hand back a fresh token and touch last_seen.
    if (existing && !existing.released_at) {
      await db()
        .from("activations")
        .update({ last_seen_at: new Date().toISOString(), app_version: appVersion, os })
        .eq("id", existing.id);

      await recordAttempt(ip, prefix, "success");
      return respond(res, license, fingerprint, await countDevices(license.id));
    }

    // ── A new (or previously released) device needs a free slot ──
    const inUse = await countDevices(license.id);
    if (inUse >= license.max_activations) {
      await recordAttempt(ip, prefix, "limit_reached");
      return fail(
        res,
        409,
        "limit_reached",
        `Key already active on ${inUse} device(s); the limit is ${license.max_activations}.`,
      );
    }

    let activationId: string;

    if (existing) {
      // Re-acquiring a slot that was released earlier -- keep the original row
      // so first_activated_at still reflects when this device first appeared.
      const { error } = await db()
        .from("activations")
        .update({
          released_at: null,
          last_seen_at: new Date().toISOString(),
          app_version: appVersion,
          os,
        })
        .eq("id", existing.id);
      if (error) throw error;
      activationId = existing.id;
    } else {
      const { data: inserted, error } = await db()
        .from("activations")
        .insert({
          license_id: license.id,
          fingerprint,
          app_version: appVersion,
          os,
        })
        .select("id")
        .single<{ id: string }>();
      if (error) throw error;
      activationId = inserted.id;
    }

    // Two devices activating at the same instant could both have passed the
    // capacity check above. Re-count now that we hold a row, and give ours back
    // if we turned out to be the one over the line.
    const settled = await countDevices(license.id);
    if (settled > license.max_activations) {
      await db()
        .from("activations")
        .update({ released_at: new Date().toISOString() })
        .eq("id", activationId);

      await recordAttempt(ip, prefix, "limit_reached");
      return fail(
        res,
        409,
        "limit_reached",
        `Key already active on ${license.max_activations} device(s).`,
      );
    }

    await recordAttempt(ip, prefix, "success");
    return respond(res, license, fingerprint, settled);
  } catch (error) {
    console.error("activate failed", error);
    return fail(res, 500, "server_error", "Activation failed. Please try again.");
  }
}

/** Active (non-released) device count for a license. */
async function countDevices(licenseId: string): Promise<number> {
  const { count, error } = await db()
    .from("activations")
    .select("id", { count: "exact", head: true })
    .eq("license_id", licenseId)
    .is("released_at", null);

  if (error) throw error;
  return count ?? 0;
}

function respond(
  res: VercelResponse,
  license: LicenseRow,
  fingerprint: string,
  devicesInUse: number,
) {
  return ok(res, {
    token: buildToken({
      licenseId: license.id,
      fingerprint,
      plan: license.plan,
      features: license.features ?? [],
      licenseExpiresAt: license.expires_at,
    }),
    plan: license.plan,
    expiresAt: license.expires_at,
    customerName: license.customer_name,
    devicesInUse,
    maxActivations: license.max_activations,
  });
}
