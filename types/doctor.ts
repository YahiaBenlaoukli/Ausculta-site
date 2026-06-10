export type DoctorProfile = {
    id: number;
    userId: number;
    fullName: string;
    phoneNumber: string;
    address: string;
    speciality: string;
    hasCompletedProfile: boolean;
    pdfPath?: string;
}

export type Prescription = {
    id: number;
    userId: number;
    patientId: number;
    medicineName: string;
    dosage: string;
    frequency: string;
    duration: string;
    createdAt: string;
}

