import { getDatabase } from "../db/db";
import { buildPatientSearchText, escapeLike, normalizeSearchText } from "../db/normalize";
import { recordAudit } from "./audit";
import type { Patient } from "../../types/patient";

type PatientRow = {
    id: number;
    full_name: string;
    date_of_birth: string;
    address: string;
    phone_number: string;
    ssn: string;
    blood_type: Patient["bloodType"];
    notes: string | null;
    created_at: string;
};

/* Maps a snake_case DB row to the camelCase Patient type */
function mapRow(row: PatientRow): Patient {
    return {
        id: row.id,
        fullName: row.full_name,
        dateOfBirth: row.date_of_birth,
        address: row.address,
        phoneNumber: row.phone_number,
        ssn: row.ssn,
        bloodType: row.blood_type,
        notes: row.notes,
        createdAt: row.created_at,
    };
}

export async function addPatient(patient: Omit<Patient, 'id' | 'createdAt'>): Promise<Patient> {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
        INSERT INTO patients (full_name, date_of_birth, address, phone_number, ssn, blood_type, search_text)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(patient.fullName, patient.dateOfBirth, patient.address, patient.phoneNumber, patient.ssn, patient.bloodType || null, buildPatientSearchText(patient));
        recordAudit('patient.create', {
            entityType: 'patient',
            entityId: result.lastInsertRowid as number,
            summary: patient.fullName,
        });
        return {
            ...patient,
            id: result.lastInsertRowid as number,
            createdAt: new Date().toISOString()
        };
    } catch (error) {
        console.error("addPatient error:", error);
        throw error as Error;
    }
}

export async function getPatient(id: number): Promise<Patient | null> {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
        SELECT * FROM patients WHERE id = ?
    `);
        const result = stmt.get(id) as PatientRow | undefined;
        return result ? mapRow(result) : null;
    } catch (error) {
        console.error("getPatient error:", error);
        throw error as Error;
    }
}

export async function getAllPatients(): Promise<Patient[]> {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
        SELECT * FROM patients
    `);
        const result = stmt.all() as PatientRow[];
        return result.map(mapRow);
    } catch (error) {
        console.error("getAllPatients error:", error);
        return [];
    }
}

export async function updatePatient(patient: Patient): Promise<Patient> {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
        UPDATE patients SET full_name = ?, date_of_birth = ?, address = ?, phone_number = ?, ssn = ?, blood_type = ?, notes = ?, search_text = ? WHERE id = ?
    `);
        // blood_type has a CHECK constraint that only allows the 8 valid groups or
        // NULL — an empty string would throw and silently abort the whole update
        // (including notes). Coerce falsy values to NULL.
        // search_text is rebuilt here rather than left alone: a renamed patient
        // whose haystack still held the old name would be unfindable by the new one.
        stmt.run(patient.fullName, patient.dateOfBirth, patient.address, patient.phoneNumber, patient.ssn, patient.bloodType || null, patient.notes ?? null, buildPatientSearchText(patient), patient.id);
        recordAudit('patient.update', {
            entityType: 'patient',
            entityId: patient.id,
            summary: patient.fullName,
        });
        return patient;
    } catch (error) {
        console.error("updatePatient error:", error);
        throw error as Error;
    }
}

export async function deletePatient(id: number): Promise<void> {
    try {
        const db = getDatabase();
        // Read the name BEFORE deleting: afterwards there is nothing left to
        // name, and "deleted patient 47" is useless in a log.
        const victim = db.prepare(`SELECT full_name FROM patients WHERE id = ?`)
            .get(id) as { full_name: string } | undefined;

        const stmt = db.prepare(`
        DELETE FROM patients WHERE id = ?
    `);
        stmt.run(id);

        recordAudit('patient.delete', {
            entityType: 'patient',
            entityId: id,
            summary: victim?.full_name ?? `#${id}`,
        });
    } catch (error) {
        console.error("deletePatient error:", error);
        throw error as Error;
    }
}

/**
 * Patient lookup used by every picker in the app (appointments, consultation
 * walk-in, document upload, prescriptions) as well as global search.
 *
 * Matches against the folded search_text column, so accents, Arabic vowel marks
 * and punctuation in either the stored name or the typed query are irrelevant.
 * Every whitespace-separated term must match somewhere in the haystack, which
 * makes word order free: "mohammed ben" and "ben mohammed" both find
 * "Ben Aïssa Mohammed".
 */
export async function searchPatients(query: string): Promise<Patient[]> {
    try {
        const terms = normalizeSearchText(query).split(' ').filter(Boolean);
        if (!terms.length) return [];

        const db = getDatabase();
        const where = terms.map(() => `search_text LIKE ? ESCAPE '\\'`).join(' AND ');
        const stmt = db.prepare(`SELECT * FROM patients WHERE ${where} ORDER BY full_name`);
        const result = stmt.all(...terms.map((t) => `%${escapeLike(t)}%`)) as PatientRow[];
        return result.map(mapRow);
    } catch (error) {
        console.error("searchPatients error:", error);
        return [];
    }
}

export async function countPatients(): Promise<number> {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
        SELECT COUNT(*) as count FROM patients
    `);
        const result = stmt.get() as { count: number };
        return result.count;
    } catch (error) {
        console.error("countPatients error:", error);
        return 0;
    }
}

export function resetMedicalDatabase() {
    try {
        const db = getDatabase();
        const transaction = db.transaction(() => {
            db.prepare(`DELETE FROM appointments`).run();
            db.prepare(`DELETE FROM patient_documents`).run();
            db.prepare(`DELETE FROM prescription_medicines`).run();
            db.prepare(`DELETE FROM prescriptions`).run();
            db.prepare(`DELETE FROM patients`).run();
        });
        transaction();
        recordAudit('database.reset', { summary: 'medical records cleared' });
        return { status: "success" };
    } catch (error) {
        console.error("resetMedicalDatabase error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}
