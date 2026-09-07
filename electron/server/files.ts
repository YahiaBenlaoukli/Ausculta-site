import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { uploadDocument, resolveServablePath } from "../services/documents";
import { checkPermission } from "../services/permissions";
import { verifyToken } from "../services/auth";
import { runAs } from "../services/session";
import type { PatientDocument } from "../../types/documents";

/**
 * File transfer between the seats.
 *
 * The RPC route carries JSON, which is the wrong shape for a scanned
 * radiograph. These two routes carry bytes instead:
 *
 *   POST /files/upload   the desk scans something in; the bytes go to the host,
 *                        which files them exactly as a local upload would
 *   POST /files/fetch    the desk opens or prints something; the host sends the
 *                        bytes back and the client opens a temporary copy
 *
 * Neither invents a permission of its own. Uploading is gated on the same
 * `upload-document` entry that the RPC channel uses, and fetching on
 * `get-documents-by-patient-id`, so the answer to "may the assistant do this?"
 * stays in permissions.ts where it can be read as one policy.
 */

/** A scan or a phone photo. Generous, but not unbounded. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Metadata rides in a header so the body can stay raw bytes and stream. */
const META_HEADER = "x-ausculta-document";

export type UploadMeta = Omit<PatientDocument, "id" | "uploadDate">;

export function encodeUploadMeta(meta: UploadMeta): string {
    // Base64 because a header must be latin-1 and a patient's file name is
    // routinely accented or Arabic.
    return Buffer.from(JSON.stringify(meta), "utf8").toString("base64");
}

function decodeUploadMeta(header: string | string[] | undefined): UploadMeta | null {
    try {
        const raw = Array.isArray(header) ? header[0] : header;
        if (!raw) return null;
        const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as UploadMeta;
        return typeof parsed?.patientId === "number" && typeof parsed?.fileName === "string" ? parsed : null;
    } catch {
        return null;
    }
}

/** Handles POST /files/upload. Returns true if it took the request. */
export async function handleUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const user = verifyToken(bearer(req) ?? "");
    const denial = checkPermission("upload-document", user);
    if (denial) return sendJson(res, denial.code === "unauthenticated" ? 401 : 403, denial);

    const meta = decodeUploadMeta(req.headers[META_HEADER]);
    if (!meta) return sendJson(res, 400, { status: "fail", message: "Missing or malformed document metadata" });

    // Streamed to disk rather than buffered: a scan can be tens of megabytes,
    // and holding that in memory in the same process that serves the doctor's
    // window is a poor trade for code that is no simpler.
    const staging = path.join(os.tmpdir(), `ausculta-upload-${crypto.randomUUID()}`);
    let received = 0;

    try {
        req.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (received > MAX_UPLOAD_BYTES) req.destroy(new Error("too_large"));
        });
        await pipeline(req, fs.createWriteStream(staging));
    } catch (error) {
        await fs.promises.rm(staging, { force: true });
        if ((error as Error).message === "too_large") {
            return sendJson(res, 413, { status: "fail", message: "Fichier trop volumineux" });
        }
        return sendJson(res, 400, { status: "fail", message: "Transfert interrompu" });
    }

    try {
        // The existing service does the real work — copy into records/, insert
        // the row, write the audit entry — with the staged file standing in for
        // whatever the client picked. runAs attributes it to the person at the
        // desk rather than to whoever is signed in on the host.
        const filed = await runAs(user, () => uploadDocument({ ...meta, localPath: staging }));
        // Cleared BEFORE replying, not in a finally afterwards: once the client
        // has its answer the request is over as far as anything downstream is
        // concerned, and a patient document has no business outliving it in the
        // temp directory for however long the tail of that promise takes.
        await fs.promises.rm(staging, { force: true });
        sendJson(res, 200, filed);
    } catch (error) {
        await fs.promises.rm(staging, { force: true });
        sendJson(res, 500, { status: "fail", message: (error as Error).message });
    }
}

/** Handles POST /files/fetch — body `{ path }`, replies with the bytes. */
export async function handleFetch(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
    const user = verifyToken(bearer(req) ?? "");
    const denial = checkPermission("get-documents-by-patient-id", user);
    if (denial) return sendJson(res, denial.code === "unauthenticated" ? 401 : 403, denial);

    const requested = (body as { path?: unknown })?.path;
    const resolved = typeof requested === "string" ? resolveServablePath(requested) : null;
    if (!resolved) {
        // Deliberately the same answer whether the row is absent or the file
        // is: a client has no business learning what else is on this disk.
        return sendJson(res, 404, { status: "fail", message: "Document introuvable" });
    }

    try {
        const stat = await fs.promises.stat(resolved);
        res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Length": stat.size,
            "X-Ausculta-Filename": encodeURIComponent(path.basename(resolved)),
        });
        await pipeline(fs.createReadStream(resolved), res);
    } catch (error) {
        if (!res.headersSent) sendJson(res, 500, { status: "fail", message: (error as Error).message });
        else res.destroy();
    }
}

// ─── Client side ─────────────────────────────────────────────────────────

/**
 * Where fetched copies live on a client.
 *
 * Under the OS temp directory rather than the app's own storage, because they
 * are not the record — the record is on the host. A copy opened here and
 * annotated does not propagate, which is why nothing writes back from it.
 */
export function clientCacheDir(): string {
    return path.join(app.getPath("temp"), "ausculta-cache");
}

/**
 * Empties the cache at startup.
 *
 * At startup rather than at quit so a crash cannot leave patient documents
 * sitting in the temp directory indefinitely.
 */
export function clearClientCache(): void {
    try {
        fs.rmSync(clientCacheDir(), { recursive: true, force: true });
    } catch (error) {
        console.error("Could not clear the document cache:", error);
    }
}

// ─── Shared ──────────────────────────────────────────────────────────────

function bearer(req: IncomingMessage): string | null {
    const header = req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
    return header.slice("Bearer ".length).trim() || null;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload ?? null);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
}
