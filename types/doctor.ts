// Language a prescription PDF can be generated in. Each maps to a template
// file under public/ordonnance/ (templateFr.pdf / templateEn.pdf).
export type PrescriptionLanguage = "fr" | "en";

/**
 * Which prescription artwork a doctor's PDFs use.
 *
 * "classic" is the original pdf-lib path that stamps text onto
 * public/ordonnance/template{Fr,En}.pdf. "colorful" is the bilingual FR/AR
 * letterhead rendered from HTML through Chromium — the two produce visibly
 * different documents, so the choice is stored per doctor rather than being a
 * global switch, and existing installs stay on "classic" unless they opt in.
 */
export type PrescriptionStyle = "classic" | "colorful";

/**
 * The bilingual header fields the colorful template draws.
 *
 * All optional: a doctor who never opens the Arabic fields gets a header with
 * those rows omitted rather than blank space, and the classic template ignores
 * every one of them.
 */
export type DoctorHeaderFields = {
    /** Doctor's name in Arabic script — the right-to-left mirror of `fullName`. */
    fullNameAr?: string;
    specialityAr?: string;
    /** e.g. "Diplômé de l'université de Paris". */
    diploma?: string;
    diplomaAr?: string;
    clinicName?: string;
    clinicNameAr?: string;
    /** Medical-council registration, printed as "N° d'ordre". */
    orderNumber?: string;
    /** Datelines read "Alger, le 06/01/2023" — this is the "Alger". */
    city?: string;
}

export type DoctorProfile = DoctorHeaderFields & {
    id: number;
    userId: number;
    fullName: string;
    email: string;
    phoneNumber: string;
    address: string;
    speciality: string;
    hasCompletedProfile: boolean;
    prescriptionStyle: PrescriptionStyle;
    pdfPath?: string;
    // English-language prescription-header preview (templateEn.pdf).
    pdfPathEn?: string;
}

/** Everything the Settings profile form can change, as one payload. */
export type DoctorProfileInput = DoctorHeaderFields & {
    fullName: string;
    speciality: string;
    phoneNumber: string;
    address: string;
    email: string;
    prescriptionStyle?: PrescriptionStyle;
}

export type PrescriptionMedicine = {
    id: number;
    prescriptionId: number;
    medicineName: string;
    dosage: string;
    frequency: string;
    duration: string;
    quantity: string;
    createdAt: string;
}

export type Prescription = {
    id: number;
    userId: number;
    patientId: number;
    /** Set when the prescription was written during a consultation. */
    consultationId?: number | null;
    notes: string | null;
    medicines: PrescriptionMedicine[];
    createdAt: string;
}

/** The five fields that describe one prescribed drug, without any row identity. */
export type MedicineLine = {
    medicineName: string;
    dosage: string;
    frequency: string;
    duration: string;
    quantity: string;
}

/**
 * A drug the doctor has prescribed before, offered as autocomplete. The posology
 * fields carry the values used the LAST time this drug was prescribed, so
 * picking a suggestion refills the whole row, not just the name.
 */
export type MedicineSuggestion = MedicineLine & {
    /** Times this drug appears across all prescriptions — drives the ordering. */
    uses: number;
}

/** A named, reusable set of medicines. */
export type PrescriptionTemplate = {
    id: number;
    userId: number;
    name: string;
    notes: string | null;
    medicines: MedicineLine[];
    createdAt: string;
}

