import { BrowserWindow, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import tls from "node:tls";
import type { Readable } from "node:stream";
import type { ConnectionErrorCode, ConnectionTest, HostStatus } from "../../types/network";
import { getNetworkConfig, setNetworkConfig } from "../services/networkConfig";
import { adoptSession, clearLocalSession, readLocalToken } from "../services/auth";
import { clientCacheDir, encodeUploadMeta, type UploadMeta } from "../server/files";
import { printLocalFile, type PrintResult } from "../services/printing";
import type { SessionUser } from "../services/session";

/**
 * The client half of the LAN link.
 *
 * A client runs the identical application with no database of its own: every
 * channel that is not marked `local` in the registry is answered by asking the
 * host over HTTPS instead of by calling the service directly. Nothing above
 * this file changes — preload.ts, electron-env.d.ts and every screen in the
 * renderer are the same code the host runs.
 *
 * ── Why the certificate is handed to Node rather than checked by hand ──
 *
 * The host is self-signed, so no authority vouches for it and its hostname
 * means nothing. The obvious move is to compare a fingerprint after
 * connecting, but `checkServerIdentity` is never called when
 * `rejectUnauthorized` is false, and inspecting the socket afterwards means
 * the request has already been written to whoever answered — including, on the
 * login route, a password.
 *
 * So the pinned certificate is passed as the `ca`: a self-signed certificate
 * is its own authority, so Node's own verification rejects anything else
 * during the handshake, before a byte of ours is sent. Hostname checking is
 * the one part switched off, because the host is reached by whatever LAN
 * address the router gave it.
 */

/** A clinic LAN is fast or broken; anything slower than this is broken. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Pairing includes a TLS handshake with a machine that may be asleep. */
const PAIRING_TIMEOUT_MS = 8_000;
/** A scan crossing a domestic router deserves more room than an RPC call. */
const UPLOAD_TIMEOUT_MS = 120_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

let lastReachable: boolean | null = null;
let statusWindow: BrowserWindow | null = null;

/** Lets this module tell the renderer when the host comes and goes. */
export function setStatusWindow(win: BrowserWindow | null) {
    statusWindow = win;
}

export interface RemoteFailure {
    status: "fail";
    code: ConnectionErrorCode;
    message: string;
}

/**
 * Calls one channel on the host.
 *
 * Resolves rather than rejects on a network failure: every caller above this
 * is renderer code that branches on `.status`, and a rejected IPC call would
 * surface as an unhandled error in a screen that has a perfectly good way to
 * say "the host is unreachable".
 */
export async function callRemote(channel: string, args: unknown[], fallback?: unknown): Promise<unknown> {
    try {
        const { body } = await hostRequest("POST", `/rpc/${encodeURIComponent(channel)}`, {
            body: { args },
            token: readLocalToken() ?? undefined,
        });
        reportReachable(true);
        return body;
    } catch (error) {
        const code = errorCode(error);
        reportReachable(false, code);

        // A channel whose callers guard with Array.isArray or read a count
        // gets the empty answer it can render; everything else gets a failure
        // it can show. Writes deliberately have no fallback — silently
        // resolving one as "fine" would tell the user their edit was saved.
        if (fallback !== undefined) return fallback;
        return { status: "fail", code, message: failureMessage(code) } satisfies RemoteFailure;
    }
}

/**
 * Signs in against the host, then remembers the session locally.
 *
 * The client cannot check a password — the users table is on the host — but
 * the resulting token belongs to this seat, so it is stored here exactly as a
 * standalone login would store it.
 */
export async function remoteLogin(fullName: string, password: string, stayLogged: boolean) {
    try {
        const { body } = await hostRequest("POST", "/auth/login", {
            body: { fullName, password, stayLogged },
            timeout: PAIRING_TIMEOUT_MS,
        });
        reportReachable(true);

        const result = body as { status?: string; token?: string; user?: SessionUser; message?: string };
        if (result?.status !== "success" || !result.token || !result.user) {
            return result ?? { status: "fail", message: "Réponse inattendue de l'hôte." };
        }
        adoptSession(result.token, result.user, stayLogged);
        return result;
    } catch (error) {
        const code = errorCode(error);
        reportReachable(false, code);
        return { status: "fail", code, message: failureMessage(code) };
    }
}

/**
 * Re-establishes this seat's session on launch.
 *
 * The host signed the token, so only the host can verify it — a client has no
 * copy of the signing secret and must not pretend to. That also makes this the
 * right place to notice an account that has been deleted or demoted since.
 */
export async function remoteCheckAuth() {
    const token = readLocalToken();
    if (!token) return { status: "fail", message: "No saved session" };

    try {
        const { body } = await hostRequest("GET", "/auth/whoami", { token });
        reportReachable(true);
        const result = body as { status?: string; user?: SessionUser };
        if (result?.status !== "success" || !result.user) {
            clearLocalSession();
            return { status: "fail", message: "Session refusée par l'hôte." };
        }
        // stayLogged false: re-adopting must not promote a session-only token
        // into a stored one just because the app restarted.
        adoptSession(token, result.user, false);
        return { status: "success", token, user: result.user };
    } catch (error) {
        const code = errorCode(error);
        reportReachable(false, code);
        return { status: "fail", code, message: failureMessage(code) };
    }
}

/** Ends this seat's session. Tokens are stateless, so the host needs no telling. */
export function remoteLogout() {
    clearLocalSession();
    return { status: "success" };
}

/**
 * Reaches the host and, on a first successful contact, pairs with it.
 *
 * Pairing keeps the certificate the host presented. Both screens show its
 * fingerprint so a cautious doctor can compare them; the honest description of
 * this step is that the first connection is trusted, and every one after it is
 * verified against what that first connection saw.
 */
export async function testHostConnection(): Promise<ConnectionTest> {
    const config = getNetworkConfig();
    if (!config.hostAddress) {
        return { status: "fail", code: "unreachable", message: "Aucune adresse d'hôte configurée." };
    }

    try {
        const { body, certificate } = await hostRequest("GET", "/health", { timeout: PAIRING_TIMEOUT_MS });
        const health = body as { app?: string; version?: string };
        if (health?.app !== "ausculta") {
            return { status: "fail", code: "not_ausculta", message: "Ce port répond, mais ce n'est pas un hôte Ausculta." };
        }

        let paired = false;
        if (!config.pinnedCertificate && certificate) {
            setNetworkConfig({ pinnedCertificate: certificate.pem });
            paired = true;
        }

        reportReachable(true);
        return {
            status: "success",
            paired,
            fingerprint: certificate?.fingerprint,
            appVersion: health.version,
        };
    } catch (error) {
        const code = errorCode(error);
        reportReachable(false, code);
        return { status: "fail", code, message: failureMessage(code) };
    }
}

/** Forgets the paired host certificate, so the next test pairs afresh. */
export function unpairHost() {
    setNetworkConfig({ pinnedCertificate: null });
    return { status: "success" };
}

// ─── Files ───────────────────────────────────────────────────────────────

/**
 * Sends a file the desk picked to the host, which files it.
 *
 * uploadDocument copies from `document.localPath`, which on a client names a
 * file on the WRONG machine. So the bytes travel and the host stages them
 * under a path of its own before handing them to the same service a local
 * upload would reach.
 */
export async function remoteUploadDocument(document: UploadMeta): Promise<unknown> {
    try {
        const stream = fs.createReadStream(document.localPath);
        const size = (await fs.promises.stat(document.localPath)).size;

        const { body } = await hostRequest("POST", "/files/upload", {
            token: readLocalToken() ?? undefined,
            stream,
            streamLength: size,
            headers: {
                "Content-Type": "application/octet-stream",
                // localPath is stripped: it describes this machine's disk and
                // means nothing on the host, which stages its own copy.
                "X-Ausculta-Document": encodeUploadMeta({ ...document, localPath: "" }),
            },
            timeout: UPLOAD_TIMEOUT_MS,
        });
        reportReachable(true);
        return body;
    } catch (error) {
        const code = errorCode(error);
        reportReachable(false, code);
        // uploadDocument's contract is to throw on failure — the upload UI and
        // the PDF pipeline both rely on that — so this must not resolve to a
        // failure object that reads as a filed document.
        throw new Error(failureMessage(code));
    }
}

/**
 * Opens a document, wherever it actually lives.
 *
 * The renderer opens everything by path, and on a client those paths name
 * files on the host. Rather than change a dozen call sites, this tries the
 * local disk first — which covers a standalone install, and a copy already
 * fetched — and otherwise asks the host for the bytes and opens the copy.
 *
 * The copy is read-only in the sense that matters: nothing writes back from
 * it. Annotating a fetched document changes the temporary file and not the
 * patient's record.
 */
export async function remoteOpenDocument(filePath: string): Promise<string> {
    const copy = await ensureLocalCopy(filePath);
    // openDocument's contract is a string: empty means it opened, anything else
    // is the reason it did not.
    if (copy.status !== "success") return copy.message;
    return shell.openPath(copy.path);
}

/** Prints a host document at this seat, fetching it first. */
export async function remotePrintDocument(filePath: string): Promise<PrintResult> {
    const copy = await ensureLocalCopy(filePath);
    if (copy.status !== "success") return { status: "fail", message: copy.message };
    return printLocalFile(copy.path);
}

type LocalCopy = { status: "success"; path: string } | { status: "fail"; message: string };

/**
 * Makes sure a document named by a host path exists on this machine.
 *
 * Tries the local disk first, which covers a standalone install, the host
 * itself, and a copy fetched earlier in this session. Otherwise asks the host
 * for the bytes.
 */
async function ensureLocalCopy(filePath: string): Promise<LocalCopy> {
    if (typeof filePath !== "string" || !filePath) {
        return { status: "fail", message: "Chemin de document invalide" };
    }
    if (fs.existsSync(filePath)) return { status: "success", path: filePath };

    try {
        const { status, buffer, filename } = await hostRequestBinary("/files/fetch", { path: filePath });
        if (status === 404) {
            return { status: "fail", message: "Ce document est introuvable sur le poste principal." };
        }
        if (status !== 200 || !buffer) return { status: "fail", message: failureMessage("server_error") };

        reportReachable(true);
        await fs.promises.mkdir(clientCacheDir(), { recursive: true });
        const local = path.join(clientCacheDir(), filename || path.basename(filePath));
        await fs.promises.writeFile(local, buffer);
        return { status: "success", path: local };
    } catch (error) {
        const code = errorCode(error);
        reportReachable(false, code);
        return { status: "fail", message: failureMessage(code) };
    }
}

// ─── Transport ───────────────────────────────────────────────────────────

interface HostReply {
    status: number;
    body: unknown;
    certificate?: { pem: string; fingerprint: string };
}

class PinMismatchError extends Error {
    code = "fingerprint_mismatch" as const;
}
class NotAuscultaError extends Error {
    code = "not_ausculta" as const;
}

interface RequestOptions {
    body?: unknown;
    token?: string;
    timeout?: number;
    /** Raw bytes instead of a JSON body — used by the upload route. */
    stream?: Readable;
    streamLength?: number;
    headers?: Record<string, string>;
}

function hostRequest(method: "GET" | "POST", route: string, options: RequestOptions = {}): Promise<HostReply> {
    const config = getNetworkConfig();
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);

    return new Promise<HostReply>((resolve, reject) => {
        const headers: Record<string, string> = { ...options.headers };
        if (options.token) headers.Authorization = `Bearer ${options.token}`;
        if (payload !== undefined) {
            headers["Content-Type"] = "application/json";
            headers["Content-Length"] = String(Buffer.byteLength(payload));
        }
        if (options.streamLength !== undefined) {
            headers["Content-Length"] = String(options.streamLength);
        }

        const request = https.request(
            {
                host: config.hostAddress,
                port: config.port,
                path: route,
                method,
                headers,
                // The pinned certificate is the authority. Before pairing there
                // is none, and the connection is knowingly unverified — that is
                // the one request where the certificate is being collected
                // rather than checked, and it carries no credentials.
                ca: config.pinnedCertificate ? [config.pinnedCertificate] : undefined,
                rejectUnauthorized: Boolean(config.pinnedCertificate),
                // The host answers on whatever address the router handed it, so
                // there is no name to match. Identity comes from `ca` above.
                checkServerIdentity: () => undefined,
            },
            (response) => {
                const socket = response.socket as tls.TLSSocket;
                const peer = typeof socket.getPeerX509Certificate === "function"
                    ? socket.getPeerX509Certificate()
                    : undefined;

                const chunks: Buffer[] = [];
                response.on("data", (chunk: Buffer) => chunks.push(chunk));
                response.on("end", () => {
                    const text = Buffer.concat(chunks).toString("utf8");
                    let body: unknown;
                    try {
                        body = text ? JSON.parse(text) : null;
                    } catch {
                        // Something answered on this port and it is not us.
                        reject(new NotAuscultaError("Non-JSON response"));
                        return;
                    }
                    resolve({
                        status: response.statusCode ?? 0,
                        body,
                        certificate: peer ? { pem: peer.toString(), fingerprint: peer.fingerprint256 } : undefined,
                    });
                });
            },
        );

        request.setTimeout(options.timeout ?? REQUEST_TIMEOUT_MS, () => {
            request.destroy(new Error("timeout"));
        });
        request.on("error", (error: NodeJS.ErrnoException) => {
            // Node reports a rejected pin as a generic certificate error; name
            // it here so the UI can say "this is not the machine you paired
            // with" instead of something about self-signed certificates.
            if (error.code === "SELF_SIGNED_CERT_IN_CHAIN" ||
                error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
                error.code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
                error.code === "CERT_SIGNATURE_FAILURE" ||
                error.code === "ERR_TLS_CERT_ALTNAME_INVALID") {
                reject(new PinMismatchError(error.message));
                return;
            }
            reject(error);
        });

        if (options.stream) {
            options.stream.on("error", (error) => request.destroy(error));
            options.stream.pipe(request);
        } else {
            if (payload !== undefined) request.write(payload);
            request.end();
        }
    });
}

/**
 * Like hostRequest, but keeps the response as bytes.
 *
 * Separate rather than a flag, because everything else about the two is the
 * same except the one thing that matters: this one must not try to parse a PDF
 * as JSON.
 */
function hostRequestBinary(
    route: string,
    body: unknown,
): Promise<{ status: number; buffer?: Buffer; filename?: string }> {
    const config = getNetworkConfig();
    const payload = JSON.stringify(body);

    return new Promise((resolve, reject) => {
        const request = https.request(
            {
                host: config.hostAddress,
                port: config.port,
                path: route,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": String(Buffer.byteLength(payload)),
                    ...(readLocalToken() ? { Authorization: `Bearer ${readLocalToken()}` } : {}),
                },
                ca: config.pinnedCertificate ? [config.pinnedCertificate] : undefined,
                rejectUnauthorized: Boolean(config.pinnedCertificate),
                checkServerIdentity: () => undefined,
            },
            (response) => {
                const chunks: Buffer[] = [];
                response.on("data", (chunk: Buffer) => chunks.push(chunk));
                response.on("end", () => {
                    const header = response.headers["x-ausculta-filename"];
                    const raw = Array.isArray(header) ? header[0] : header;
                    resolve({
                        status: response.statusCode ?? 0,
                        buffer: Buffer.concat(chunks),
                        filename: raw ? decodeURIComponent(raw) : undefined,
                    });
                });
            },
        );

        request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => request.destroy(new Error("timeout")));
        request.on("error", reject);
        request.write(payload);
        request.end();
    });
}

// ─── Failure reporting ───────────────────────────────────────────────────

function errorCode(error: unknown): ConnectionErrorCode {
    const err = error as NodeJS.ErrnoException & { code?: string };
    if (err?.code === "fingerprint_mismatch") return "fingerprint_mismatch";
    if (err?.code === "not_ausculta") return "not_ausculta";
    if (err?.message === "timeout" || err?.code === "ETIMEDOUT") return "timeout";
    if (err?.code === "ECONNREFUSED" || err?.code === "EHOSTUNREACH" ||
        err?.code === "ENOTFOUND" || err?.code === "ENETUNREACH" ||
        err?.code === "ECONNRESET") return "unreachable";
    return "server_error";
}

/**
 * French, because this can surface before the renderer has resolved a locale
 * and French is the default for this market. Screens that have i18n available
 * should prefer their own string keyed off `code`.
 */
function failureMessage(code: ConnectionErrorCode): string {
    switch (code) {
        case "unreachable":
            return "Le poste principal est injoignable. Vérifiez qu'il est allumé et connecté au réseau.";
        case "timeout":
            return "Le poste principal ne répond pas.";
        case "fingerprint_mismatch":
            return "Le certificat du poste principal a changé. Réappariez les postes depuis les Paramètres.";
        case "not_ausculta":
            return "L'adresse configurée ne correspond pas à un hôte Ausculta.";
        default:
            return "Erreur de communication avec le poste principal.";
    }
}

/** Tells the renderer only when reachability actually changes. */
function reportReachable(reachable: boolean, code?: ConnectionErrorCode) {
    if (lastReachable === reachable) return;
    lastReachable = reachable;
    const payload: HostStatus = { reachable, code };
    statusWindow?.webContents.send("host-status", payload);
}
