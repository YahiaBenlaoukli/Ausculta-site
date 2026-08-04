import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireMethod } from "./_lib/http.js";
import { secretKey } from "./_lib/db.js";

/**
 * GET /api/health
 *
 * Confirms the deployment is reachable and its environment is fully wired,
 * without revealing any secret values. Useful right after pointing
 * api.ausculta.site at Vercel, and as an uptime-monitor target.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireMethod(req, res, "GET")) return;

  const key = secretKey();

  const configured = {
    supabaseUrl: Boolean(process.env.SUPABASE_URL),
    supabaseSecretKey: Boolean(key),
    licensePrivateKey: Boolean(process.env.LICENSE_PRIVATE_KEY),
    adminToken: Boolean(process.env.ADMIN_TOKEN),
  };

  const ready = Object.values(configured).every(Boolean);

  return res.status(ready ? 200 : 503).json({
    ok: ready,
    configured,
    // Which key generation is in use -- legacy JWT keys stop working at the
    // end of 2026, so this is worth being able to check at a glance.
    keyType: !key ? null : key.startsWith("sb_secret_") ? "secret" : "legacy_service_role",
  });
}
