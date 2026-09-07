import { app } from "electron";
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NetworkConfig, NetworkMode, QueueDisplayNameMode } from "../../types/network";

/**
 * Where this seat looks for the practice's data.
 *
 * Deliberately a JSON file rather than a row in app_meta, which is where the
 * rest of the app's settings live: a client has no database to read a setting
 * out of, and "which database do I use" cannot itself be stored in one.
 *
 * Read once and cached. The mode decides whether initializeDatabase() runs at
 * all, so it is needed before anything else exists, and changing it requires a
 * restart anyway — there is no coherent way to swap a process from owning a
 * database to proxying one while screens are open.
 */

const CONFIG_PATH = () => path.join(app.getPath("userData"), "network.json");

/** The default is what every existing install already is. */
const DEFAULTS: NetworkConfig = {
    mode: "standalone",
    hostAddress: "",
    port: 7317,
    pinnedCertificate: null,
    printerName: null,
    queueDisplayEnabled: false,
    queueDisplayId: null,
    queueDisplayNameMode: "full",
};

let cached: NetworkConfig | null = null;

export function getNetworkConfig(): NetworkConfig {
    if (cached) return cached;
    cached = readConfig();
    return cached;
}

/**
 * Persists a change. Takes effect on the next launch, and the caller is
 * expected to say so — nothing here restarts the app.
 */
export function setNetworkConfig(patch: Partial<NetworkConfig>): { status: "success" | "fail"; data?: NetworkConfig; message?: string } {
    try {
        const next = sanitize({ ...getNetworkConfig(), ...patch });
        fs.writeFileSync(CONFIG_PATH(), JSON.stringify(next, null, 2), { mode: 0o600 });
        cached = next;
        return { status: "success", data: next };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

/** True when this process owns the database — i.e. must open and migrate it. */
export function ownsDatabase(): boolean {
    return getNetworkConfig().mode !== "client";
}

/**
 * Every non-internal IPv4 address of this machine.
 *
 * Shown in Settings on the host so the doctor can read one off and type it
 * into the client. A clinic PC routinely has several — Ethernet, Wi-Fi, and
 * whatever a VPN or Hyper-V left behind — and only the person looking at the
 * router knows which is the right one, so all of them are offered rather than
 * one being guessed at.
 */
export function localAddresses(): string[] {
    const found: string[] = [];
    for (const entries of Object.values(os.networkInterfaces())) {
        for (const entry of entries ?? []) {
            if (entry.family === "IPv4" && !entry.internal) found.push(entry.address);
        }
    }
    return found;
}

// ─── Private ─────────────────────────────────────────────────────────────

function readConfig(): NetworkConfig {
    try {
        const raw = fs.readFileSync(CONFIG_PATH(), "utf8");
        return sanitize({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<NetworkConfig>) });
    } catch {
        // Missing (the normal case — nobody has opened Settings) or corrupt.
        // Either way standalone is the safe reading: it is what the install
        // already does, and it never reaches for a network.
        return { ...DEFAULTS };
    }
}

/**
 * Forces the file's contents into something the rest of the code can rely on.
 *
 * This file is plain JSON in the user's own directory, so it is editable by
 * hand and by anything else running as that user. Nothing catastrophic hangs
 * off it, but a NaN port or a mode of "hsot" should degrade to standalone
 * rather than throw somewhere far away at startup.
 */
function sanitize(config: NetworkConfig): NetworkConfig {
    const modes: NetworkMode[] = ["standalone", "host", "client"];
    const nameModes: QueueDisplayNameMode[] = ["full", "initial", "number"];
    const mode = modes.includes(config.mode) ? config.mode : "standalone";
    const port = Number.isInteger(config.port) && config.port > 0 && config.port < 65536
        ? config.port
        : DEFAULTS.port;

    return {
        mode,
        // A client with no address configured cannot reach anything, so treat
        // it as an install that has not finished being set up.
        hostAddress: typeof config.hostAddress === "string" ? config.hostAddress.trim() : "",
        port,
        pinnedCertificate: typeof config.pinnedCertificate === "string" && config.pinnedCertificate.includes("BEGIN CERTIFICATE")
            ? config.pinnedCertificate
            : null,
        printerName: typeof config.printerName === "string" && config.printerName.trim()
            ? config.printerName.trim()
            : null,

        // Note for anyone adding a field: this function returns an explicit
        // object literal, so a key that is not named here is DROPPED on the next
        // save of any other setting — silently, and long after the code that set
        // it looked correct.
        queueDisplayEnabled: config.queueDisplayEnabled === true,
        queueDisplayId: Number.isInteger(config.queueDisplayId) ? config.queueDisplayId : null,
        queueDisplayNameMode: nameModes.includes(config.queueDisplayNameMode)
            ? config.queueDisplayNameMode
            : "full",
    };
}

/**
 * The fingerprint of the pinned certificate, for display beside the host's.
 *
 * Derived rather than stored: two copies of the same fact drift, and the
 * certificate is the one the connection actually verifies against.
 */
export function pinnedFingerprint(): string | null {
    const pem = getNetworkConfig().pinnedCertificate;
    if (!pem) return null;
    try {
        return new X509Certificate(pem).fingerprint256;
    } catch {
        return null;
    }
}
