import type { PrescriptionLanguage } from './doctor';

/**
 * The certificate kinds a general practice issues routinely.
 *
 * `free` exists so the doctor is never blocked by a form we did not anticipate —
 * it is a blank body on the same letterhead, with the same serial number.
 */
export type CertificateType = 'work_leave' | 'fitness' | 'presence' | 'free';

export interface Certificate {
    id: number;
    userId: number;
    patientId: number;
    /** Set when the certificate was issued during a visit. */
    consultationId: number | null;
    type: CertificateType;
    /** Calendar year the serial belongs to. */
    year: number;
    /** Position within that year, per doctor. */
    sequence: number;
    /** Human-readable serial, e.g. "2026-0007". Derived from year + sequence. */
    serial: string;
    /** work_leave only. */
    startDate: string | null;
    endDate: string | null;
    days: number | null;
    /** The exact wording as issued — what a reprint reproduces. */
    body: string;
    language: PrescriptionLanguage;
    /** Row in patient_documents holding the generated PDF, if still present. */
    documentId: number | null;
    createdAt: string;
}

/** What the renderer sends to issue a new certificate. */
export interface CertificateDraft {
    patientId: number;
    consultationId?: number | null;
    type: CertificateType;
    startDate?: string | null;
    endDate?: string | null;
    body: string;
    language?: PrescriptionLanguage;
}
