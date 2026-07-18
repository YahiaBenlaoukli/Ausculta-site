import { app, safeStorage } from "electron";
import { getDatabase } from "../db/db";
import type { User } from "../../types/user";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import bcrypt from "bcrypt";

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

export async function createUser(user: Omit<User, "id" | "createdAt" | "updatedAt">) {
    try {
        const db = getDatabase();
        const stmt1 = db.prepare(`
            SELECT * FROM users WHERE full_name = ?
        `);
        const result1 = stmt1.get(user.fullName) as Record<string, unknown> | undefined;
        if (result1) {
            return { status: "fail", message: "Nom d'utilisateur déjà existant" };
        }
        const hashedPassword = await bcrypt.hash(user.password, 10);
        // users.role is a vestige of a multi-user design: the app has one user
        // (the doctor), and nothing reads the column. It stays NOT NULL in DBs
        // created by older builds, so keep writing a constant instead of
        // migrating every existing install.
        const stmt2 = db.prepare(`
            INSERT INTO users (full_name, password, role)
            VALUES (?, ?, 'doctor')
        `);
        const result = stmt2.run(user.fullName, hashedPassword);
        return {
            status: "success",
            data: {
                ...user,
                id: result.lastInsertRowid as number,
                createdAt: new Date().toISOString(),
            },
        };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

export async function login(fullName: string, password: string, stayLogged: boolean) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
            SELECT * FROM users WHERE full_name = ?
        `);
        const result = stmt.get(fullName) as Record<string, unknown> | undefined;
        if (!result) {
            return { status: "fail", message: "Nom d'utilisateur ou mot de passe incorrect" };
        }
        const hashedPassword = result.password as string;
        const isValid = await bcrypt.compare(password, hashedPassword);
        if (!isValid) {
            return { status: "fail", message: "Nom d'utilisateur ou mot de passe incorrect" };
        }

        const payload = {
            id: result.id,
            fullName: result.full_name,
        };

        const expiresIn = stayLogged ? "365d" : "1d";

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn });

        if (stayLogged) {
            saveJWT(token);
            sessionToken = null;
        } else {
            deleteJWT();
            sessionToken = token;
        }

        return { status: "success", token, user: payload };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
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

        const decoded = jwt.verify(token, JWT_SECRET) as { id: number; fullName: string };

        // Verify the user still exists in the database (handles DB reset scenarios)
        const db = getDatabase();
        const user = db.prepare(`SELECT id FROM users WHERE id = ?`).get(decoded.id);
        if (!user) {
            deleteJWT();
            sessionToken = null;
            return { status: "fail", message: "User no longer exists" };
        }

        return { status: "success", token, user: decoded };
    } catch (error) {
        // Token expired or invalid — clean up
        deleteJWT();
        sessionToken = null;
        return { status: "fail", message: (error as Error).message };
    }
}

export function logout() {
    try {
        deleteJWT();
        sessionToken = null;
        return { status: "success" };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

// ─── Private helpers ─────────────────────────────────────────────

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