import { getDatabase } from "../db/db";
import { recordAudit } from "./audit";
import { getPrescriptionsByConsultationId } from "./prescription";
import { getDocumentsByConsultationId } from "./documents";
import { getCurrentUser } from "./session";
import type { Consultation, ConsultationDraft, ConsultationListItem } from "../../types/consultation";
import type { WaitingRoom, WaitingRoomEntry } from "../../types/waitingRoom";

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
    arrived_at: string | null;
    called_at: string | null;
    queue_priority: number;
    completed_at: string | null;
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
 *
 * This is the DOCTOR opening the room, so it stamps `called_at` — including
 * when it resumes a draft the desk created at check-in, which is exactly how a
 * patient moves out of the waiting room. `arrived_at` is filled in too if
 * nothing set it, so a standalone install with no front desk still produces
 * complete rows.
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
            if (!existing.called_at) {
                const now = localNow();
                db.prepare(`UPDATE consultations SET called_at = ?, arrived_at = COALESCE(arrived_at, ?) WHERE id = ?`)
                    .run(now, now, existing.id);
                existing.called_at = now;
                existing.arrived_at = existing.arrived_at ?? now;
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

        const now = localNow();
        const result = db
            .prepare(`
                INSERT INTO consultations (patient_id, doctor_id, appointment_id, consultation_datetime, is_walk_in, reason, arrived_at, called_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(patientId, doctorId, appointmentId ?? null, now, appointmentId ? 0 : 1, reason, now, now);

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

/**
 * The doctor's currently open draft, if any — used to resume after a reload.
 *
 * `called_at IS NOT NULL` is what distinguishes the visit in the room from the
 * queue: since the waiting room landed, every patient the desk checks in also
 * has an InProgress draft, and without this clause resuming would open whoever
 * happened to be checked in most recently rather than the person actually sat
 * in front of the doctor.
 */
export function getActiveConsultation(doctorId: number) {
    try {
        const db = getDatabase();
        const row = db
            .prepare(`SELECT * FROM consultations WHERE doctor_id = ? AND status = 'InProgress' AND called_at IS NOT NULL ORDER BY id DESC LIMIT 1`)
            .get(doctorId) as ConsultationRow | undefined;
        if (!row) return { status: "not_found" };
        return { status: "success", data: mapRowToConsultation(row) };
    } catch (error) {
        console.error("getActiveConsultation error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/** Partial save — the page autosaves as the doctor types, so absent keys are left alone. */
/**
 * Narrows a draft to what the caller's role may write.
 *
 * The assistant reaches this channel on purpose: taking a weight and a blood
 * pressure at check-in is front-desk work. Authoring the exam notes, the
 * diagnosis, the treatment plan or the fee is not. That split is per-FIELD, so
 * it cannot be expressed in permissions.ts — a channel there is reachable or it
 * is not — and has to live here.
 *
 * Written as an allowlist by construction: a clinical field added to
 * ConsultationDraft later is excluded until someone names it here, rather than
 * being silently writable by the desk from the day it ships.
 */
function scopeDraftToRole(draft: ConsultationDraft): ConsultationDraft {
    if (getCurrentUser()?.role !== 'assistant') return draft;
    // buildUpdate skips undefined, so the fields left out below stay untouched.
    return {
        reason: draft.reason,
        weight: draft.weight,
        height: draft.height,
        temperature: draft.temperature,
        bloodPressure: draft.bloodPressure,
        heartRate: draft.heartRate,
    };
}

export function updateConsultation(id: number, draft: ConsultationDraft) {
    try {
        const db = getDatabase();
        const { clause, values } = buildUpdate(scopeDraftToRole(draft || {}));
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
            // completed_at alongside the status flip, in the same transaction:
            // the two are the same fact, and a visit that is Completed with no
            // end time would silently drop out of the duration sample.
            db.prepare(`UPDATE consultations SET status = 'Completed', completed_at = ? WHERE id = ?`).run(localNow(), id);
            if (row.appointment_id) {
                db.prepare(`UPDATE appointments SET status = 'Completed' WHERE id = ?`).run(row.appointment_id);
            }
        });
        transaction();

        const updated = db.prepare(`SELECT * FROM consultations WHERE id = ?`).get(id) as ConsultationRow;

        const patient = db.prepare(`SELECT full_name FROM patients WHERE id = ?`)
            .get(updated.patient_id) as { full_name: string } | undefined;
        recordAudit('consultation.complete', {
            entityType: 'consultation',
            entityId: id,
            summary: `${patient?.full_name ?? `#${updated.patient_id}`}${updated.diagnosis ? ` — ${updated.diagnosis}` : ''}`,
            details: { patientId: updated.patient_id, fee: updated.fee, isPaid: Boolean(updated.is_paid) },
        });
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
        const doomed = db.prepare(`
            SELECT c.patient_id, c.consultation_datetime, c.diagnosis, c.status, p.full_name
            FROM consultations c JOIN patients p ON p.id = c.patient_id WHERE c.id = ?
        `).get(id) as { patient_id: number; consultation_datetime: string; diagnosis: string | null; status: string; full_name: string } | undefined;

        // Prescriptions and documents survive: their consultation_id is
        // ON DELETE SET NULL, so the patient keeps the paperwork.
        const result = db.prepare(`DELETE FROM consultations WHERE id = ?`).run(id);

        // Abandoned empty drafts are swept away on every launch; logging those
        // would bury the deletions a human actually performed.
        if (result.changes && doomed && doomed.status === 'Completed') {
            recordAudit('consultation.delete', {
                entityType: 'patient',
                entityId: doomed.patient_id,
                summary: `${doomed.full_name} — ${doomed.consultation_datetime}${doomed.diagnosis ? ` (${doomed.diagnosis})` : ''}`,
                details: { consultationId: id },
            });
        }
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

// ── La salle d'attente ──────────────────────────────────────────────────────
//
// Who is physically in the practice right now, derived from the two timestamps
// on the consultation rather than tracked in a table of its own. See
// types/waitingRoom.ts for why the queue is shaped this way.
//
// Every write below puts the state it expects in the WHERE clause and treats
// `changes === 0` as success, following markPrintJobPrinted in printQueue.ts:
// two seats poll these same rows every few seconds, and the second one arriving
// to find the work already done is the system working, not an error.

/**
 * The practice's doctor_profile.id, or null before one exists.
 *
 * Deliberately NOT getPracticeDoctorProfile() from prescription.ts: that one is
 * async and will CREATE a profile when it finds none, which is right for a
 * screen the doctor just opened and very wrong for something a poll reaches
 * every five seconds from both seats. This only ever reads.
 */
function practiceDoctorId(db: ReturnType<typeof getDatabase>): number | null {
    const row = (db.prepare(`
        SELECT dp.id FROM doctor_profile dp
        JOIN users u ON u.id = dp.user_id
        WHERE u.role IS NOT 'assistant'
        ORDER BY dp.id ASC LIMIT 1
    `).get() as { id: number } | undefined)
        ?? (db.prepare(`SELECT id FROM doctor_profile ORDER BY id ASC LIMIT 1`).get() as { id: number } | undefined);
    return row?.id ?? null;
}

/** Whole minutes between two local 'YYYY-MM-DDTHH:MM:SS' stamps, never negative. */
function minutesBetween(from: string, to: string): number {
    const elapsed = new Date(to).getTime() - new Date(from).getTime();
    return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / 60000)) : 0;
}

/** Last resort when the practice has no history and no bookings to learn from. */
const FALLBACK_VISIT_MINUTES = 20;
/** Below this many measured visits, the sample is noise rather than a median. */
const MIN_DURATION_SAMPLES = 5;

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * How long a consultation takes at this practice, in minutes.
 *
 * Three sources, best first, so the waiting-room board is credible on the day it
 * is switched on and gets more accurate on its own afterwards:
 *
 *   1. The MEASURED median of recent visits (called_at → completed_at).
 *   2. Failing that, the median slot length the practice BOOKS. The doctor
 *      already states their intended consultation length every time they make an
 *      appointment, which is a far better prior than a number picked here.
 *   3. Failing that — a brand-new install with no history at all — 20 minutes.
 *
 * Median rather than mean throughout: one visit that ran ninety minutes because
 * a patient was genuinely unwell must not push every waiting patient's estimate
 * up. The 2–120 minute window drops the other distortions — a visit closed by
 * accident seconds after opening, and one left open overnight.
 */
export function typicalVisitMinutes(): number {
    try {
        const db = getDatabase();

        const measured = db.prepare(`
            -- ROUND before CAST, not CAST alone. julianday returns a float, so a
            -- visit of exactly twelve minutes comes out as 11.99999… and a bare
            -- CAST truncates it to 11. That is a systematic one-minute
            -- under-estimate on every sample, and it compounds: by the fifth
            -- person in the queue the board would be five minutes optimistic.
            SELECT CAST(ROUND((julianday(completed_at) - julianday(called_at)) * 24 * 60) AS INTEGER) AS minutes
            FROM consultations
            WHERE status = 'Completed' AND called_at IS NOT NULL AND completed_at IS NOT NULL
            ORDER BY completed_at DESC
            LIMIT 20
        `).all() as { minutes: number | null }[];

        const usable = measured
            .map(row => row.minutes)
            .filter((m): m is number => typeof m === 'number' && m >= 2 && m <= 120);
        if (usable.length >= MIN_DURATION_SAMPLES) return median(usable);

        const booked = db.prepare(`
            SELECT duration_minutes AS minutes FROM appointments
            WHERE duration_minutes IS NOT NULL AND duration_minutes BETWEEN 2 AND 120
            ORDER BY appointment_datetime DESC LIMIT 50
        `).all() as { minutes: number }[];
        if (booked.length) return median(booked.map(row => row.minutes));

        return FALLBACK_VISIT_MINUTES;
    } catch (error) {
        console.error("typicalVisitMinutes error:", error);
        return FALLBACK_VISIT_MINUTES;
    }
}

/**
 * Rounded UP to the nearest 5 minutes.
 *
 * A board that says "~15 min" and is right is worth more than one that says
 * "13 min" and is wrong by four. Rounding up rather than to nearest because a
 * wait that comes in early is a good surprise and one that overruns is not.
 */
function roundEta(minutes: number): number {
    return Math.ceil(Math.max(0, minutes) / 5) * 5;
}

type QueueRow = ListRow & { appointment_datetime: string | null };

const QUEUE_SELECT = `
    SELECT c.*,
           p.full_name AS patient_name,
           p.phone_number AS patient_phone,
           a.appointment_datetime AS appointment_datetime,
           (SELECT COUNT(*) FROM prescriptions pr WHERE pr.consultation_id = c.id) AS prescription_count,
           (SELECT COUNT(*) FROM patient_documents d WHERE d.consultation_id = c.id) AS document_count
    FROM consultations c
    LEFT JOIN patients p ON c.patient_id = p.id
    LEFT JOIN appointments a ON c.appointment_id = a.id
`;

function mapQueueRow(row: QueueRow, now: string, etaMinutes: number): WaitingRoomEntry {
    const arrivedAt = row.arrived_at ?? row.consultation_datetime;
    return {
        ...mapListRow(row),
        arrivedAt,
        calledAt: row.called_at,
        isPriority: !!row.queue_priority,
        // Measured against the HOST's clock for everyone, because the two
        // machines in a clinic are routinely minutes apart and a queue where
        // each seat reports a different wait is worse than no wait at all.
        waitedMinutes: minutesBetween(arrivedAt, row.called_at ?? now),
        inRoomMinutes: row.called_at ? minutesBetween(row.called_at, now) : 0,
        etaMinutes,
        appointmentTime: row.appointment_datetime?.split("T")[1]?.substring(0, 5) ?? null,
    };
}

/**
 * The queue and the room, in one call so the poll is a single round-trip.
 *
 * Returns a bare object rather than the {status, data} convention — the callers
 * render it directly, and the registry carries a matching `fallback` so a client
 * that cannot reach the host shows an empty waiting room instead of an error
 * object where a list should be.
 */
export function getWaitingRoom(): WaitingRoom {
    const empty: WaitingRoom = { waiting: [], inRoom: null, typicalMinutes: FALLBACK_VISIT_MINUTES };
    try {
        const db = getDatabase();
        const doctorId = practiceDoctorId(db);
        if (!doctorId) return empty;

        const now = localNow();
        const waiting = db.prepare(`
            ${QUEUE_SELECT}
            WHERE c.doctor_id = ? AND c.status = 'InProgress'
              AND c.arrived_at IS NOT NULL AND c.called_at IS NULL
            ORDER BY c.queue_priority DESC, c.arrived_at ASC
        `).all(doctorId) as QueueRow[];

        const inRoom = db.prepare(`
            ${QUEUE_SELECT}
            WHERE c.doctor_id = ? AND c.status = 'InProgress' AND c.called_at IS NOT NULL
            ORDER BY c.called_at DESC LIMIT 1
        `).get(doctorId) as QueueRow | undefined;

        // How much longer each waiting patient has, computed HERE rather than in
        // the renderer so the desk's screen and the waiting-room board can never
        // quote a patient two different numbers.
        //
        // The person in the room is assumed to have `typical` minutes from when
        // they were called, so an overrunning consultation collapses their share
        // to zero rather than going negative and flattering everyone behind.
        const typical = typicalVisitMinutes();
        const inRoomRemaining = inRoom?.called_at
            ? Math.max(0, typical - minutesBetween(inRoom.called_at, now))
            : 0;

        return {
            waiting: waiting.map((row, index) =>
                mapQueueRow(row, now, roundEta(inRoomRemaining + index * typical))),
            inRoom: inRoom ? mapQueueRow(inRoom, now, 0) : null,
            typicalMinutes: typical,
        };
    } catch (error) {
        console.error("getWaitingRoom error:", error);
        return empty;
    }
}

/**
 * The desk's action: this patient is here.
 *
 * Opens the same draft startConsultation would — so vitals taken while they wait
 * land on the visit the doctor will pick up — but leaves `called_at` NULL, which
 * is what puts them in the queue instead of in the room.
 */
export function checkInPatient(patientId: number, appointmentId?: number) {
    try {
        const db = getDatabase();
        const doctorId = practiceDoctorId(db);
        if (!doctorId) return { status: "fail", message: "Aucun profil médecin n'est configuré." };

        const patient = db.prepare(`SELECT full_name FROM patients WHERE id = ?`)
            .get(patientId) as { full_name: string } | undefined;
        if (!patient) return { status: "not_found", message: "Patient introuvable" };

        const now = localNow();

        // Same resume-don't-duplicate rule as startConsultation: checking in
        // twice (both seats, or a double-click) must not open a second visit.
        const existing = db
            .prepare(`SELECT * FROM consultations WHERE patient_id = ? AND doctor_id = ? AND status = 'InProgress' ORDER BY id DESC LIMIT 1`)
            .get(patientId, doctorId) as ConsultationRow | undefined;
        if (existing) {
            if (appointmentId && !existing.appointment_id) {
                db.prepare(`UPDATE consultations SET appointment_id = ?, is_walk_in = 0 WHERE id = ?`).run(appointmentId, existing.id);
            }
            // Only stamps an arrival that is missing. Re-checking in someone
            // already waiting must not restart their clock and send them to the
            // back of a queue they have been sitting in for half an hour.
            db.prepare(`UPDATE consultations SET arrived_at = COALESCE(arrived_at, ?) WHERE id = ?`).run(now, existing.id);
            const resumed = db.prepare(`SELECT * FROM consultations WHERE id = ?`).get(existing.id) as ConsultationRow;
            return { status: "success", data: mapRowToConsultation(resumed) };
        }

        let reason: string | null = null;
        if (appointmentId) {
            const appointment = db.prepare(`SELECT reason FROM appointments WHERE id = ?`)
                .get(appointmentId) as { reason: string | null } | undefined;
            reason = appointment?.reason ?? null;
        }

        const result = db.prepare(`
            INSERT INTO consultations (patient_id, doctor_id, appointment_id, consultation_datetime, is_walk_in, reason, arrived_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(patientId, doctorId, appointmentId ?? null, now, appointmentId ? 0 : 1, reason, now);

        const created = db.prepare(`SELECT * FROM consultations WHERE id = ?`)
            .get(result.lastInsertRowid as number) as ConsultationRow;

        recordAudit('consultation.check_in', {
            entityType: 'consultation',
            entityId: created.id,
            summary: patient.full_name,
            details: { patientId, appointmentId: appointmentId ?? null, walkIn: !appointmentId },
        });
        return { status: "success", data: mapRowToConsultation(created) };
    } catch (error) {
        console.error("checkInPatient error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/**
 * The doctor's action: come through.
 *
 * Kept separate from startConsultation because it is reachable by the doctor
 * only — deciding the room is free is not the desk's call — and because the
 * renderer navigates to the consultation immediately afterwards with the patient
 * it already has in hand.
 */
export function callPatientIn(consultationId: number) {
    try {
        const db = getDatabase();
        const row = db.prepare(`SELECT * FROM consultations WHERE id = ?`)
            .get(consultationId) as ConsultationRow | undefined;
        if (!row) return { status: "not_found", message: "Consultation not found" };

        const result = db
            .prepare(`UPDATE consultations SET called_at = ? WHERE id = ? AND called_at IS NULL`)
            .run(localNow(), consultationId);

        // Already called in — the other seat got there first, or the button was
        // pressed twice. The patient is in the room either way, which is what
        // the caller asked for.
        if (result.changes === 0) return { status: "success", data: { alreadyCalled: true } };

        const patient = db.prepare(`SELECT full_name FROM patients WHERE id = ?`)
            .get(row.patient_id) as { full_name: string } | undefined;
        recordAudit('consultation.call_in', {
            entityType: 'consultation',
            entityId: consultationId,
            summary: patient?.full_name ?? `#${row.patient_id}`,
            details: {
                patientId: row.patient_id,
                waitedMinutes: minutesBetween(row.arrived_at ?? row.consultation_datetime, localNow()),
            },
        });
        return { status: "success", data: { alreadyCalled: false } };
    } catch (error) {
        console.error("callPatientIn error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/** Floats a waiting patient to the front of the queue, or puts them back in line. */
export function setQueuePriority(consultationId: number, priority: boolean) {
    try {
        const db = getDatabase();
        const result = db
            .prepare(`UPDATE consultations SET queue_priority = ? WHERE id = ? AND called_at IS NULL`)
            .run(priority ? 1 : 0, consultationId);
        // Zero changes means they have already been called in, so the ordering
        // no longer applies to them. Nothing to report.
        return { status: "success", data: { changes: result.changes } };
    } catch (error) {
        console.error("setQueuePriority error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/**
 * The patient left, or was checked in by mistake.
 *
 * Deletes the draft rather than flagging it, because a visit that never happened
 * should not sit in the patient's history — but only while it is genuinely empty.
 * The conditions mirror discardAbandonedConsultations() in db.ts: anything
 * carrying a vital sign, a note, a prescription or a document is a record of
 * something that did happen, and the desk does not get to erase it.
 */
export function removeFromQueue(consultationId: number) {
    try {
        const db = getDatabase();
        const row = db.prepare(`
            SELECT c.patient_id, c.called_at, p.full_name
            FROM consultations c LEFT JOIN patients p ON p.id = c.patient_id
            WHERE c.id = ?
        `).get(consultationId) as { patient_id: number; called_at: string | null; full_name: string | null } | undefined;
        if (!row) return { status: "not_found", message: "Consultation not found" };
        if (row.called_at) {
            return { status: "fail", message: "Ce patient est déjà en consultation." };
        }

        const result = db.prepare(`
            DELETE FROM consultations
            WHERE id = ? AND status = 'InProgress' AND called_at IS NULL
              AND COALESCE(reason, '') = ''
              AND COALESCE(exam_notes, '') = ''
              AND COALESCE(diagnosis, '') = ''
              AND COALESCE(treatment_plan, '') = ''
              AND COALESCE(follow_up_notes, '') = ''
              AND weight IS NULL AND height IS NULL AND temperature IS NULL
              AND blood_pressure IS NULL AND heart_rate IS NULL
              AND NOT EXISTS (SELECT 1 FROM prescriptions pr WHERE pr.consultation_id = consultations.id)
              AND NOT EXISTS (SELECT 1 FROM patient_documents d WHERE d.consultation_id = consultations.id)
        `).run(consultationId);

        if (result.changes === 0) {
            // Something was recorded while they waited — vitals, usually. The
            // visit is a record now, and unmaking it is the doctor's call.
            return { status: "fail", code: "has_content", message: "Des données ont déjà été saisies pour cette visite." };
        }

        recordAudit('consultation.remove_from_queue', {
            entityType: 'patient',
            entityId: row.patient_id,
            summary: row.full_name ?? `#${row.patient_id}`,
            details: { consultationId },
        });
        return { status: "success", data: { changes: result.changes } };
    } catch (error) {
        console.error("removeFromQueue error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}
