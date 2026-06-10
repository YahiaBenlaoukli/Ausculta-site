import { app, safeStorage } from "electron";
import { getDatabase } from "../db/db";
import type { User } from "../../types/user";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Load .env from the electron directory (__dirname equivalent for ESM)
const __authDirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__authDirname, "../.env") });

const JWT_SECRET = process.env.JWT_SECRET ?? "fallback-secret-change-me";
const TOKEN_PATH = path.join(app.getPath("userData"), "token.enc");

export async function createUser(user: Omit<User, "id" | "createdAt" | "updatedAt">) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
            INSERT INTO users (full_name, password, role)
            VALUES (?, ?, ?)
        `);
        const result = stmt.run(user.fullName, user.password, user.role);
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

export function login(fullName: string, password: string, stayLogged: boolean) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
            SELECT * FROM users WHERE full_name = ? AND password = ?
        `);
        const result = stmt.get(fullName, password) as Record<string, unknown> | undefined;
        if (!result) {
            return { status: "fail", message: "Nom d'utilisateur ou mot de passe incorrect" };
        }

        const payload = {
            id: result.id,
            fullName: result.full_name,
            role: result.role,
        };

        const expiresIn = stayLogged ? "365d" : "1d";

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn });

        if (stayLogged) {
            saveJWT(token);
        }

        return { status: "success", token, user: payload };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

export function checkAuth() {
    try {
        const stored = getJWT();
        if (!stored || !stored.success || !stored.token) {
            return { status: "fail", message: "No saved session" };
        }

        const decoded = jwt.verify(stored.token, JWT_SECRET);
        return { status: "success", token: stored.token, user: decoded };
    } catch (error) {
        // Token expired or invalid — clean up
        deleteJWT();
        return { status: "fail", message: (error as Error).message };
    }
}

export function logout() {
    try {
        deleteJWT();
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