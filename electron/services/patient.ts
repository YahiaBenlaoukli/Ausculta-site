import { getDatabase } from "../db/db";
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

/* Escapes LIKE wildcards in user-supplied search text (used with ESCAPE '\') */
function escapeLike(query: string): string {
    return query.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function addPatient(patient: Omit<Patient, 'id' | 'createdAt'>): Promise<Patient> {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
        INSERT INTO patients (full_name, date_of_birth, address, phone_number, ssn, blood_type)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(patient.fullName, patient.dateOfBirth, patient.address, patient.phoneNumber, patient.ssn, patient.bloodType || null);
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
        UPDATE patients SET full_name = ?, date_of_birth = ?, address = ?, phone_number = ?, ssn = ?, blood_type = ?, notes = ? WHERE id = ?
    `);
        // blood_type has a CHECK constraint that only allows the 8 valid groups or
        // NULL — an empty string would throw and silently abort the whole update
        // (including notes). Coerce falsy values to NULL.
        stmt.run(patient.fullName, patient.dateOfBirth, patient.address, patient.phoneNumber, patient.ssn, patient.bloodType || null, patient.notes ?? null, patient.id);
        return patient;
    } catch (error) {
        console.error("updatePatient error:", error);
        throw error as Error;
    }
}

export async function deletePatient(id: number): Promise<void> {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
        DELETE FROM patients WHERE id = ?
    `);
        stmt.run(id);
    } catch (error) {
        console.error("deletePatient error:", error);
        throw error as Error;
    }
}

export async function searchPatients(query: string): Promise<Patient[]> {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
        SELECT * FROM patients WHERE full_name LIKE ? ESCAPE '\\' OR ssn LIKE ? ESCAPE '\\'
    `);
        const pattern = `%${escapeLike(query)}%`;
        const result = stmt.all(pattern, pattern) as PatientRow[];
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
        return { status: "success" };
    } catch (error) {
        console.error("resetMedicalDatabase error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}
