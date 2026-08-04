import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireMethod } from "./_lib/http.js";

/**
 * GET /api/health
 *
 * Confirms the deployment is reachable and its environment is fully wired,
 * without revealing any secret values. Useful right after pointing
 * api.ausculta.site at Vercel, and as an uptime-monitor target.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireMethod(req, res, "GET")) return;

  const configured = {
    supabaseUrl: Boolean(process.env.SUPABASE_URL),
    supabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    licensePrivateKey: Boolean(process.env.LICENSE_PRIVATE_KEY),
    adminToken: Boolean(process.env.ADMIN_TOKEN),
  };

  const ready = Object.values(configured).every(Boolean);

  return res.status(ready ? 200 : 503).json({ ok: ready, configured });
}
