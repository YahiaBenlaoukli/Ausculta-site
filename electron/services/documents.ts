import { getDatabase } from "../db/db";
import fs from "node:fs";
import path from "node:path";
import type { PatientDocument } from "../../types/documents";
import { app } from "electron";

const recordsFolder = path.join(app.getPath('userData'), 'records');

if (!fs.existsSync(recordsFolder)) {
    fs.mkdirSync(recordsFolder, { recursive: true });
}



export async function uploadDocument(document: Omit<PatientDocument, 'id' | 'uploadDate'>): PatientDocument {
    try {
        const patientFolder = path.join(recordsFolder, document.patientId.toString());

        if (!fs.existsSync(patientFolder)) {
            fs.mkdirSync(patientFolder, { recursive: true });
        }

        const filename = path.basename(document.fileName);
        const uniqueFilename = `${Date.now()}_${filename}`
        const localPath = path.join(patientFolder, uniqueFilename);

        await fs.copyFileSync(document.localPath, localPath);

        const db = getDatabase();
        const stmt = db.prepare(`
        INSERT INTO patient_documents (patient_id, file_name, file_category, local_path)
        VALUES (?, ?, ?, ?)
    `);
        const result = stmt.run(document.patientId, uniqueFilename, document.fileCategory, localPath);
        return {
            ...document,
            localPath,
            id: result.lastInsertRowid as number,
            uploadDate: new Date().toISOString(),
            fileName: uniqueFilename
        };
    } catch (error) {
        console.log(error);
    }
}

export function getDocumentsByPatientId(patientId: number): PatientDocument[] {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
        SELECT * FROM patient_documents WHERE patient_id = ?
    `);
        const result = stmt.all(patientId);
        return result as PatientDocument[];
    } catch (error) {
        console.log(error);
        return [];
    }
}

export function deleteDocument(id: number): void {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
        SELECT local_path FROM patient_documents WHERE id = ?
    `);
        const result = stmt.get(id) as { localPath: string, patientId: number };

        if (result) {
            fs.unlinkSync(result.localPath);
        }

        const stmt2 = db.prepare(`
        DELETE FROM patient_documents WHERE id = ?
    `);
        stmt2.run(id);
    } catch (error) {
        console.log(error);
    }
}

