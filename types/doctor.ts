// Language a prescription PDF can be generated in. Each maps to a template
// file under public/ordonnance/ (templateFr.pdf / templateEn.pdf).
export type PrescriptionLanguage = "fr" | "en";

export type DoctorProfile = {
    id: number;
    userId: number;
    fullName: string;
    email: string;
    phoneNumber: string;
    address: string;
    speciality: string;
    hasCompletedProfile: boolean;
    pdfPath?: string;
    // English-language prescription-header preview (templateEn.pdf).
    pdfPathEn?: string;
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

