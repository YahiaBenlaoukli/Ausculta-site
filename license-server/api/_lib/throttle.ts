import { db } from "./db.js";

/**
 * Per-IP throttling for /activate.
 *
 * Keys carry 80 bits of entropy, so guessing one is not a realistic attack --
 * this exists to stop somebody hammering the endpoint with a stolen key list
 * and to keep the Supabase free tier from being burned by a loop.
 *
 * Only FAILED attempts count. A clinic legitimately reactivating several
 * machines from one waiting-room router is never punished for succeeding.
 */

const WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_WINDOW = 20;

export async function isRateLimited(ip: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

    const { count, error } = await db()
      .from("activation_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .neq("outcome", "success")
      .gte("created_at", since);

    if (error) return false;
    return (count ?? 0) >= MAX_FAILURES_PER_WINDOW;
  } catch {
    // Throttling is a safety net, not a gate. If the bookkeeping query fails
    // we let the request through -- the endpoint's own checks still apply, and
    // locking out paying customers over a logging hiccup is the worse outcome.
    return false;
  }
}

/** Fire-and-forget attempt log. Never blocks or fails the actual request. */
export async function recordAttempt(
  ip: string,
  keyPrefix: string | null,
  outcome: string,
): Promise<void> {
  try {
    await db()
      .from("activation_attempts")
      .insert({ ip, key_prefix: keyPrefix, outcome });
  } catch {
    // Ignored on purpose.
  }
}
