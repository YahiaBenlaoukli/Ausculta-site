import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase access, service-role only.
 *
 * Every table has RLS on with no policies, so this key is the only thing that
 * can read or write licenses. It must never appear in the desktop app, in the
 * repo, or in any response body.
 */

let cached: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.");
  }

  cached = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export type LicenseRow = {
  id: string;
  key_prefix: string;
  customer_name: string | null;
  plan: string;
  status: string;
  max_activations: number;
  expires_at: string | null;
  features: string[];
};

export type ActivationRow = {
  id: string;
  license_id: string;
  fingerprint: string;
  released_at: string | null;
};

/** True once the subscription end date has passed. Perpetual keys never expire. */
export function isLicenseExpired(license: LicenseRow): boolean {
  if (!license.expires_at) return false;
  return new Date(license.expires_at).getTime() <= Date.now();
}
