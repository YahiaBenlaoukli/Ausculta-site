import { app, BrowserWindow } from "electron";
import https from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CHANNEL_TABLE, isChannel } from "../ipc/registry";
import { authenticate, verifyToken } from "../services/auth";
import { checkPermission } from "../services/permissions";
import { runAs } from "../services/session";
import { getNetworkConfig, localAddresses } from "../services/networkConfig";
import { ensureHostCertificate, currentFingerprint } from "./certificate";
import { handleUpload, handleFetch } from "./files";
import type { HostInfo } from "../../types/network";

/**
 * The host's LAN server.
 *
 * Started only in host mode, and it is the same process that serves the
 * doctor's own window — deliberately, because the PDF renderer needs a
 * BrowserWindow and the database connection is synchronous and single. A
 * separate headless service would need both of those all over again.
 *
 * Three routes and nothing else:
 *
 *   GET  /health           unauthenticated; lets a client tell "reached
 *                          Ausculta" apart from "reached something"
 *   POST /auth/login       exchanges a password for a token
 *   POST /rpc/:channel     everything else, dispatched through the same
 *                          registry main.ts uses for IPC
 *
 * Concurrency is not a concern worth engineering for here. better-sqlite3 is
 * synchronous and Node is single-threaded, so a handler runs to completion
 * before the next one starts; at two seats there is no write to interleave.
 * That is what makes this cheap enough to be worth doing at all.
 */

/** Requests are small JSON; anything larger is a mistake or an attack. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

let server: https.Server | null = null;
let listening = false;

export async function startServer(win: BrowserWindow | null): Promise<{ status: "success" | "fail"; message?: string }> {
    if (server) return { status: "success" };

    const config = getNetworkConfig();
    try {
        const { cert, key } = await ensureHostCertificate();

        server = https.createServer({ cert, key }, (req, res) => {
            // Never let a thrown handler take the doctor's own app down: this
            // server runs in the same process as the window they are using.
            void handleRequest(req, res, win).catch((error) => {
                console.error("LAN server: unhandled request error:", error);
                sendJson(res, 500, { status: "fail", message: "Internal error" });
            });
        });

        await new Promise<void>((resolve, reject) => {
            server?.once("error", reject);
            // 0.0.0.0 rather than a chosen address: a clinic PC has several
            // interfaces and only the router knows which one the other seat
            // will arrive on.
            server?.listen(config.port, "0.0.0.0", () => resolve());
        });

        listening = true;
        console.log(`Ausculta host listening on ${config.port}; addresses: ${localAddresses().join(", ") || "none"}`);
        return { status: "success" };
    } catch (error) {
        server = null;
        listening = false;
        const message = (error as NodeJS.ErrnoException).code === "EADDRINUSE"
            ? `Le port ${config.port} est déjà utilisé.`
            : (error as Error).message;
        console.error("LAN server failed to start:", error);
        return { status: "fail", message };
    }
}

export function stopServer(): void {
    server?.close();
    server = null;
    listening = false;
}

/** What Settings shows on the host so the pairing details can be read off. */
export function hostInfo(): HostInfo {
    return {
        running: listening,
        port: getNetworkConfig().port,
        addresses: localAddresses(),
        fingerprint: currentFingerprint(),
    };
}

// ─── Routing ─────────────────────────────────────────────────────────────

async function handleRequest(req: IncomingMessage, res: ServerResponse, win: BrowserWindow | null): Promise<void> {
    const url = new URL(req.url ?? "/", "https://host");
    const route = url.pathname;

    if (req.method === "GET" && route === "/health") {
        // Deliberately says nothing about the practice: this answers before
        // anyone has authenticated, so it identifies the software and its
        // protocol and stops there.
        return sendJson(res, 200, { app: "ausculta", protocol: 1, version: app.getVersion() });
    }

    if (req.method === "POST" && route === "/auth/login") {
        const body = await readJsonBody(req, res);
        if (!body) return;
        const { fullName, password, stayLogged } = body as {
            fullName?: string; password?: string; stayLogged?: boolean;
        };
        if (typeof fullName !== "string" || typeof password !== "string") {
            return sendJson(res, 400, { status: "fail", message: "Requête invalide" });
        }
        const result = await authenticate(fullName, password, stayLogged === true);
        // 200 even on a bad password: the outcome is in the payload, matching
        // what the renderer already expects from every other channel.
        return sendJson(res, 200, result);
    }

    if (req.method === "GET" && route === "/auth/whoami") {
        // A client cannot verify its own token: the host signed it, and only
        // the host holds that secret. This is also where an account deleted or
        // demoted since the token was minted stops being honoured, because the
        // answer is read from the users row rather than from the token.
        const user = verifyToken(bearerToken(req) ?? "");
        if (!user) return sendJson(res, 401, { status: "fail", message: "Session expirée" });
        return sendJson(res, 200, { status: "success", user });
    }

    // Bytes rather than JSON, so these are read straight off the stream and
    // must come before any body parsing.
    if (req.method === "POST" && route === "/files/upload") {
        return handleUpload(req, res);
    }

    if (req.method === "POST" && route === "/files/fetch") {
        const body = await readJsonBody(req, res);
        if (!body) return;
        return handleFetch(req, res, body);
    }

    if (req.method === "POST" && route.startsWith("/rpc/")) {
        return handleRpc(req, res, decodeURIComponent(route.slice("/rpc/".length)), win);
    }

    sendJson(res, 404, { status: "fail", message: "Unknown route" });
}

async function handleRpc(
    req: IncomingMessage,
    res: ServerResponse,
    channel: string,
    win: BrowserWindow | null,
): Promise<void> {
    if (!isChannel(channel)) {
        return sendJson(res, 404, { status: "fail", message: `Unknown channel: ${channel}` });
    }

    const entry = CHANNEL_TABLE[channel];

    // A local channel reaching the wire is a bug in the client, not a request
    // to serve: opening a document, restarting the app or activating a licence
    // all mean "on the machine that asked", and doing them here would act on
    // the wrong computer.
    if (entry.local) {
        return sendJson(res, 400, { status: "fail", message: `Channel is local-only: ${channel}` });
    }

    const user = verifyToken(bearerToken(req) ?? "");
    const denial = checkPermission(channel, user);
    if (denial) {
        return sendJson(res, denial.code === "unauthenticated" ? 401 : 403, denial);
    }

    const body = await readJsonBody(req, res);
    if (!body) return;
    const args = Array.isArray((body as { args?: unknown }).args) ? (body as { args: unknown[] }).args : [];

    const call = entry.fn as (...callArgs: unknown[]) => unknown;
    // runAs binds the identity for this request's entire async subtree, so
    // audit entries and the field-level rules in the services attribute to the
    // caller rather than to whoever last signed in on this machine.
    const result = await runAs(user, () =>
        Promise.resolve(entry.withWindow ? call(...args, win) : call(...args)),
    );

    sendJson(res, 200, result ?? null);
}

// ─── Plumbing ────────────────────────────────────────────────────────────

function bearerToken(req: IncomingMessage): string | null {
    const header = req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
    return header.slice("Bearer ".length).trim() || null;
}

/**
 * Reads and parses a JSON body, answering the request itself on failure.
 *
 * Returns null when it has already replied, so callers `if (!body) return`.
 */
async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<unknown | null> {
    const chunks: Buffer[] = [];
    let size = 0;

    try {
        for await (const chunk of req) {
            size += (chunk as Buffer).length;
            if (size > MAX_BODY_BYTES) {
                sendJson(res, 413, { status: "fail", message: "Request too large" });
                req.destroy();
                return null;
            }
            chunks.push(chunk as Buffer);
        }
    } catch {
        sendJson(res, 400, { status: "fail", message: "Could not read the request" });
        return null;
    }

    if (chunks.length === 0) return {};

    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        sendJson(res, 400, { status: "fail", message: "Malformed JSON" });
        return null;
    }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
    // undefined is not JSON, and a service that returns nothing is common
    // enough (every void channel) that it must not become a 500.
    const body = JSON.stringify(payload ?? null);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
}
