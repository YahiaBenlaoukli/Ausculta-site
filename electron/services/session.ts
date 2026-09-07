// Who is currently signed in, as far as the MAIN process is concerned.
//
// This exists because ipcMain.handle receives arguments, not an identity: a
// handler has no idea who called it. The audit log cannot trust a user id sent
// up from the renderer — anything the renderer can set, a bug (or a tampered
// build) can set to someone else, which makes the log worthless as a record of
// who did what. So auth.ts records the authenticated user here, in the main
// process, and audit.ts reads it from here only.
//
// permissions.ts reads it for the same reason: a role sent up from the renderer
// would be a role the renderer could choose.
//
// Deliberately module-level state rather than a table: a session is not data,
// it is a property of this running process, and it must not survive a restart.
//
// ── Two callers, two lifetimes ──────────────────────────────────────────────
//
// That module-level identity is exactly right for IPC: one Electron process
// serves one window and one signed-in person, so "who is acting" is a property
// of the process and setting it once at login is correct.
//
// It is exactly wrong for the LAN server, which handles requests from another
// machine, interleaved with the doctor's own work, each carrying its own token.
// A single variable there would let the assistant's request decide what the
// doctor's next audit entry is attributed to.
//
// AsyncLocalStorage resolves that without touching a single caller. The server
// wraps each request in runAs(); the store follows the whole async chain
// underneath it, so every getCurrentUser() reached from that request sees that
// request's user, and everything else keeps reading the process-wide one.
// audit.ts, permissions.ts and consultations.ts needed no changes for this.

import { AsyncLocalStorage } from "node:async_hooks";
import type { UserRole } from "../../types/user";

export interface SessionUser {
    id: number;
    fullName: string;
    role: UserRole;
}

let currentUser: SessionUser | null = null;

const requestUser = new AsyncLocalStorage<SessionUser | null>();

/** Called by auth.ts after a password check or a valid token has been verified. */
export function setCurrentUser(user: SessionUser | null) {
    currentUser = user;
}

export function clearCurrentUser() {
    currentUser = null;
}

export function getCurrentUser(): SessionUser | null {
    // undefined means "no request scope on this stack", which is not the same
    // as a request that authenticated to nobody — that is a real null, and it
    // must NOT fall through to the process-wide user. Getting this comparison
    // wrong is how an unauthenticated request would inherit the doctor's seat.
    const scoped = requestUser.getStore();
    return scoped !== undefined ? scoped : currentUser;
}

/**
 * Runs `fn` with `user` as the current user for its entire async subtree.
 *
 * Used by the LAN server, once per request. Returns whatever `fn` returns,
 * promise included — the store stays bound across every await inside it.
 */
export function runAs<T>(user: SessionUser | null, fn: () => T): T {
    return requestUser.run(user, fn);
}
