import { getDatabase } from "../db/db";
import type { Patient } from "../../types/patient";

/* Maps a snake_case DB row to the camelCase Patient type */
function mapRow(row: any): Patient {
    return {
        id: row.id,
        fullName: row.full_name,
        dateOfBirth: row.date_of_birth,
        address: row.address,
        phoneNumber: row.phone_number,
        ssn: row.ssn,
        bloodType: row.blood_type,
        createdAt: row.created_at,
    };
}

export async function addPatient(patient: Omit<Patient, 'id' | 'createdAt'>): Promise<Patient> {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
        INSERT INTO patients (full_name, date_of_birth, address, phone_number, ssn, blood_type)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(patient.fullName, patient.dateOfBirth, patient.address, patient.phoneNumber, patient.ssn, patient.bloodType);
        return {
            ...patient,
            id: result.lastInsertRowid as number,
            createdAt: new Date().toISOString()
        };
    } catch (error) {
        console.log(error);
        throw error as Error;
    }
}

export async function getPatient(id: number): Promise<Patient> {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
        SELECT * FROM patients WHERE id = ?
    `);
        const result = stmt.get(id);
        return mapRow(result);
    } catch (error) {
        console.log(error);
        throw error as Error;
    }

}

export async function getAllPatients(): Promise<Patient[]> {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
        SELECT * FROM patients
    `);
        const result = stmt.all();
        return result.map(mapRow);
    } catch (error) {
        console.log(error);
        throw error as Error;
    }
}

export async function updatePatient(patient: Patient): Promise<Patient> {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
        UPDATE patients SET full_name = ?, date_of_birth = ?, address = ?, phone_number = ?, ssn = ?, blood_type = ? WHERE id = ?
    `);
        stmt.run(patient.fullName, patient.dateOfBirth, patient.address, patient.phoneNumber, patient.ssn, patient.bloodType, patient.id);
        return patient;
    } catch (error) {
        console.log(error);
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
        console.log(error);
        throw error as Error;
    }
}

export async function searchPatients(query: string): Promise<Patient[]> {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
        SELECT * FROM patients WHERE full_name LIKE ? OR ssn LIKE ?
    `);
        const result = stmt.all(`%${query}%`, `%${query}%`);
        return result.map(mapRow);
    } catch (error) {
        console.log(error);
        throw error as Error;
    }
}

export async function countPatients(): Promise<number> {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
        SELECT COUNT(*) as count FROM patients
    `);
        const result: any = stmt.get();
        return result.count as number;
    } catch (error) {
        console.log(error);
        throw error as Error;
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
