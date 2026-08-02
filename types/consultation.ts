// A consultation is the record of an actual visit — what happened in the room.
// It is deliberately separate from `appointments`, which only records the
// *intent* to see a patient: a walk-in has a consultation and no appointment,
// a cancelled appointment has no consultation.
export type ConsultationStatus = "InProgress" | "Completed";

export type Consultation = {
    id: number;
    patientId: number;
    /** doctor_profile.id — same convention as appointments.doctor_id. */
    doctorId: number;
    /** null for a walk-in, or while a scheduled visit has not been linked yet. */
    appointmentId: number | null;
    /** Local 'YYYY-MM-DDTHH:MM:SS', matching appointment_datetime. */
    consultationDatetime: string;
    isWalkIn: boolean;
    reason: string | null;

    // Vitals. `weight` doubles as the value printed on the prescription PDF.
    weight: number | null;
    height: number | null;
    temperature: number | null;
    /** Free text: "120/80" is not reliably two numbers. */
    bloodPressure: string | null;
    heartRate: number | null;

    examNotes: string | null;
    diagnosis: string | null;
    treatmentPlan: string | null;
    followUpNotes: string | null;

    /** null means "bill at the practice's default price" (statistics falls back). */
    fee: number | null;
    isPaid: boolean;
    status: ConsultationStatus;
    createdAt: string;
};

// Every clinical field is optional so the consultation page can autosave
// partial edits without having to send the whole record each keystroke.
export type ConsultationDraft = Partial<Pick<Consultation,
    | "reason"
    | "weight"
    | "height"
    | "temperature"
    | "bloodPressure"
    | "heartRate"
    | "examNotes"
    | "diagnosis"
    | "treatmentPlan"
    | "followUpNotes"
    | "fee"
    | "isPaid"
>>;

/** A consultation joined with the patient and its artefact counts, for lists. */
export type ConsultationListItem = Consultation & {
    patientName: string;
    patientPhone: string | null;
    prescriptionCount: number;
    documentCount: number;
};
