export type PatientDocument = {
    id: number;
    patientId: number;
    prescriptionId?: number | null;
    /** Set when the file was attached during a consultation. */
    consultationId?: number | null;
    fileName: string;
    fileCategory: string;
    localPath: string;
    uploadDate: string;
}