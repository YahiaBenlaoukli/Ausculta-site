// Who is currently signed in, as far as the MAIN process is concerned.
//
// This exists because ipcMain.handle receives arguments, not an identity: a
// handler has no idea who called it. The audit log cannot trust a user id sent
// up from the renderer — anything the renderer can set, a bug (or a tampered
// build) can set to someone else, which makes the log worthless as a record of
// who did what. So auth.ts records the authenticated user here, in the main
// process, and audit.ts reads it from here only.
//
// Deliberately module-level state rather than a table: a session is not data,
// it is a property of this running process, and it must not survive a restart.

export interface SessionUser {
    id: number;
    fullName: string;
}

let currentUser: SessionUser | null = null;

/** Called by auth.ts after a password check or a valid token has been verified. */
export function setCurrentUser(user: SessionUser | null) {
    currentUser = user;
}

export function clearCurrentUser() {
    currentUser = null;
}

export function getCurrentUser(): SessionUser | null {
    return currentUser;
}
