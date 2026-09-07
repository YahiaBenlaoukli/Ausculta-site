import { useEffect, useState } from 'react';

/**
 * Who is signed in, for screens that render differently per role.
 *
 * The main process is still the authority — every channel goes through the
 * permission check in `electron/services/permissions.ts`, and nothing here can
 * grant access. This exists so the UI can avoid *offering* what would be
 * refused, which is a different job: a button that always fails is worse than
 * no button.
 *
 * Cached at module level because `checkAuth()` verifies a JWT and reads the
 * users table, and half a dozen screens would otherwise repeat that on every
 * mount. The cache is per-session and cleared on sign-out.
 */

let cached: AuthUser | null = null;
let inflight: Promise<AuthUser | null> | null = null;

/** Call on sign-out, before navigating away, so the next session starts clean. */
export function clearCachedUser() {
    cached = null;
    inflight = null;
}

async function fetchUser(): Promise<AuthUser | null> {
    try {
        const auth = await window.ipcRenderer.checkAuth();
        cached = auth?.status === 'success' && auth.user ? auth.user : null;
    } catch {
        cached = null;
    }
    return cached;
}

export function useCurrentUser() {
    const [user, setUser] = useState<AuthUser | null>(cached);
    const [loading, setLoading] = useState(cached === null);

    useEffect(() => {
        let alive = true;
        // Held in a local so the promise survives `inflight` being cleared by
        // the settled callback below.
        const pending = inflight ?? (inflight = fetchUser().finally(() => { inflight = null; }));
        pending.then(resolved => {
            if (!alive) return;
            setUser(resolved);
            setLoading(false);
        });
        return () => { alive = false; };
    }, []);

    return {
        user,
        loading,
        /**
         * False while loading, so a screen that guards on this hides the
         * doctor-only affordance for one frame rather than flashing it at an
         * assistant and taking it away.
         */
        isDoctor: user?.role === 'doctor',
        isAssistant: user?.role === 'assistant',
    };
}
