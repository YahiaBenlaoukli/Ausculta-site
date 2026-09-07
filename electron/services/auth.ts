import { app, safeStorage } from "electron";
import { getDatabase } from "../db/db";
import type { UserRole, UserSummary } from "../../types/user";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import { clearCurrentUser, getCurrentUser, runAs, setCurrentUser, type SessionUser } from "./session";
import { recordAudit } from "./audit";

// Load .env — the code runs from the bundled dist-electron/main.js, so
// "../.env" points at the repo root; the actual file lives in electron/.env.
// dotenv never overrides already-set vars, so trying both paths is safe.
const __authDirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__authDirname, "../electron/.env") });
dotenv.config({ path: path.join(__authDirname, "../.env") });

// Packaged installs don't ship electron/.env, so instead of a hardcoded
// fallback (which would be the same for every install and visible in the
// bundle), generate a random per-install secret once and keep it in the
// user-data dir. Tokens only ever live on this machine, so rotating the
// secret (e.g. file deleted) just means one re-login.
function resolveJwtSecret(): string {
    if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
    const secretPath = path.join(app.getPath("userData"), "jwt-secret");
    try {
        const existing = fs.readFileSync(secretPath, "utf8").trim();
        if (existing) return existing;
    } catch {
        // First run: no secret yet.
    }
    const secret = crypto.randomBytes(32).toString("hex");
    try {
        fs.writeFileSync(secretPath, secret, { mode: 0o600 });
    } catch (error) {
        console.error("Failed to persist JWT secret:", error);
    }
    return secret;
}
const JWT_SECRET = resolveJwtSecret();
const TOKEN_PATH = path.join(app.getPath("userData"), "token.enc");
let sessionToken: string | null = null;

/** Nobody has registered yet, so the login screen should offer to. */
export function needsRegistration() {
    try {
        const db = getDatabase();
        const row = db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
        return { status: "success", data: row.n === 0 };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

/**
 * Registration from the login screen. Creates the practice's DOCTOR, and only
 * ever the first account.
 *
 * The channel has to stay reachable without a session — on first launch there
 * is nobody to authorise it — so the "no accounts yet" check is what stands
 * between the login screen and anyone minting themselves full access to the
 * patient record. Assistants are created by a signed-in doctor through
 * createAssistant() instead.
 */
export async function createUser(user: { fullName: string; password: string }) {
    try {
        const db = getDatabase();
        const existing = db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
        if (existing.n > 0) {
            recordAudit('auth.register_refused', { summary: user.fullName, actorName: user.fullName });
            return {
                status: "fail",
                message: "Un compte existe déjà sur ce poste. Demandez au médecin de vous créer un accès.",
            };
        }
        return await insertUser(db, user.fullName, user.password, 'doctor');
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

/**
 * Adds a front-desk seat. Doctor only.
 *
 * The role is fixed here rather than taken as an argument: a caller that could
 * pass 'doctor' would be a caller that could create a second practice owner,
 * and there is no screen that should be able to do that.
 */
export async function createAssistant(fullName: string, password: string) {
    try {
        const actor = getCurrentUser();
        if (actor?.role !== 'doctor') {
            return { status: "fail", message: "Cette action est réservée au médecin." };
        }
        const name = fullName.trim();
        if (name.length < 2) {
            return { status: "fail", message: "Le nom doit contenir au moins 2 caractères." };
        }
        if (password.length < 6) {
            return { status: "fail", message: "Le mot de passe doit contenir au moins 6 caractères." };
        }
        const db = getDatabase();
        const created = await insertUser(db, name, password, 'assistant');
        if (created.status === "success") {
            recordAudit('user.create', { summary: `${name} (assistant)` });
        }
        return created;
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

/** Every account on this install, for the Settings list. Doctor only. */
export function listUsers() {
    try {
        if (getCurrentUser()?.role !== 'doctor') {
            return { status: "fail", message: "Cette action est réservée au médecin." };
        }
        const db = getDatabase();
        const rows = db.prepare(
            `SELECT id, full_name, role, created_at FROM users ORDER BY id ASC`
        ).all() as { id: number; full_name: string; role: string; created_at: string }[];

        const users: UserSummary[] = rows.map((row) => ({
            id: row.id,
            fullName: row.full_name,
            role: row.role === 'assistant' ? 'assistant' : 'doctor',
            createdAt: row.created_at,
        }));
        return { status: "success", data: users };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

/**
 * Removes an assistant seat.
 *
 * Refuses on doctors outright rather than "the last doctor": deleting the
 * account that owns doctor_profile cascades the profile, and every
 * appointment, consultation and prescription hangs off that row.
 */
export function deleteUser(id: number) {
    try {
        const actor = getCurrentUser();
        if (actor?.role !== 'doctor') {
            return { status: "fail", message: "Cette action est réservée au médecin." };
        }
        if (actor.id === id) {
            return { status: "fail", message: "Vous ne pouvez pas supprimer votre propre compte." };
        }
        const db = getDatabase();
        const target = db.prepare(`SELECT full_name, role FROM users WHERE id = ?`).get(id) as
            | { full_name: string; role: string }
            | undefined;
        if (!target) {
            return { status: "not_found", message: "Compte introuvable." };
        }
        if (target.role !== 'assistant') {
            return { status: "fail", message: "Le compte du médecin ne peut pas être supprimé." };
        }
        db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
        recordAudit('user.delete', { summary: target.full_name });
        return { status: "success" };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

/**
 * Sets an assistant's password without knowing the old one — this is the
 * doctor handing back access to someone who forgot theirs, not a self-service
 * change, which is why it refuses to touch a doctor account.
 */
export async function resetUserPassword(id: number, newPassword: string) {
    try {
        const actor = getCurrentUser();
        if (actor?.role !== 'doctor') {
            return { status: "fail", message: "Cette action est réservée au médecin." };
        }
        if (newPassword.length < 6) {
            return { status: "fail", message: "Le mot de passe doit contenir au moins 6 caractères." };
        }
        const db = getDatabase();
        const target = db.prepare(`SELECT full_name, role FROM users WHERE id = ?`).get(id) as
            | { full_name: string; role: string }
            | undefined;
        if (!target) {
            return { status: "not_found", message: "Compte introuvable." };
        }
        if (target.role !== 'assistant') {
            return { status: "fail", message: "Seul le mot de passe d'un assistant peut être réinitialisé ici." };
        }
        const hashed = await bcrypt.hash(newPassword, 10);
        db.prepare(`UPDATE users SET password = ? WHERE id = ?`).run(hashed, id);
        recordAudit('user.password_reset', { summary: target.full_name });
        return { status: "success" };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

/** Shared INSERT for both creation paths, so the hashing rules cannot drift. */
async function insertUser(
    db: ReturnType<typeof getDatabase>,
    fullName: string,
    password: string,
    role: UserRole,
) {
    const clash = db.prepare(`SELECT id FROM users WHERE full_name = ?`).get(fullName);
    if (clash) {
        return { status: "fail", message: "Nom d'utilisateur déjà existant" };
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = db.prepare(`
        INSERT INTO users (full_name, password, role)
        VALUES (?, ?, ?)
    `).run(fullName, hashedPassword, role);

    return {
        status: "success",
        data: {
            id: result.lastInsertRowid as number,
            fullName,
            role,
            createdAt: new Date().toISOString(),
        },
    };
}

/**
 * Checks a password and mints a token. Deliberately free of side effects.
 *
 * Split out from login() because the LAN server needs exactly this and none of
 * the rest: a request arriving from the assistant's machine must not write a
 * token to the HOST's disk or move the host's own signed-in user, which is
 * what the storage and setCurrentUser() calls in login() do. The server keeps
 * no session — it re-reads identity from the bearer token on every request.
 */
export async function authenticate(fullName: string, password: string, stayLogged: boolean) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
            SELECT * FROM users WHERE full_name = ?
        `);
        const result = stmt.get(fullName) as Record<string, unknown> | undefined;
        if (!result) {
            // actorName names the ATTEMPTED account: nobody is signed in, so
            // there is no authenticated identity to attribute this to.
            recordAudit('auth.login_failed', { summary: fullName, actorName: fullName });
            return { status: "fail", message: "Nom d'utilisateur ou mot de passe incorrect" };
        }
        const hashedPassword = result.password as string;
        const isValid = await bcrypt.compare(password, hashedPassword);
        if (!isValid) {
            recordAudit('auth.login_failed', { summary: fullName, actorName: fullName });
            return { status: "fail", message: "Nom d'utilisateur ou mot de passe incorrect" };
        }

        const user: SessionUser = {
            id: result.id as number,
            fullName: result.full_name as string,
            role: normalizeRole(result.role),
        };

        const expiresIn = stayLogged ? "365d" : "1d";
        const token = jwt.sign(user, JWT_SECRET, { expiresIn });

        // Attributed to the account that just authenticated, on either
        // transport. runAs is what makes that work on the server, where there
        // is no session yet at this point and recordAudit would otherwise file
        // the entry under nobody.
        runAs(user, () => recordAudit('auth.login', { summary: user.fullName }));

        return { status: "success", token, user };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

/**
 * Signs this seat in: authenticate, then remember it locally.
 *
 * The token storage and the process-wide current user are the local half —
 * they describe THIS machine's session, which is why a client keeps them even
 * though the password was checked on the host.
 */
export async function login(fullName: string, password: string, stayLogged: boolean) {
    const result = await authenticate(fullName, password, stayLogged);
    if (result.status !== "success" || !result.token || !result.user) return result;

    adoptSession(result.token, result.user, stayLogged);
    return result;
}

/**
 * Records a verified token as this seat's session.
 *
 * Exported because a client authenticates against the host over HTTP and then
 * has to remember the result exactly as a local login would.
 */
export function adoptSession(token: string, user: SessionUser, stayLogged: boolean) {
    if (stayLogged) {
        saveJWT(token);
        sessionToken = null;
    } else {
        deleteJWT();
        sessionToken = token;
    }
    // The main process now knows who is acting; the audit log and the
    // permission check read this rather than trusting anything the renderer
    // sends up.
    setCurrentUser(user);
}

/**
 * This seat's stored token, whichever way it was kept.
 *
 * Exported for the client transport, which has to put it in an Authorization
 * header. It cannot verify the token itself — the host signed it, and a client
 * holds no copy of that secret.
 */
export function readLocalToken(): string | null {
    if (sessionToken) return sessionToken;
    const stored = getJWT();
    return stored?.success && stored.token ? stored.token : null;
}

/** Forgets this seat's session without touching the database. */
export function clearLocalSession() {
    deleteJWT();
    sessionToken = null;
    clearCurrentUser();
}

/**
 * Verifies a bearer token and resolves who it belongs to, or null.
 *
 * The server's authentication, called on every request. The ROW decides the
 * role, never the token: a "stay logged in" token lives a year, so one minted
 * before an account was demoted would otherwise keep handing out the old
 * permissions until it expired.
 */
export function verifyToken(token: string): SessionUser | null {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { id: number; fullName: string };
        const row = getDatabase()
            .prepare(`SELECT id, full_name, role FROM users WHERE id = ?`)
            .get(decoded.id) as { id: number; full_name: string; role: string } | undefined;
        if (!row) return null;
        return { id: row.id, fullName: row.full_name, role: normalizeRole(row.role) };
    } catch {
        // Expired, tampered with, or signed by a different install's secret.
        return null;
    }
}

export function checkAuth() {
    try {
        let token: string | null = null;
        if (sessionToken) {
            token = sessionToken;
        } else {
            const stored = getJWT();
            if (stored && stored.success && stored.token) {
                token = stored.token;
            }
        }

        if (!token) {
            return { status: "fail", message: "No saved session" };
        }

        const decoded = jwt.verify(token, JWT_SECRET) as { id: number; fullName: string; role?: string };

        // Verify the user still exists in the database (handles DB reset scenarios)
        const db = getDatabase();
        const user = db.prepare(`SELECT id, role FROM users WHERE id = ?`).get(decoded.id) as
            | { id: number; role: string }
            | undefined;
        if (!user) {
            deleteJWT();
            sessionToken = null;
            clearCurrentUser();
            return { status: "fail", message: "User no longer exists" };
        }

        // The ROW decides the role, never the token. A "stay logged in" token
        // lives a year, so a token minted before the account was demoted would
        // otherwise keep handing out the old permissions until it expired.
        // Tokens issued by builds that predate roles carry none at all.
        const role = normalizeRole(user.role);

        // Restores the main-process identity after a restart, where the token
        // was loaded from disk and login() never ran.
        setCurrentUser({ id: decoded.id, fullName: decoded.fullName, role });

        return { status: "success", token, user: { id: decoded.id, fullName: decoded.fullName, role } };
    } catch (error) {
        // Token expired or invalid — clean up
        deleteJWT();
        sessionToken = null;
        clearCurrentUser();
        return { status: "fail", message: (error as Error).message };
    }
}

export function logout() {
    try {
        // Recorded before the identity is cleared, or the entry has no actor.
        recordAudit('auth.logout');
        deleteJWT();
        sessionToken = null;
        clearCurrentUser();
        return { status: "success" };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

// ─── Private helpers ─────────────────────────────────────────────

/**
 * Reads a stored role, defaulting to 'doctor'.
 *
 * Defaulting UP rather than down is deliberate, and it is what lets roles ship
 * without a migration. Every build before this one wrote the literal 'doctor'
 * into users.role and nothing read it back, so on an existing install the only
 * account there is already reads as the doctor. Defaulting to 'assistant'
 * instead would lock a practice out of its own records on upgrade — a far worse
 * outcome than the case this concedes, which is a hand-edited row.
 */
function normalizeRole(value: unknown): UserRole {
    return value === 'assistant' ? 'assistant' : 'doctor';
}

function saveJWT(token: string) {
    try {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error("OS-level encryption is unavailable.");
        }
        const encryptedBuffer = safeStorage.encryptString(token);
        fs.writeFileSync(TOKEN_PATH, encryptedBuffer);
        return { success: true };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

function getJWT(): { success: boolean; token?: string; error?: string } | null {
    try {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error("OS-level encryption is unavailable.");
        }
        if (!fs.existsSync(TOKEN_PATH)) return null;

        const buffer = fs.readFileSync(TOKEN_PATH);

        if (buffer.length === 0) {
            return { success: false, error: "No token found." };
        }

        const decrypted = safeStorage.decryptString(buffer);
        return { success: true, token: decrypted };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

function deleteJWT() {
    try {
        if (fs.existsSync(TOKEN_PATH)) {
            fs.unlinkSync(TOKEN_PATH);
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}