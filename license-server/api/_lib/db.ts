import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase access with the secret (RLS-bypassing) key.
 *
 * Every table has RLS on with no policies, so this key is the only thing that
 * can read or write licenses. It must never appear in the desktop app, in the
 * repo, or in any response body.
 *
 * Supabase is replacing the legacy JWT `service_role` key with `sb_secret_…`
 * keys; the legacy ones stop working at the end of 2026. supabase-js accepts
 * either as a drop-in, so we read both names and prefer the new one.
 */

let cached: SupabaseClient | null = null;

export function secretKey(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * The Supabase dashboard displays the REST endpoint
 * (`https://xxx.supabase.co/rest/v1/`), but the client wants the bare project
 * URL and silently builds broken paths otherwise. Trim it back so either form
 * pasted into the environment works.
 */
export function projectUrl(): string | undefined {
  const raw = process.env.SUPABASE_URL?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
}

export function db(): SupabaseClient {
  if (cached) return cached;

  const url = projectUrl();
  const key = secretKey();
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY are not set.");
  }

  cached = createClient(url, key, {
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
