import { getDatabase } from "../db/db";
import { recordAudit } from "./audit";
import { getCurrentUser } from "./session";
import type { PrintJob } from "../../types/print";

/**
 * The queue between the consulting room and the front desk.
 *
 * Deliberately a table and not a message: a queue that lives in memory forgets
 * everything when the host restarts, and the doctor would have no way to know
 * whether the prescription they sent five minutes ago ever came out. Rows also
 * give the desk a backlog to pick up after being asleep, which is what makes
 * polling sufficient and a live connection unnecessary.
 *
 * Jobs reference patient_documents, so certificates and receipts queue exactly
 * like prescriptions with no code of their own.
 */

/** Enough for a busy morning; the desk is meant to be emptying this. */
const MAX_ROWS = 50;

const SELECT_JOB = `
    SELECT
        j.id, j.document_id, j.status, j.created_at, j.printed_at,
        d.local_path, d.file_name, d.file_category, d.patient_id,
        p.full_name AS patient_name,
        requester.full_name AS requested_by_name,
        printer.full_name AS printed_by_name
    FROM print_jobs j
    JOIN patient_documents d ON d.id = j.document_id
    JOIN patients p ON p.id = d.patient_id
    LEFT JOIN users requester ON requester.id = j.requested_by
    LEFT JOIN users printer ON printer.id = j.printed_by
`;

interface JobRow {
    id: number;
    document_id: number;
    status: string;
    created_at: string;
    printed_at: string | null;
    local_path: string;
    file_name: string;
    file_category: string;
    patient_id: number;
    patient_name: string;
    requested_by_name: string | null;
    printed_by_name: string | null;
}

function mapJob(row: JobRow): PrintJob {
    return {
        id: row.id,
        documentId: row.document_id,
        documentPath: row.local_path,
        fileName: row.file_name,
        fileCategory: row.file_category,
        patientId: row.patient_id,
        patientName: row.patient_name,
        requestedByName: row.requested_by_name,
        status: row.status === "printed" ? "printed" : row.status === "cancelled" ? "cancelled" : "pending",
        createdAt: row.created_at,
        printedAt: row.printed_at,
        printedByName: row.printed_by_name,
    };
}

/**
 * Queues a document for the front desk.
 *
 * Takes the document's PATH rather than its id because that is what every
 * caller already holds: the prescription, certificate and receipt screens all
 * receive a path back from the generator and open it with that. Resolving the
 * path to a row here keeps those call sites to a single line, and means a path
 * that is not a filed document cannot be queued at all.
 */
export function enqueuePrintJob(documentPath: string) {
    try {
        const db = getDatabase();
        const document = db.prepare(`
            SELECT d.id, d.file_name, p.full_name AS patient_name
            FROM patient_documents d
            JOIN patients p ON p.id = d.patient_id
            WHERE d.local_path = ?
        `).get(documentPath) as { id: number; file_name: string; patient_name: string } | undefined;

        if (!document) {
            return { status: "not_found", message: "Ce document n'est pas encore enregistré." };
        }

        // Re-sending replaces the outstanding request rather than adding a
        // second one: the doctor pressing the button twice means "I want this
        // printed", not "print it twice".
        const existing = db.prepare(
            `SELECT id FROM print_jobs WHERE document_id = ? AND status = 'pending'`
        ).get(document.id) as { id: number } | undefined;
        if (existing) {
            return { status: "success", data: { jobId: existing.id, alreadyQueued: true } };
        }

        const result = db.prepare(
            `INSERT INTO print_jobs (document_id, requested_by) VALUES (?, ?)`
        ).run(document.id, getCurrentUser()?.id ?? null);

        recordAudit('print.queue', {
            entityType: 'patient',
            entityId: null,
            summary: `${document.file_name} — ${document.patient_name}`,
        });

        return { status: "success", data: { jobId: result.lastInsertRowid as number, alreadyQueued: false } };
    } catch (error) {
        console.error("enqueuePrintJob error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/**
 * The queue as the desk sees it: everything outstanding, oldest first, plus a
 * short tail of what has already been dealt with so the doctor can confirm
 * their prescription actually came out.
 */
export function getPrintQueue() {
    try {
        const db = getDatabase();
        const pending = (db.prepare(
            `${SELECT_JOB} WHERE j.status = 'pending' ORDER BY j.created_at ASC LIMIT ?`
        ).all(MAX_ROWS) as JobRow[]).map(mapJob);

        const recent = (db.prepare(
            `${SELECT_JOB} WHERE j.status != 'pending' ORDER BY COALESCE(j.printed_at, j.created_at) DESC LIMIT 10`
        ).all() as JobRow[]).map(mapJob);

        return { status: "success", data: { pending, recent } };
    } catch (error) {
        console.error("getPrintQueue error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/** The desk confirming a job came out of the printer. */
export function markPrintJobPrinted(id: number) {
    try {
        const db = getDatabase();
        const job = db.prepare(`
            SELECT d.file_name, p.full_name AS patient_name
            FROM print_jobs j
            JOIN patient_documents d ON d.id = j.document_id
            JOIN patients p ON p.id = d.patient_id
            WHERE j.id = ?
        `).get(id) as { file_name: string; patient_name: string } | undefined;
        if (!job) return { status: "not_found", message: "Impression introuvable." };

        const result = db.prepare(`
            UPDATE print_jobs
            SET status = 'printed', printed_at = CURRENT_TIMESTAMP, printed_by = ?
            WHERE id = ? AND status = 'pending'
        `).run(getCurrentUser()?.id ?? null, id);

        // Not an error: two seats polling the same queue can both reach a job,
        // and the second one arriving to find it already done is the system
        // working, not a conflict to report.
        if (result.changes === 0) return { status: "success", data: { alreadyDone: true } };

        recordAudit('print.done', { summary: `${job.file_name} — ${job.patient_name}` });
        return { status: "success", data: { alreadyDone: false } };
    } catch (error) {
        console.error("markPrintJobPrinted error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/** Withdraws a job — the doctor changed their mind, or the desk cannot print it. */
export function cancelPrintJob(id: number) {
    try {
        const db = getDatabase();
        db.prepare(`UPDATE print_jobs SET status = 'cancelled' WHERE id = ? AND status = 'pending'`).run(id);
        return { status: "success" };
    } catch (error) {
        console.error("cancelPrintJob error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}
