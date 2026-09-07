/**
 * A request for something to come out of the printer at the front desk.
 *
 * The doctor finishes a prescription in the consulting room and sends it; the
 * assistant's machine picks it up and prints it while the patient walks over.
 *
 * A job points at a filed document — it never carries the file. What is handed
 * to the patient has to be the same bytes as the patient's record, and the
 * only way to guarantee that is to print the artefact that was filed rather
 * than re-render it somewhere else from the same data.
 */
export type PrintJobStatus = 'pending' | 'printed' | 'cancelled';

export interface PrintJob {
    id: number;
    documentId: number;
    /** Where the document lives on the HOST; the desk fetches it by this. */
    documentPath: string;
    fileName: string;
    fileCategory: string;
    patientId: number;
    patientName: string;
    /** Null once the requesting account has been deleted. */
    requestedByName: string | null;
    status: PrintJobStatus;
    createdAt: string;
    printedAt: string | null;
    printedByName: string | null;
}

/** What the desk's printer picker offers. */
export interface PrinterOption {
    name: string;
    displayName: string;
    isDefault: boolean;
}
