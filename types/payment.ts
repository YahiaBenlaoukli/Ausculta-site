export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'cheque' | 'other';

export interface Payment {
    id: number;
    consultationId: number;
    patientId: number;
    /** Who took the money. Null for anything recorded before users were tracked. */
    userId: number | null;
    amount: number;
    method: PaymentMethod;
    year: number;
    sequence: number;
    /** Receipt number, e.g. "2026-0042". Derived from year + sequence. */
    receiptNumber: string;
    note: string | null;
    paidAt: string;
    createdAt: string;
}

export interface PaymentDraft {
    consultationId: number;
    amount: number;
    method?: PaymentMethod;
    note?: string | null;
}

/**
 * What one visit is worth and what is still owed on it.
 *
 * `due` resolves the consultation's NULL fee to the practice default, so it is
 * always a real number. `settled` mirrors consultations.is_paid: when it is
 * true the balance is zero regardless of whether payment rows exist, which is
 * what keeps pre-payments-table history from resurfacing as debt.
 */
export interface ConsultationBalance {
    consultationId: number;
    patientId: number;
    patientName: string;
    consultationDatetime: string;
    due: number;
    paid: number;
    balance: number;
    settled: boolean;
    payments: Payment[];
}

/** One patient's total debt across every unsettled visit. */
export interface PatientBalance {
    patientId: number;
    patientName: string;
    patientPhone: string | null;
    /** Unsettled visits, newest first. */
    visits: {
        consultationId: number;
        consultationDatetime: string;
        due: number;
        paid: number;
        balance: number;
    }[];
    totalDue: number;
    totalPaid: number;
    totalBalance: number;
    /** ISO datetime of the oldest unsettled visit — how long the debt has run. */
    oldestUnpaid: string;
}
