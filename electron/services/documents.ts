import { getDatabase } from "../db/db";
import fs from "node:fs";
import path from "node:path";
import type { PatientDocument } from "../../types/documents";
import { recordAudit } from "./audit";
import { app, shell } from "electron";

const recordsFolder = path.join(app.getPath('userData'), 'records');

if (!fs.existsSync(recordsFolder)) {
    fs.mkdirSync(recordsFolder, { recursive: true });
}



export async function uploadDocument(document: Omit<PatientDocument, 'id' | 'uploadDate'>): Promise<PatientDocument> {
    try {
        const patientFolder = path.join(recordsFolder, document.patientId.toString());

        if (!fs.existsSync(patientFolder)) {
            fs.mkdirSync(patientFolder, { recursive: true });
        }

        const filename = path.basename(document.fileName);
        const uniqueFilename = `${Date.now()}_${filename}`
        const localPath = path.join(patientFolder, uniqueFilename);

        await fs.promises.copyFile(document.localPath, localPath);

        const db = getDatabase();
        const stmt = db.prepare(`
        INSERT INTO patient_documents (patient_id, prescription_id, consultation_id, file_name, file_category, local_path)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(document.patientId, document.prescriptionId ?? null, document.consultationId ?? null, uniqueFilename, document.fileCategory, localPath);
        recordAudit('document.upload', {
            entityType: 'patient',
            entityId: document.patientId,
            summary: `${filename} (${document.fileCategory})`,
            details: { fileCategory: document.fileCategory },
        });
        return {
            ...document,
            localPath,
            id: result.lastInsertRowid as number,
            uploadDate: new Date().toISOString(),
            fileName: uniqueFilename
        };
    } catch (error) {
        // Rethrow so callers (the upload UI, prescription PDF generation) see
        // the failure instead of a silent undefined.
        console.error("uploadDocument error:", error);
        throw error;
    }
}

export function getDocumentsByPatientId(patientId: number): PatientDocument[] {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
        SELECT * FROM patient_documents WHERE patient_id = ?
    `);
        const rows = stmt.all(patientId) as { id: number; patient_id: number; prescription_id: number | null; consultation_id: number | null; file_name: string; file_category: string; local_path: string; upload_date: string }[];
        return rows.map(row => ({
            id: row.id,
            patientId: row.patient_id,
            prescriptionId: row.prescription_id,
            consultationId: row.consultation_id,
            fileName: row.file_name,
            fileCategory: row.file_category,
            localPath: row.local_path,
            uploadDate: row.upload_date,
        }));
    } catch (error) {
        console.log(error);
        return [];
    }
}

/** Files attached during one visit — the consultation page's document list. */
export function getDocumentsByConsultationId(consultationId: number): PatientDocument[] {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`SELECT * FROM patient_documents WHERE consultation_id = ? ORDER BY upload_date DESC`);
        const rows = stmt.all(consultationId) as { id: number; patient_id: number; prescription_id: number | null; consultation_id: number | null; file_name: string; file_category: string; local_path: string; upload_date: string }[];
        return rows.map(row => ({
            id: row.id,
            patientId: row.patient_id,
            prescriptionId: row.prescription_id,
            consultationId: row.consultation_id,
            fileName: row.file_name,
            fileCategory: row.file_category,
            localPath: row.local_path,
            uploadDate: row.upload_date,
        }));
    } catch (error) {
        console.error("getDocumentsByConsultationId error:", error);
        return [];
    }
}

export function getAllDocuments() {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
            SELECT d.*, p.full_name as patient_name, p.phone_number as patient_phone
            FROM patient_documents d
            JOIN patients p ON d.patient_id = p.id
            ORDER BY d.upload_date DESC
        `);
        const rows = stmt.all() as {
            id: number;
            patient_id: number;
            prescription_id: number | null;
            consultation_id: number | null;
            file_name: string;
            file_category: string; 
            local_path: string; 
            upload_date: string;
            patient_name: string;
            patient_phone: string | null;
        }[];

        return rows.map(row => {
            let fileSize = 0;
            try {
                if (fs.existsSync(row.local_path)) {
                    fileSize = fs.statSync(row.local_path).size;
                }
            } catch (err) {
                console.log(err);
            }
            return {
                id: row.id,
                patientId: row.patient_id,
                prescriptionId: row.prescription_id,
                consultationId: row.consultation_id,
                fileName: row.file_name,
                fileCategory: row.file_category,
                localPath: row.local_path,
                uploadDate: row.upload_date,
                patientName: row.patient_name,
                patientPhone: row.patient_phone,
                fileSize,
            };
        });
    } catch (error) {
        console.log(error);
        return [];
    }
}


export function deleteDocument(id: number): { status: "success" | "fail"; message?: string } {
    try {
        const db = getDatabase();
        // Read the row before deleting — the log needs the file name, and the
        // unlink below needs the path.
        const stmt = db.prepare(`
        SELECT local_path, file_name, patient_id FROM patient_documents WHERE id = ?
    `);
        const result = stmt.get(id) as { local_path: string; file_name: string; patient_id: number } | undefined;
        const doomed = result;

        // Delete the DB row FIRST: if the file is already gone from disk the
        // document must still be removable, so the unlink is best-effort.
        const stmt2 = db.prepare(`
        DELETE FROM patient_documents WHERE id = ?
    `);
        stmt2.run(id);

        recordAudit('document.delete', {
            entityType: 'patient',
            entityId: doomed?.patient_id ?? null,
            summary: doomed?.file_name ?? `#${id}`,
        });

        if (result) {
            try {
                fs.unlinkSync(result.local_path);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
                    console.error("deleteDocument: file removal failed:", err);
                }
            }
        }
        return { status: "success" };
    } catch (error) {
        console.error("deleteDocument error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}


export async function openDocument(filePath: string): Promise<string> {
    const error = await shell.openPath(filePath);
    if (error) console.log('Failed to open file:', error);
    return error; // empty string = success, non-empty = error message
}

/**
 * Decides whether the host is willing to send this file to a client.
 *
 * The renderer opens documents BY PATH — every call site does
 * `openDocument(somethingsLocalPath)` — so a client asking the host for a file
 * necessarily asks by path too. That makes this the security boundary: an
 * unchecked version would be a "read any file on the doctor's computer"
 * endpoint reachable by anyone holding a front-desk password.
 *
 * So a path is servable only if the database already refers to it — a row in
 * patient_documents, or one of the doctor's own letterhead previews, which the
 * Settings screen opens the same way. The path is a lookup key here, not a
 * filesystem path: anything the query does not return is refused, and the
 * containment check below is the second line for a row that has been edited by
 * hand to point somewhere else entirely.
 */
export function resolveServablePath(requested: string): string | null {
    try {
        if (typeof requested !== 'string' || !requested) return null;
        const db = getDatabase();

        const known = db.prepare(`
            SELECT local_path AS p FROM patient_documents WHERE local_path = ?
            UNION ALL
            SELECT pdf_path AS p FROM doctor_profile WHERE pdf_path = ?
            UNION ALL
            SELECT pdf_path_en AS p FROM doctor_profile WHERE pdf_path_en = ?
            LIMIT 1
        `).get(requested, requested, requested) as { p: string } | undefined;

        if (!known?.p) return null;

        // Belt and braces: whatever the row says, it must land inside the
        // directory this app owns.
        const resolved = path.resolve(known.p);
        const root = path.resolve(app.getPath('userData'));
        if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
        if (!fs.existsSync(resolved)) return null;

        return resolved;
    } catch (error) {
        console.error('resolveServablePath error:', error);
        return null;
    }
}
