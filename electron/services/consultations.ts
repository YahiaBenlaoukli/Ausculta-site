import { getDatabase } from "../db/db";
import { getPrescriptionsByConsultationId } from "./prescription";
import { getDocumentsByConsultationId } from "./documents";
import type { Consultation, ConsultationDraft, ConsultationListItem } from "../../types/consultation";

// Consultation datetimes are stored as 'YYYY-MM-DDTHH:MM:SS' local strings, the
// same convention as appointment_datetime — a bare 'YYYY-MM-DD' end date would
// exclude every visit on that day in a string BETWEEN comparison.
function endOfDay(date: string): string {
    return date.length === 10 ? `${date}T23:59:59.999` : date;
}

// Local, timezone-naive 'YYYY-MM-DDTHH:MM:SS'. toISOString() would be UTC and
// off by the timezone offset, which is how appointments store it too.
function localNow(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

type ConsultationRow = {
    id: number;
    patient_id: number;
    doctor_id: number;
    appointment_id: number | null;
    consultation_datetime: string;
    is_walk_in: number;
    reason: string | null;
    weight: number | null;
    height: number | null;
    temperature: number | null;
    blood_pressure: string | null;
    heart_rate: number | null;
    exam_notes: string | null;
    diagnosis: string | null;
    treatment_plan: string | null;
    follow_up_notes: string | null;
    fee: number | null;
    is_paid: number;
    status: string;
    created_at: string;
};

function mapRowToConsultation(row: ConsultationRow): Consultation {
    return {
        id: row.id,
        patientId: row.patient_id,
        doctorId: row.doctor_id,
        appointmentId: row.appointment_id,
        consultationDatetime: row.consultation_datetime,
        isWalkIn: !!row.is_walk_in,
        reason: row.reason,
        weight: row.weight,
        height: row.height,
        temperature: row.temperature,
        bloodPressure: row.blood_pressure,
        heartRate: row.heart_rate,
        examNotes: row.exam_notes,
        diagnosis: row.diagnosis,
        treatmentPlan: row.treatment_plan,
        followUpNotes: row.follow_up_notes,
        fee: row.fee,
        isPaid: !!row.is_paid,
        status: row.status === "Completed" ? "Completed" : "InProgress",
        createdAt: row.created_at,
    };
}

// The only fields the consultation page may write, mapped to their columns.
// Anything not in this map is ignored, so a stray key from the renderer can
// never become part of the UPDATE statement.
const EDITABLE_COLUMNS: Record<keyof ConsultationDraft, string> = {
    reason: "reason",
    weight: "weight",
    height: "height",
    temperature: "temperature",
    bloodPressure: "blood_pressure",
    heartRate: "heart_rate",
    examNotes: "exam_notes",
    diagnosis: "diagnosis",
    treatmentPlan: "treatment_plan",
    followUpNotes: "follow_up_notes",
    fee: "fee",
    isPaid: "is_paid",
};

function buildUpdate(draft: ConsultationDraft): { clause: string; values: (string | number | null)[] } {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [key, column] of Object.entries(EDITABLE_COLUMNS)) {
        const value = draft[key as keyof ConsultationDraft];
        if (value === undefined) continue;
        sets.push(`${column} = ?`);
        values.push(typeof value === "boolean" ? (value ? 1 : 0) : (value as string | number | null));
    }
    return { clause: sets.join(", "), values };
}

/**
 * Opens the draft a visit is recorded against. Created up-front rather than on
 * save so prescriptions and documents produced while the patient is still in
 * the room can carry consultation_id from the moment they exist, instead of
 * being matched back by timestamp proximity afterwards.
 *
 * A doctor can only be in one room at a time, so an already-open draft for the
 * same patient is resumed rather than duplicated.
 */
export function startConsultation(patientId: number, doctorId: number, appointmentId?: number) {
    try {
        const db = getDatabase();

        const existing = db
            .prepare(`SELECT * FROM consultations WHERE patient_id = ? AND doctor_id = ? AND status = 'InProgress' ORDER BY id DESC LIMIT 1`)
            .get(patientId, doctorId) as ConsultationRow | undefined;
        if (existing) {
            // Late-link the appointment if the doctor started from the calendar
            // after already having opened a walk-in draft for this patient.
            if (appointmentId && !existing.appointment_id) {
                db.prepare(`UPDATE consultations SET appointment_id = ?, is_walk_in = 0 WHERE id = ?`).run(appointmentId, existing.id);
                existing.appointment_id = appointmentId;
                existing.is_walk_in = 0;
            }
            return { status: "success", data: mapRowToConsultation(existing) };
        }

        let reason: string | null = null;
        if (appointmentId) {
            const appointment = db
                .prepare(`SELECT reason FROM appointments WHERE id = ?`)
                .get(appointmentId) as { reason: string | null } | undefined;
            reason = appointment?.reason ?? null;
        }

        const result = db
            .prepare(`
                INSERT INTO consultations (patient_id, doctor_id, appointment_id, consultation_datetime, is_walk_in, reason)
                VALUES (?, ?, ?, ?, ?, ?)
            `)
            .run(patientId, doctorId, appointmentId ?? null, localNow(), appointmentId ? 0 : 1, reason);

        const created = db
            .prepare(`SELECT * FROM consultations WHERE id = ?`)
            .get(result.lastInsertRowid as number) as ConsultationRow;
        return { status: "success", data: mapRowToConsultation(created) };
    } catch (error) {
        console.error("startConsultation error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

export function getConsultationById(id: number) {
    try {
        const db = getDatabase();
        const row = db.prepare(`SELECT * FROM consultations WHERE id = ?`).get(id) as ConsultationRow | undefined;
        if (!row) return { status: "not_found", message: "Consultation not found" };
        return { status: "success", data: mapRowToConsultation(row) };
    } catch (error) {
        console.error("getConsultationById error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/** The doctor's currently open draft, if any — used to resume after a reload. */
export function getActiveConsultation(doctorId: number) {
    try {
        const db = getDatabase();
        const row = db
            .prepare(`SELECT * FROM consultations WHERE doctor_id = ? AND status = 'InProgress' ORDER BY id DESC LIMIT 1`)
            .get(doctorId) as ConsultationRow | undefined;
        if (!row) return { status: "not_found" };
        return { status: "success", data: mapRowToConsultation(row) };
    } catch (error) {
        console.error("getActiveConsultation error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/** Partial save — the page autosaves as the doctor types, so absent keys are left alone. */
export function updateConsultation(id: number, draft: ConsultationDraft) {
    try {
        const db = getDatabase();
        const { clause, values } = buildUpdate(draft || {});
        if (!clause) return { status: "success", data: { consultationId: id } };

        const result = db.prepare(`UPDATE consultations SET ${clause} WHERE id = ?`).run(...values, id);
        if (result.changes === 0) return { status: "not_found", message: "Consultation not found" };
        return { status: "success", data: { consultationId: id } };
    } catch (error) {
        console.error("updateConsultation error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/**
 * Closes the visit. Saves any last edits, flips the draft to Completed — which
 * is the point it starts counting towards revenue — and marks the originating
 * appointment as honoured so it can no longer be swept into 'No-Show'.
 */
export function completeConsultation(id: number, draft?: ConsultationDraft) {
    try {
        const db = getDatabase();

        const row = db.prepare(`SELECT * FROM consultations WHERE id = ?`).get(id) as ConsultationRow | undefined;
        if (!row) return { status: "not_found", message: "Consultation not found" };

        const { clause, values } = buildUpdate(draft || {});

        const transaction = db.transaction(() => {
            if (clause) {
                db.prepare(`UPDATE consultations SET ${clause} WHERE id = ?`).run(...values, id);
            }
            db.prepare(`UPDATE consultations SET status = 'Completed' WHERE id = ?`).run(id);
            if (row.appointment_id) {
                db.prepare(`UPDATE appointments SET status = 'Completed' WHERE id = ?`).run(row.appointment_id);
            }
        });
        transaction();

        const updated = db.prepare(`SELECT * FROM consultations WHERE id = ?`).get(id) as ConsultationRow;
        return { status: "success", data: mapRowToConsultation(updated) };
    } catch (error) {
        console.error("completeConsultation error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/**
 * Everything produced during one visit. Returned in a single call so the
 * consultation page can refresh its prescription and document lists after
 * generating a PDF without a second round-trip.
 */
export function getConsultationArtifacts(consultationId: number) {
    try {
        return {
            status: "success",
            data: {
                prescriptions: getPrescriptionsByConsultationId(consultationId),
                documents: getDocumentsByConsultationId(consultationId),
            },
        };
    } catch (error) {
        console.error("getConsultationArtifacts error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

export function deleteConsultation(id: number) {
    try {
        const db = getDatabase();
        // Prescriptions and documents survive: their consultation_id is
        // ON DELETE SET NULL, so the patient keeps the paperwork.
        const result = db.prepare(`DELETE FROM consultations WHERE id = ?`).run(id);
        return { status: "success", data: { changes: result.changes } };
    } catch (error) {
        console.error("deleteConsultation error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

// The list getters below always return an array: callers iterate the result
// directly, so errors degrade to an empty list instead of a {status: "fail"}
// object that would crash a .map(). This matches appointments.ts.

type ListRow = ConsultationRow & {
    patient_name: string | null;
    patient_phone: string | null;
    prescription_count: number;
    document_count: number;
};

const LIST_SELECT = `
    SELECT c.*,
           p.full_name AS patient_name,
           p.phone_number AS patient_phone,
           (SELECT COUNT(*) FROM prescriptions pr WHERE pr.consultation_id = c.id) AS prescription_count,
           (SELECT COUNT(*) FROM patient_documents d WHERE d.consultation_id = c.id) AS document_count
    FROM consultations c
    LEFT JOIN patients p ON c.patient_id = p.id
`;

function mapListRow(row: ListRow): ConsultationListItem {
    return {
        ...mapRowToConsultation(row),
        patientName: row.patient_name ?? "",
        patientPhone: row.patient_phone,
        prescriptionCount: row.prescription_count,
        documentCount: row.document_count,
    };
}

export function getConsultationsByPatientId(patientId: number): ConsultationListItem[] {
    try {
        const db = getDatabase();
        const rows = db
            .prepare(`${LIST_SELECT} WHERE c.patient_id = ? ORDER BY c.consultation_datetime DESC`)
            .all(patientId) as ListRow[];
        return rows.map(mapListRow);
    } catch (error) {
        console.error("getConsultationsByPatientId error:", error);
        return [];
    }
}

export function getConsultationsByDay(doctorId: number, date: string): ConsultationListItem[] {
    try {
        const db = getDatabase();
        const rows = db
            .prepare(`${LIST_SELECT} WHERE c.doctor_id = ? AND strftime('%Y-%m-%d', c.consultation_datetime) = ? ORDER BY c.consultation_datetime ASC`)
            .all(doctorId, date) as ListRow[];
        return rows.map(mapListRow);
    } catch (error) {
        console.error("getConsultationsByDay error:", error);
        return [];
    }
}

export function getConsultationsByDateRange(doctorId: number, startDate: string, endDate: string): ConsultationListItem[] {
    try {
        const db = getDatabase();
        const rows = db
            .prepare(`${LIST_SELECT} WHERE c.doctor_id = ? AND c.consultation_datetime BETWEEN ? AND ? ORDER BY c.consultation_datetime DESC`)
            .all(doctorId, startDate, endOfDay(endDate)) as ListRow[];
        return rows.map(mapListRow);
    } catch (error) {
        console.error("getConsultationsByDateRange error:", error);
        return [];
    }
}
