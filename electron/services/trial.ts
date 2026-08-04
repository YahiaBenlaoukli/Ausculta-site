import { app, safeStorage } from "electron";
import { getDatabase } from "../db/db";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Trial / licensing service.
 *
 * Two separate mechanisms live here:
 *
 *   TRIAL  — 14 days, enforced entirely client-side. Ausculta is offline-first,
 *            so this can only ever be a deterrent: a determined user who edits
 *            the SQLite file or the encrypted blob gets past it. The goal is
 *            "honest clinics can't accidentally run past the trial, and casual
 *            tampering (deleting one file, nudging the clock) doesn't work".
 *
 *   LICENSE — activated ONCE against the activation server, then verified
 *            offline forever. This is what makes a key single-use: the server
 *            binds the key to a device fingerprint and refuses to hand out a
 *            token for a fourth machine. The previous fully-offline scheme
 *            could not do this — a signed key verified on every PC on earth,
 *            so one customer could pass their key around indefinitely.
 *
 * Trial defence layers:
 *   1. First-run date stored REDUNDANTLY in two places — an encrypted file
 *      (safeStorage, same mechanism as token.enc) and a row in the SQLite DB.
 *      We always trust the EARLIEST first-run date found, so deleting or
 *      resetting one store does not extend the trial.
 *   2. A rolling `lastSeen` timestamp. If the clock ever reads earlier than
 *      the last time we ran, we treat it as clock-rollback tampering and
 *      expire immediately instead of granting free days.
 *
 * License enforcement:
 *   The activation token is an Ed25519 signature over {license, fingerprint,
 *   expiry}. We verify it against the embedded public key AND check that the
 *   fingerprint still matches this machine — so copying trial.enc to another
 *   PC does not carry the license with it. The private key exists only on the
 *   server, so redirecting api.ausculta.site cannot forge one.
 */

const TRIAL_DAYS = 14;

/** Activation server. Overridable so `npm run dev` can point at a local one. */
const API_BASE_URL = process.env.AUSCULTA_API_URL || "https://api.ausculta.site";

/** Activation is the only network call; don't hang the UI if the link is bad. */
const ACTIVATION_TIMEOUT_MS = 20_000;

/**
 * Subscription tokens only (perpetual ones never expire). We start trying to
 * renew this long before expiry, and keep honouring the token this long after,
 * so a clinic that is offline for a couple of weeks is never locked out.
 */
const REFRESH_BEFORE_EXPIRY_DAYS = 7;
const EXPIRY_GRACE_DAYS = 7;

// The encrypted state file, alongside token.enc in the user-data dir.
const TRIAL_PATH = path.join(app.getPath("userData"), "trial.enc");

// ─────────────────────────────────────────────────────────────────────────
// The public half of the activation-signing keypair.
//
// Generate the pair ONCE with `node scripts/generate-license-keypair.mjs`,
// paste the public key here, and put the private key in the activation
// server's LICENSE_PRIVATE_KEY environment variable.
//
// This is not a secret — embedding it in the source is the point, and it is
// the only form that survives packaging (electron/.env is not shipped, and the
// bundled main.js resolves relative paths from dist-electron/).
// ─────────────────────────────────────────────────────────────────────────
const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAlcn6kJExPnXCViSIZI09FE1jusheXbt2uBdYvjfSghs=
-----END PUBLIC KEY-----`;

/** Payload format we mint and accept. Bumped only on a breaking change. */
const TOKEN_VERSION = 1;

type TokenPayload = {
    v: number;
    lic: string;
    fp: string;
    plan: "perpetual" | "subscription";
    iat: number;
    exp: number | null;
    feat: string[];
};

type TrialState = {
    firstRun: string;      // ISO date of first launch
    lastSeen: string;      // ISO date of most recent launch
    licensed: boolean;     // informational only — never trusted on its own
    token?: string;        // signed activation token; the real proof
    installId?: string;    // fallback device id where the OS gives us none
};

export type { TrialStatus, ActivationResult, LicenseErrorCode } from "../../types/trial";
import type { TrialStatus, ActivationResult, LicenseErrorCode } from "../../types/trial";

/**
 * Call this on every app launch (before showing the main window / routes).
 * Initializes state on first run, updates lastSeen, and reports whether the
 * app may still be used.
 */
export function getTrialStatus(): TrialStatus {
    try {
        ensureTable();
        const now = new Date();

        const fromFile = readFileState();
        const fromDb = readDbState();

        // Trust the EARLIEST first-run we can find across both stores, so wiping
        // one store (or a fresh DB) can't reset the clock while the other survives.
        const firstRunCandidates = [fromFile?.firstRun, fromDb?.firstRun]
            .filter((d): d is string => Boolean(d))
            .map((d) => new Date(d).getTime())
            .filter((t) => !Number.isNaN(t));

        const firstRunMs = firstRunCandidates.length
            ? Math.min(...firstRunCandidates)
            : now.getTime();

        // Clock-rollback detection: the latest lastSeen we've ever written.
        const lastSeenCandidates = [fromFile?.lastSeen, fromDb?.lastSeen]
            .filter((d): d is string => Boolean(d))
            .map((d) => new Date(d).getTime())
            .filter((t) => !Number.isNaN(t));
        const lastSeenMs = lastSeenCandidates.length ? Math.max(...lastSeenCandidates) : 0;

        // An activation token from either store. Unlike the old `licensed` flag,
        // this is cryptographically checked — setting a boolean in the DB by hand
        // no longer unlocks anything.
        const token = fromFile?.token ?? fromDb?.token;
        const installId = fromFile?.installId ?? fromDb?.installId ?? crypto.randomUUID();

        const verdict = token ? verifyStoredToken(token, installId) : null;

        const baseState: TrialState = {
            firstRun: new Date(firstRunMs).toISOString(),
            lastSeen: now.toISOString(),
            licensed: Boolean(verdict?.valid),
            token,
            installId,
        };

        if (verdict?.valid) {
            writeState(baseState);

            // Perpetual licenses (exp === null) never touch the network again.
            // Subscriptions renew quietly in the background, well before expiry.
            if (verdict.payload.exp !== null) {
                void maybeRefreshToken(verdict.payload, token as string, baseState);
            }

            return {
                status: "success",
                licensed: true,
                expired: false,
                // Not meaningful once licensed, but must stay a finite number —
                // Infinity turns into null through JSON serialization.
                daysRemaining: TRIAL_DAYS,
                totalDays: TRIAL_DAYS,
                plan: verdict.payload.plan,
                licenseExpiresAt: verdict.payload.exp
                    ? new Date(verdict.payload.exp * 1000).toISOString()
                    : null,
                features: verdict.payload.feat ?? [],
            };
        }

        // A token that no longer verifies (wrong machine, lapsed subscription,
        // corrupted blob) falls back to the trial rules below, but we surface
        // WHY so the user isn't just told "expired" with no explanation.
        const licenseFailure = verdict?.code;

        // Clock moved backwards vs. our last recorded run → treat as tampering.
        const tampered = lastSeenMs > 0 && now.getTime() < lastSeenMs - 60_000; // 1-min slack
        if (tampered) {
            // Don't advance lastSeen backwards; keep the higher watermark.
            baseState.lastSeen = new Date(Math.max(lastSeenMs, now.getTime())).toISOString();
            writeState(baseState);
            return {
                status: "success",
                licensed: false,
                expired: true,
                daysRemaining: 0,
                totalDays: TRIAL_DAYS,
                tampered: true,
                code: licenseFailure,
            };
        }

        writeState(baseState);

        const msElapsed = now.getTime() - firstRunMs;
        const daysElapsed = Math.floor(msElapsed / 86_400_000);
        const daysRemaining = Math.max(0, TRIAL_DAYS - daysElapsed);
        const expired = daysRemaining <= 0;

        return {
            status: "success",
            licensed: false,
            expired,
            daysRemaining,
            totalDays: TRIAL_DAYS,
            code: licenseFailure,
        };
    } catch (error) {
        // Fail OPEN or CLOSED? We fail CLOSED (expired) on unexpected errors so a
        // broken state file can't be used to unlock the app indefinitely.
        return {
            status: "fail",
            licensed: false,
            expired: true,
            daysRemaining: 0,
            totalDays: TRIAL_DAYS,
            message: (error as Error).message,
        };
    }
}

/**
 * Activate a license key against the activation server.
 *
 * This is the one operation that requires internet. The server binds the key
 * to this device's fingerprint and returns a signed token; every launch after
 * this verifies that token locally, so the clinic can go offline immediately
 * afterwards and stay that way.
 */
export async function activateLicense(licenseKey: string): Promise<ActivationResult> {
    try {
        ensureTable();

        const key = licenseKey.trim();
        if (!key) {
            return { status: "fail", code: "bad_request" };
        }

        const existing = readFileState() ?? readDbState();
        const installId = existing?.installId ?? crypto.randomUUID();
        const fingerprint = deviceFingerprint(installId);

        let response: Response;
        try {
            response = await fetch(`${API_BASE_URL}/api/activate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    licenseKey: key,
                    fingerprint,
                    appVersion: app.getVersion(),
                    os: `${process.platform} ${os.release()}`,
                }),
                signal: AbortSignal.timeout(ACTIVATION_TIMEOUT_MS),
            });
        } catch {
            // DNS failure, no route, timeout, captive portal — all the same to
            // the user: "we couldn't reach the server, check your connection".
            return { status: "fail", code: "offline" };
        }

        const body = (await response.json().catch(() => null)) as
            | {
                ok?: boolean;
                token?: string;
                code?: LicenseErrorCode;
                message?: string;
                plan?: "perpetual" | "subscription";
                customerName?: string | null;
                devicesInUse?: number;
                maxActivations?: number;
            }
            | null;

        if (!response.ok || !body?.ok || !body.token) {
            return {
                status: "fail",
                code: body?.code ?? "server_error",
                message: body?.message,
                devicesInUse: body?.devicesInUse,
                maxActivations: body?.maxActivations,
            };
        }

        // Never store a token we can't verify — that would leave the app
        // "licensed" on the strength of an unvalidated server response.
        const verdict = verifyStoredToken(body.token, installId);
        if (!verdict.valid) {
            return { status: "fail", code: verdict.code };
        }

        const now = new Date().toISOString();
        writeState({
            firstRun: existing?.firstRun ?? now,
            lastSeen: now,
            licensed: true,
            token: body.token,
            installId,
        });

        return {
            status: "success",
            plan: body.plan,
            customerName: body.customerName,
            devicesInUse: body.devicesInUse,
            maxActivations: body.maxActivations,
        };
    } catch (error) {
        return { status: "fail", code: "server_error", message: (error as Error).message };
    }
}

// ─── Token verification ──────────────────────────────────────────────────

type Verdict =
    | { valid: true; payload: TokenPayload }
    | { valid: false; code: LicenseErrorCode };

/**
 * Offline check performed on every launch.
 *
 * Three things must hold: the signature is ours, the token names THIS machine,
 * and (for subscriptions) it hasn't lapsed beyond the grace period.
 */
function verifyStoredToken(token: string, installId: string): Verdict {
    try {
        const [payloadB64, sigB64] = token.split(".");
        if (!payloadB64 || !sigB64) return { valid: false, code: "invalid_token" };

        const payloadBytes = Buffer.from(payloadB64, "base64url");
        const signature = Buffer.from(sigB64, "base64url");

        // Ed25519: pass null algorithm to crypto.verify.
        if (!crypto.verify(null, payloadBytes, LICENSE_PUBLIC_KEY_PEM, signature)) {
            return { valid: false, code: "invalid_token" };
        }

        const payload = JSON.parse(payloadBytes.toString()) as TokenPayload;
        if (payload.v !== TOKEN_VERSION) return { valid: false, code: "invalid_token" };

        // The binding that makes a key single-use: a token lifted from another
        // machine's trial.enc carries that machine's fingerprint, not ours.
        if (payload.fp !== deviceFingerprint(installId)) {
            return { valid: false, code: "device_mismatch" };
        }

        if (payload.exp !== null) {
            const graceEnd = (payload.exp + EXPIRY_GRACE_DAYS * 86_400) * 1000;
            if (Date.now() > graceEnd) return { valid: false, code: "license_expired" };
        }

        return { valid: true, payload };
    } catch {
        return { valid: false, code: "invalid_token" };
    }
}

/**
 * Renews a subscription token in the background.
 *
 * Deliberately fire-and-forget: startup must never wait on the network, and a
 * failed renewal is harmless until the grace period runs out. Perpetual
 * licenses never call this.
 */
async function maybeRefreshToken(
    payload: TokenPayload,
    token: string,
    state: TrialState,
): Promise<void> {
    try {
        if (payload.exp === null) return;

        const refreshFrom = (payload.exp - REFRESH_BEFORE_EXPIRY_DAYS * 86_400) * 1000;
        if (Date.now() < refreshFrom) return;

        const response = await fetch(`${API_BASE_URL}/api/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
            signal: AbortSignal.timeout(ACTIVATION_TIMEOUT_MS),
        });

        const body = (await response.json().catch(() => null)) as
            | { ok?: boolean; token?: string }
            | null;

        if (!response.ok || !body?.ok || !body.token) return;

        const verdict = verifyStoredToken(body.token, state.installId ?? "");
        if (!verdict.valid) return;

        writeState({ ...state, token: body.token, licensed: true });
    } catch {
        // Offline, server down, revoked — all handled by the grace period.
    }
}

// ─── Device fingerprint ──────────────────────────────────────────────────

/**
 * A stable per-machine identifier, hashed so we never send raw hardware ids.
 *
 * We deliberately derive this from the OS, not from a value we generate and
 * store: an id we persisted ourselves would travel with a copied trial.enc and
 * defeat the whole point. The OS id survives reinstalling Ausculta (so
 * reinstalling costs the customer no activation slot) and changes when Windows
 * itself is reinstalled (which is what the 3-device allowance absorbs).
 *
 * `installId` is only a last resort for platforms that give us nothing.
 */
function deviceFingerprint(installId: string): string {
    const machineId = readMachineId() ?? `install:${installId}`;
    return crypto.createHash("sha256").update(`ausculta-v1:${machineId}`).digest("hex");
}

function readMachineId(): string | null {
    try {
        if (process.platform === "win32") {
            // MachineGuid is written by Windows at install time and is stable
            // for the life of the OS installation.
            const output = execFileSync(
                "reg",
                [
                    "query",
                    "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
                    "/v",
                    "MachineGuid",
                ],
                { encoding: "utf8", windowsHide: true, timeout: 5_000 },
            );
            const match = output.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
            return match?.[1]?.toLowerCase() ?? null;
        }

        if (process.platform === "darwin") {
            const output = execFileSync(
                "ioreg",
                ["-rd1", "-c", "IOPlatformExpertDevice"],
                { encoding: "utf8", timeout: 5_000 },
            );
            const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
            return match?.[1]?.toLowerCase() ?? null;
        }

        for (const file of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
            if (fs.existsSync(file)) {
                const value = fs.readFileSync(file, "utf8").trim();
                if (value) return value.toLowerCase();
            }
        }
        return null;
    } catch {
        return null;
    }
}

// ─── Redundant persistence: encrypted file ───────────────────────────────

function readFileState(): TrialState | null {
    try {
        if (!fs.existsSync(TRIAL_PATH)) return null;
        if (!safeStorage.isEncryptionAvailable()) return null;
        const buffer = fs.readFileSync(TRIAL_PATH);
        if (buffer.length === 0) return null;
        const json = safeStorage.decryptString(buffer);
        return JSON.parse(json) as TrialState;
    } catch {
        return null;
    }
}

function writeFileState(state: TrialState): void {
    try {
        if (!safeStorage.isEncryptionAvailable()) return;
        const encrypted = safeStorage.encryptString(JSON.stringify(state));
        fs.writeFileSync(TRIAL_PATH, encrypted);
    } catch {
        // Best-effort; the DB copy is the fallback.
    }
}

// ─── Redundant persistence: SQLite key/value ─────────────────────────────

function ensureTable(): void {
    // Best-effort: the DB store is one of two redundant copies. If the DB is
    // unavailable for any reason, the encrypted-file store still enforces the
    // trial — failing here must NOT abort the whole check (which would
    // wrongly show "expired" to a legitimate user, since getTrialStatus
    // fails closed on unexpected errors).
    try {
        const db = getDatabase();
        db.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    } catch {
        // readDbState/writeDbState each degrade gracefully on their own.
    }
}

function readDbState(): TrialState | null {
    try {
        const db = getDatabase();
        const row = db.prepare(`SELECT value FROM app_meta WHERE key = 'trial'`).get() as
            | { value: string }
            | undefined;
        if (!row) return null;
        return JSON.parse(row.value) as TrialState;
    } catch {
        return null;
    }
}

function writeDbState(state: TrialState): void {
    try {
        const db = getDatabase();
        db.prepare(
            `INSERT INTO app_meta (key, value) VALUES ('trial', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        ).run(JSON.stringify(state));
    } catch {
        // Best-effort; the file copy is the fallback.
    }
}

function writeState(state: TrialState): void {
    writeFileState(state);
    writeDbState(state);
}
