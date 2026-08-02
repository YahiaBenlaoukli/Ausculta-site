import { getDatabase } from "../db/db";
import { escapeLike, normalizeSearchText } from "../db/normalize";
import type { GlobalSearchResults, SearchResult } from "../../types/search";

/**
 * Rows returned per group. Deliberately small: the palette is a jump-to
 * control, not a report. A doctor who needs the full list has the Patients /
 * Documents pages, which are linked from the footer when a group is truncated.
 */
const PER_GROUP_LIMIT = 6;

/** Below this, every query is a prefix of every record and the results are noise. */
const MIN_QUERY_LENGTH = 2;

const EMPTY: GlobalSearchResults = {
    patients: [],
    consultations: [],
    prescriptions: [],
    documents: [],
    total: 0,
    truncated: false,
};

/**
 * Builds `AND` conditions requiring every term to appear somewhere in `expr`,
 * plus the parameter list to bind. Word order is therefore irrelevant: typing
 * "ben mohammed" finds "Mohammed Ben Aïssa".
 *
 * `expr` must already be wrapped in norm() (or be a stored folded column) —
 * the terms handed back are folded, so an unfolded left-hand side never matches.
 */
function buildTermConditions(expr: string, terms: string[]): { sql: string; params: string[] } {
    return {
        sql: terms.map(() => `${expr} LIKE ? ESCAPE '\\'`).join(' AND '),
        params: terms.map((t) => `%${escapeLike(t)}%`),
    };
}

/**
 * uploadDocument() stores files as `${Date.now()}_${original}` to avoid
 * collisions. That prefix is an implementation detail — strip it for display,
 * but only when it really is a timestamp, so a file the patient genuinely
 * named "2024_analyses.pdf" keeps its name.
 */
function displayFileName(fileName: string): string {
    return fileName.replace(/^\d{13}_/, '');
}

/** First non-empty clinical field, trimmed to a single line for the result row. */
function firstLine(...candidates: (string | null | undefined)[]): string | null {
    for (const candidate of candidates) {
        const text = (candidate ?? '').replace(/\s+/g, ' ').trim();
        if (text) return text.length > 120 ? `${text.slice(0, 119)}…` : text;
    }
    return null;
}

/**
 * One query box over the whole practice: patients, visits, prescriptions and
 * documents. Every group is capped independently so a common term (a drug the
 * doctor prescribes daily) cannot crowd the other kinds of result out.
 */
export function globalSearch(query: string): GlobalSearchResults {
    const terms = normalizeSearchText(query).split(' ').filter(Boolean);
    if (!terms.length || normalizeSearchText(query).length < MIN_QUERY_LENGTH) return EMPTY;

    try {
        const db = getDatabase();

        // ── Patients ──────────────────────────────────────────────────────────
        // Uses the stored folded column (see electron/db/normalize.ts), which
        // already covers name, phone, SSN and address.
        const patientWhere = buildTermConditions('p.search_text', terms);
        const patientRows = db
            .prepare(
                `SELECT p.id, p.full_name, p.phone_number, p.date_of_birth, p.ssn
                 FROM patients p
                 WHERE ${patientWhere.sql}
                 ORDER BY p.full_name
                 LIMIT ?`
            )
            .all(...patientWhere.params, PER_GROUP_LIMIT + 1) as {
                id: number; full_name: string; phone_number: string | null; date_of_birth: string; ssn: string | null;
            }[];

        // ── Consultations ─────────────────────────────────────────────────────
        // The visit's free text, folded at query time by the norm() SQL function.
        const consultationBlob =
            `norm(COALESCE(c.diagnosis,'') || ' ' || COALESCE(c.reason,'') || ' ' ||
                  COALESCE(c.exam_notes,'') || ' ' || COALESCE(c.treatment_plan,'') || ' ' ||
                  COALESCE(c.follow_up_notes,''))`;
        const consultationWhere = buildTermConditions(consultationBlob, terms);
        const consultationRows = db
            .prepare(
                `SELECT c.id, c.patient_id, c.consultation_datetime, c.diagnosis, c.reason,
                        c.exam_notes, c.status, pt.full_name AS patient_name
                 FROM consultations c
                 JOIN patients pt ON pt.id = c.patient_id
                 WHERE ${consultationWhere.sql}
                 ORDER BY c.consultation_datetime DESC
                 LIMIT ?`
            )
            .all(...consultationWhere.params, PER_GROUP_LIMIT + 1) as {
                id: number; patient_id: number; consultation_datetime: string; diagnosis: string | null;
                reason: string | null; exam_notes: string | null; status: string; patient_name: string;
            }[];

        // ── Prescriptions ─────────────────────────────────────────────────────
        // A term matches if it appears in ANY of the prescription's medicine
        // lines or in its advice note; all terms must match somewhere.
        const prescriptionCondition = terms
            .map(
                () => `(EXISTS (SELECT 1 FROM prescription_medicines m
                                WHERE m.prescription_id = pr.id
                                  AND norm(m.medicine_name || ' ' || COALESCE(m.dosage,'')) LIKE ? ESCAPE '\\')
                        OR norm(COALESCE(pr.notes,'')) LIKE ? ESCAPE '\\')`
            )
            .join(' AND ');
        const prescriptionParams = terms.flatMap((t) => {
            const pattern = `%${escapeLike(t)}%`;
            return [pattern, pattern];
        });
        const prescriptionRows = db
            .prepare(
                `SELECT pr.id, pr.patient_id, pr.created_at, pr.notes,
                        pt.full_name AS patient_name,
                        (SELECT GROUP_CONCAT(m.medicine_name, ', ')
                         FROM prescription_medicines m WHERE m.prescription_id = pr.id) AS medicines
                 FROM prescriptions pr
                 JOIN patients pt ON pt.id = pr.patient_id
                 WHERE ${prescriptionCondition}
                 ORDER BY pr.created_at DESC
                 LIMIT ?`
            )
            .all(...prescriptionParams, PER_GROUP_LIMIT + 1) as {
                id: number; patient_id: number; created_at: string; notes: string | null;
                patient_name: string; medicines: string | null;
            }[];

        // ── Documents ─────────────────────────────────────────────────────────
        const documentWhere = buildTermConditions(`norm(d.file_name)`, terms);
        const documentRows = db
            .prepare(
                `SELECT d.id, d.patient_id, d.file_name, d.file_category, d.local_path, d.upload_date,
                        pt.full_name AS patient_name
                 FROM patient_documents d
                 JOIN patients pt ON pt.id = d.patient_id
                 WHERE ${documentWhere.sql}
                 ORDER BY d.upload_date DESC
                 LIMIT ?`
            )
            .all(...documentWhere.params, PER_GROUP_LIMIT + 1) as {
                id: number; patient_id: number; file_name: string; file_category: string | null;
                local_path: string; upload_date: string; patient_name: string;
            }[];

        // Each group was fetched with LIMIT+1 purely to detect truncation.
        const truncated =
            patientRows.length > PER_GROUP_LIMIT ||
            consultationRows.length > PER_GROUP_LIMIT ||
            prescriptionRows.length > PER_GROUP_LIMIT ||
            documentRows.length > PER_GROUP_LIMIT;

        const patients: SearchResult[] = patientRows.slice(0, PER_GROUP_LIMIT).map((row) => ({
            type: 'patient',
            id: row.id,
            title: row.full_name,
            subtitle: firstLine(row.phone_number, row.ssn),
            date: null,
            patientId: row.id,
            patientName: row.full_name,
        }));

        const consultations: SearchResult[] = consultationRows.slice(0, PER_GROUP_LIMIT).map((row) => ({
            type: 'consultation',
            id: row.id,
            title: firstLine(row.diagnosis, row.reason, row.exam_notes) ?? '',
            subtitle: row.patient_name,
            date: row.consultation_datetime,
            patientId: row.patient_id,
            patientName: row.patient_name,
        }));

        const prescriptions: SearchResult[] = prescriptionRows.slice(0, PER_GROUP_LIMIT).map((row) => ({
            type: 'prescription',
            id: row.id,
            title: firstLine(row.medicines, row.notes) ?? '',
            subtitle: row.patient_name,
            date: row.created_at,
            patientId: row.patient_id,
            patientName: row.patient_name,
        }));

        const documents: SearchResult[] = documentRows.slice(0, PER_GROUP_LIMIT).map((row) => ({
            type: 'document',
            id: row.id,
            title: displayFileName(row.file_name),
            subtitle: row.patient_name,
            date: row.upload_date,
            patientId: row.patient_id,
            patientName: row.patient_name,
            localPath: row.local_path,
        }));

        return {
            patients,
            consultations,
            prescriptions,
            documents,
            total: patients.length + consultations.length + prescriptions.length + documents.length,
            truncated,
        };
    } catch (error) {
        console.error("globalSearch error:", error);
        return EMPTY;
    }
}
