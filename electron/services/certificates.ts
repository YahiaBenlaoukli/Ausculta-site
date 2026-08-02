// Medical certificates: arrêt de travail, aptitude, présence, and a free-text
// form. Each one is stored structurally AND rendered to a PDF that is filed in
// patient_documents, so it shows up in the patient's file like any other document.
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { getDatabase } from "../db/db";
import { uploadDocument } from "./documents";
import { recordAudit } from "./audit";
import {
    CONTENT_WIDTH,
    MARGIN,
    createLetterhead,
    drawCentered,
    drawParagraph,
    drawSignatureBlock,
    unsupportedCharacters,
} from "./pdfLetterhead";
import type { DoctorProfile, PrescriptionLanguage } from "../../types/doctor";
import type { Certificate, CertificateDraft, CertificateType } from "../../types/certificate";
import type { Patient } from "../../types/patient";

const CERTIFICATES_DIR = path.join(app.getPath("userData"), "records", "certificates");

const TITLES: Record<PrescriptionLanguage, Record<CertificateType, string>> = {
    fr: {
        work_leave: "CERTIFICAT D'ARRÊT DE TRAVAIL",
        fitness: "CERTIFICAT MÉDICAL D'APTITUDE",
        presence: "CERTIFICAT DE PRÉSENCE",
        free: "CERTIFICAT MÉDICAL",
    },
    en: {
        work_leave: "MEDICAL LEAVE CERTIFICATE",
        fitness: "CERTIFICATE OF FITNESS",
        presence: "CERTIFICATE OF ATTENDANCE",
        free: "MEDICAL CERTIFICATE",
    },
};

const LABELS = {
    fr: {
        serial: "N° ",
        patient: "Patient : ",
        born: "né(e) le ",
        madeAt: "Fait le ",
    },
    en: {
        serial: "No. ",
        patient: "Patient: ",
        born: "born ",
        madeAt: "Issued ",
    },
} as const;

type CertificateRow = {
    id: number;
    user_id: number;
    patient_id: number;
    consultation_id: number | null;
    type: CertificateType;
    year: number;
    sequence: number;
    start_date: string | null;
    end_date: string | null;
    days: number | null;
    body: string;
    language: string;
    document_id: number | null;
    created_at: string;
};

/** "2026-0007" — the year plus a zero-padded position within it. */
export function formatSerial(year: number, sequence: number): string {
    return `${year}-${String(sequence).padStart(4, '0')}`;
}

function mapRow(row: CertificateRow): Certificate {
    return {
        id: row.id,
        userId: row.user_id,
        patientId: row.patient_id,
        consultationId: row.consultation_id,
        type: row.type,
        year: row.year,
        sequence: row.sequence,
        serial: formatSerial(row.year, row.sequence),
        startDate: row.start_date,
        endDate: row.end_date,
        days: row.days,
        body: row.body,
        language: row.language === 'en' ? 'en' : 'fr',
        documentId: row.document_id,
        createdAt: row.created_at,
    };
}

/**
 * Inclusive day count for a leave period — 1 to 1 September is one day off, not
 * zero. Returns null when either bound is missing or unparseable.
 */
export function countLeaveDays(startDate?: string | null, endDate?: string | null): number | null {
    if (!startDate || !endDate) return null;
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    return days > 0 ? days : null;
}

function formatDate(iso: string | null | undefined, language: PrescriptionLanguage): string {
    if (!iso) return '';
    const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString(language === 'en' ? 'en-GB' : 'fr-FR');
}

/**
 * Renders the certificate onto a fresh letterhead and files it as a patient
 * document. Returns the document row so the caller can link it.
 */
async function renderCertificatePdf(
    certificate: Certificate,
    patient: Patient,
    doctor: DoctorProfile
) {
    const language = certificate.language;
    const labels = LABELS[language];
    const letterhead = await createLetterhead(doctor, language);
    const { page, font, bold, width } = letterhead;

    let cursor = letterhead.contentTop;
    cursor = drawCentered(page, TITLES[language][certificate.type], { y: cursor, size: 14, font: bold, width });

    // Serial, centred under the title — this is what makes the document traceable.
    cursor = drawCentered(page, `${labels.serial}${certificate.serial}`, {
        y: cursor - 4, size: 9.5, font, width,
    });

    cursor -= 30;
    const identity = `${labels.patient}${patient.fullName}${patient.dateOfBirth ? `, ${labels.born}${formatDate(patient.dateOfBirth, language)}` : ''}`;
    cursor = drawParagraph(page, identity, { x: MARGIN, y: cursor, size: 11, font: bold, maxWidth: CONTENT_WIDTH });

    cursor -= 16;
    drawParagraph(page, certificate.body, {
        x: MARGIN, y: cursor, size: 11.5, font, maxWidth: CONTENT_WIDTH, lineHeight: 19,
    });

    drawSignatureBlock(letterhead, `${labels.madeAt}${formatDate(certificate.createdAt, language)}`, language);

    const bytes = await letterhead.pdfDoc.save();
    await fs.mkdir(CERTIFICATES_DIR, { recursive: true });
    const fileName = `certificat_${certificate.serial}_${patient.id}.pdf`;
    const outputPath = path.join(CERTIFICATES_DIR, fileName);
    await fs.writeFile(outputPath, bytes);

    return uploadDocument({
        patientId: patient.id,
        prescriptionId: null,
        consultationId: certificate.consultationId ?? null,
        fileCategory: "certificate",
        localPath: outputPath,
        fileName,
    });
}

/**
 * Issues a certificate: allocates the next serial, stores the row, renders the
 * PDF and files it against the patient.
 *
 * The serial is allocated inside the same transaction as the insert, so two
 * certificates issued in quick succession cannot collide — and the unique index
 * on (user_id, year, sequence) is the backstop if they somehow do.
 */
export async function createCertificate(userId: number, draft: CertificateDraft) {
    try {
        const db = getDatabase();
        const language: PrescriptionLanguage = draft.language === 'en' ? 'en' : 'fr';

        const body = (draft.body ?? '').trim();
        if (!body) return { status: "fail", message: "empty_body" };

        // Helvetica cannot encode Arabic; refuse clearly instead of letting
        // pdf-lib throw an opaque error halfway through rendering.
        const unsupported = unsupportedCharacters(body);
        if (unsupported.length) {
            return { status: "fail", message: "unsupported_characters", characters: unsupported };
        }

        const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(draft.patientId) as
            { id: number; full_name: string; date_of_birth: string } | undefined;
        if (!patient) return { status: "not_found", message: "patient_not_found" };

        const doctorRow = db.prepare(`SELECT * FROM doctor_profile WHERE user_id = ?`).get(userId) as
            Record<string, unknown> | undefined;
        if (!doctorRow) return { status: "not_found", message: "doctor_not_found" };

        const year = new Date().getFullYear();
        const days = draft.type === 'work_leave' ? countLeaveDays(draft.startDate, draft.endDate) : null;

        const insert = db.transaction(() => {
            const last = db
                .prepare(`SELECT COALESCE(MAX(sequence), 0) AS last FROM certificates WHERE user_id = ? AND year = ?`)
                .get(userId, year) as { last: number };
            const sequence = last.last + 1;

            const result = db
                .prepare(
                    `INSERT INTO certificates
                       (user_id, patient_id, consultation_id, type, year, sequence,
                        start_date, end_date, days, body, language)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .run(
                    userId,
                    draft.patientId,
                    draft.consultationId ?? null,
                    draft.type,
                    year,
                    sequence,
                    draft.type === 'work_leave' ? draft.startDate ?? null : null,
                    draft.type === 'work_leave' ? draft.endDate ?? null : null,
                    days,
                    body,
                    language
                );
            return { id: result.lastInsertRowid as number, sequence };
        });

        const { id } = insert();
        const row = db.prepare(`SELECT * FROM certificates WHERE id = ?`).get(id) as CertificateRow;
        const certificate = mapRow(row);

        const doctor: DoctorProfile = {
            id: doctorRow.id as number,
            userId: doctorRow.user_id as number,
            fullName: doctorRow.full_name as string,
            email: (doctorRow.email as string) ?? '',
            phoneNumber: (doctorRow.phone_number as string) ?? '',
            address: (doctorRow.address as string) ?? '',
            speciality: (doctorRow.speciality as string) ?? '',
            hasCompletedProfile: Boolean(doctorRow.has_completed_profile),
        };

        const document = await renderCertificatePdf(certificate, {
            id: patient.id,
            fullName: patient.full_name,
            dateOfBirth: patient.date_of_birth,
        } as Patient, doctor);

        db.prepare(`UPDATE certificates SET document_id = ? WHERE id = ?`).run(document.id, id);
        certificate.documentId = document.id;

        recordAudit('certificate.create', {
            entityType: 'patient',
            entityId: certificate.patientId,
            summary: `${certificate.type} no. ${certificate.serial} — ${patient.full_name}`,
            details: { type: certificate.type, serial: certificate.serial, days: certificate.days },
        });

        return { status: "success", data: { certificate, documentPath: document.localPath } };
    } catch (error) {
        console.error("createCertificate error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

export function getCertificatesByPatientId(patientId: number) {
    try {
        const db = getDatabase();
        const rows = db
            .prepare(`SELECT * FROM certificates WHERE patient_id = ? ORDER BY created_at DESC`)
            .all(patientId) as CertificateRow[];
        return { status: "success", data: rows.map(mapRow) };
    } catch (error) {
        console.error("getCertificatesByPatientId error:", error);
        return { status: "fail", message: (error as Error).message, data: [] as Certificate[] };
    }
}

export function getCertificatesByConsultationId(consultationId: number) {
    try {
        const db = getDatabase();
        const rows = db
            .prepare(`SELECT * FROM certificates WHERE consultation_id = ? ORDER BY created_at DESC`)
            .all(consultationId) as CertificateRow[];
        return { status: "success", data: rows.map(mapRow) };
    } catch (error) {
        console.error("getCertificatesByConsultationId error:", error);
        return { status: "fail", message: (error as Error).message, data: [] as Certificate[] };
    }
}

/**
 * Regenerates the PDF for an already-issued certificate from its stored body —
 * for when the paper copy is lost. The wording and serial are reproduced
 * exactly; only the file on disk is new.
 */
export async function reprintCertificate(id: number) {
    try {
        const db = getDatabase();
        const row = db.prepare(`SELECT * FROM certificates WHERE id = ?`).get(id) as CertificateRow | undefined;
        if (!row) return { status: "not_found" };
        const certificate = mapRow(row);

        const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(certificate.patientId) as
            { id: number; full_name: string; date_of_birth: string } | undefined;
        if (!patient) return { status: "not_found", message: "patient_not_found" };

        const doctorRow = db.prepare(`SELECT * FROM doctor_profile WHERE user_id = ?`).get(certificate.userId) as
            Record<string, unknown> | undefined;
        if (!doctorRow) return { status: "not_found", message: "doctor_not_found" };

        const doctor: DoctorProfile = {
            id: doctorRow.id as number,
            userId: doctorRow.user_id as number,
            fullName: doctorRow.full_name as string,
            email: (doctorRow.email as string) ?? '',
            phoneNumber: (doctorRow.phone_number as string) ?? '',
            address: (doctorRow.address as string) ?? '',
            speciality: (doctorRow.speciality as string) ?? '',
            hasCompletedProfile: Boolean(doctorRow.has_completed_profile),
        };

        const document = await renderCertificatePdf(certificate, {
            id: patient.id,
            fullName: patient.full_name,
            dateOfBirth: patient.date_of_birth,
        } as Patient, doctor);

        db.prepare(`UPDATE certificates SET document_id = ? WHERE id = ?`).run(document.id, id);
        return { status: "success", data: { documentPath: document.localPath } };
    } catch (error) {
        console.error("reprintCertificate error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/**
 * Deletes the certificate row. The generated PDF is deliberately left in the
 * patient's documents: it may already be in the patient's hands, and a record
 * of what was handed out is worth more than a tidy list.
 */
export function deleteCertificate(id: number) {
    try {
        const db = getDatabase();
        const doomed = db.prepare(`SELECT * FROM certificates WHERE id = ?`)
            .get(id) as CertificateRow | undefined;
        const result = db.prepare(`DELETE FROM certificates WHERE id = ?`).run(id);
        if (!result.changes) return { status: "not_found" };

        recordAudit('certificate.delete', {
            entityType: 'patient',
            entityId: doomed?.patient_id ?? null,
            summary: doomed ? `${doomed.type} no. ${formatSerial(doomed.year, doomed.sequence)}` : `#${id}`,
        });
        return { status: "success" };
    } catch (error) {
        console.error("deleteCertificate error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/** Yearly totals for the statistics page — including days of leave granted. */
export function getCertificateStatistics(userId: number, year: number) {
    try {
        const db = getDatabase();
        const row = db
            .prepare(
                `SELECT COUNT(*) AS total,
                        COALESCE(SUM(CASE WHEN type = 'work_leave' THEN 1 ELSE 0 END), 0) AS work_leave_count,
                        COALESCE(SUM(COALESCE(days, 0)), 0) AS total_leave_days
                 FROM certificates WHERE user_id = ? AND year = ?`
            )
            .get(userId, year) as { total: number; work_leave_count: number; total_leave_days: number };
        return { status: "success", data: row };
    } catch (error) {
        console.error("getCertificateStatistics error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}
