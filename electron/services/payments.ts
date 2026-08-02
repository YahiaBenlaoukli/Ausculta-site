// Money received, and who still owes what.
//
// The key idea, which the rest of this file depends on: an outstanding balance
// is a STOCK, not a flow. statistics.ts answers "how much went unpaid in March";
// this module answers "who owes me money right now", which has no date range —
// a visit from March that is still unpaid must appear today.
import { getDatabase } from "../db/db";
import { uploadDocument } from "./documents";
import { recordAudit } from "./audit";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
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
import type {
    ConsultationBalance,
    PatientBalance,
    Payment,
    PaymentDraft,
    PaymentMethod,
} from "../../types/payment";

const RECEIPTS_DIR = path.join(app.getPath("userData"), "records", "receipts");

/** Mirrors statistics.ts, which takes the same fallback from the renderer. */
const FALLBACK_FEE = 2000;

const VALID_METHODS: PaymentMethod[] = ['cash', 'card', 'transfer', 'cheque', 'other'];

type PaymentRow = {
    id: number;
    consultation_id: number;
    patient_id: number;
    user_id: number | null;
    amount: number;
    method: PaymentMethod;
    year: number;
    sequence: number;
    note: string | null;
    paid_at: string;
    created_at: string;
};

export function formatReceiptNumber(year: number, sequence: number): string {
    return `${year}-${String(sequence).padStart(4, '0')}`;
}

function mapPayment(row: PaymentRow): Payment {
    return {
        id: row.id,
        consultationId: row.consultation_id,
        patientId: row.patient_id,
        userId: row.user_id,
        amount: row.amount,
        method: row.method,
        year: row.year,
        sequence: row.sequence,
        receiptNumber: formatReceiptNumber(row.year, row.sequence),
        note: row.note,
        paidAt: row.paid_at,
        createdAt: row.created_at,
    };
}

/**
 * Money is stored as REAL, so sums drift (0.1 + 0.2). Round to cents before
 * comparing, or a fully-paid visit can be left owing 0.0000000001 and show up
 * forever in the outstanding list.
 */
function round(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * Recomputes consultations.is_paid from the payments on that visit.
 *
 * Called after every insert and delete so the flag never drifts from the rows.
 * Deliberately does NOT clear the flag when there are no payments at all: that
 * is the pre-payments-table state, where is_paid was set by hand and is the
 * only truth available.
 */
function refreshSettledFlag(consultationId: number, defaultFee: number) {
    const db = getDatabase();
    const row = db
        .prepare(
            `SELECT COALESCE(c.fee, ?) AS due,
                    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.consultation_id = c.id), 0) AS paid,
                    (SELECT COUNT(*) FROM payments p WHERE p.consultation_id = c.id) AS payment_count
             FROM consultations c WHERE c.id = ?`
        )
        .get(defaultFee, consultationId) as { due: number; paid: number; payment_count: number } | undefined;

    if (!row || !row.payment_count) return;
    db.prepare(`UPDATE consultations SET is_paid = ? WHERE id = ?`)
        .run(round(row.paid) >= round(row.due) ? 1 : 0, consultationId);
}

/**
 * Records a payment and allocates its receipt number.
 *
 * Serial allocation and insert share one transaction so two payments taken in
 * the same second cannot claim the same receipt number; the unique index on
 * (year, sequence) is the backstop.
 */
export function recordPayment(draft: PaymentDraft, userId?: number | null, defaultFee: number = FALLBACK_FEE) {
    try {
        const amount = Number(draft.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            return { status: "fail", message: "invalid_amount" };
        }

        const method: PaymentMethod = VALID_METHODS.includes(draft.method as PaymentMethod)
            ? (draft.method as PaymentMethod)
            : 'cash';

        const db = getDatabase();
        const consultation = db
            .prepare(`SELECT id, patient_id FROM consultations WHERE id = ?`)
            .get(draft.consultationId) as { id: number; patient_id: number } | undefined;
        if (!consultation) return { status: "not_found", message: "consultation_not_found" };

        const year = new Date().getFullYear();

        const insert = db.transaction(() => {
            const last = db
                .prepare(`SELECT COALESCE(MAX(sequence), 0) AS last FROM payments WHERE year = ?`)
                .get(year) as { last: number };

            const result = db
                .prepare(
                    `INSERT INTO payments
                       (consultation_id, patient_id, user_id, amount, method, year, sequence, note)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .run(
                    consultation.id,
                    consultation.patient_id,
                    userId ?? null,
                    round(amount),
                    method,
                    year,
                    last.last + 1,
                    draft.note?.trim() || null
                );
            return result.lastInsertRowid as number;
        });

        const id = insert();
        refreshSettledFlag(consultation.id, defaultFee);

        const row = db.prepare(`SELECT * FROM payments WHERE id = ?`).get(id) as PaymentRow;
        const payment = mapPayment(row);
        recordAudit('payment.record', {
            entityType: 'consultation',
            entityId: consultation.id,
            summary: `${payment.amount} (${payment.method}) — receipt ${payment.receiptNumber}`,
            details: { amount: payment.amount, method: payment.method, receiptNumber: payment.receiptNumber },
        });
        return { status: "success", data: payment };
    } catch (error) {
        console.error("recordPayment error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

export function getPaymentsByConsultationId(consultationId: number) {
    try {
        const db = getDatabase();
        const rows = db
            .prepare(`SELECT * FROM payments WHERE consultation_id = ? ORDER BY paid_at, id`)
            .all(consultationId) as PaymentRow[];
        return { status: "success", data: rows.map(mapPayment) };
    } catch (error) {
        console.error("getPaymentsByConsultationId error:", error);
        return { status: "fail", message: (error as Error).message, data: [] as Payment[] };
    }
}

/**
 * Removes a payment (a mis-keyed amount, a bounced cheque) and re-settles the
 * visit. The receipt number is NOT reused — a gap is the correct trace that
 * something was voided.
 */
export function deletePayment(id: number, defaultFee: number = FALLBACK_FEE) {
    try {
        const db = getDatabase();
        // Captured before the row goes: the amount and receipt number are the
        // whole point of logging a voided payment.
        const row = db.prepare(`SELECT * FROM payments WHERE id = ?`)
            .get(id) as PaymentRow | undefined;
        if (!row) return { status: "not_found" };
        const voided = mapPayment(row);

        db.prepare(`DELETE FROM payments WHERE id = ?`).run(id);
        recordAudit('payment.delete', {
            entityType: 'consultation',
            entityId: row.consultation_id,
            summary: `${voided.amount} — receipt ${voided.receiptNumber} voided`,
            details: { amount: voided.amount, method: voided.method, receiptNumber: voided.receiptNumber },
        });

        // With the last payment gone the visit is unpaid again, and
        // refreshSettledFlag bails out when there are no rows left — so clear
        // the flag here rather than leaving it stuck on "settled".
        const remaining = db.prepare(`SELECT COUNT(*) AS n FROM payments WHERE consultation_id = ?`)
            .get(row.consultation_id) as { n: number };
        if (!remaining.n) {
            db.prepare(`UPDATE consultations SET is_paid = 0 WHERE id = ?`).run(row.consultation_id);
        } else {
            refreshSettledFlag(row.consultation_id, defaultFee);
        }

        return { status: "success" };
    } catch (error) {
        console.error("deletePayment error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/** Due / paid / balance for one visit, with its payment history. */
export function getConsultationBalance(consultationId: number, defaultFee: number = FALLBACK_FEE) {
    try {
        const db = getDatabase();
        const row = db
            .prepare(
                `SELECT c.id, c.patient_id, c.consultation_datetime, c.is_paid,
                        COALESCE(c.fee, ?) AS due,
                        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.consultation_id = c.id), 0) AS paid,
                        pt.full_name AS patient_name
                 FROM consultations c
                 JOIN patients pt ON pt.id = c.patient_id
                 WHERE c.id = ?`
            )
            .get(defaultFee, consultationId) as
            {
                id: number; patient_id: number; consultation_datetime: string; is_paid: number;
                due: number; paid: number; patient_name: string;
            } | undefined;

        if (!row) return { status: "not_found" };

        const payments = db
            .prepare(`SELECT * FROM payments WHERE consultation_id = ? ORDER BY paid_at, id`)
            .all(consultationId) as PaymentRow[];

        const settled = Boolean(row.is_paid);
        const data: ConsultationBalance = {
            consultationId: row.id,
            patientId: row.patient_id,
            patientName: row.patient_name,
            consultationDatetime: row.consultation_datetime,
            due: round(row.due),
            paid: round(row.paid),
            balance: settled ? 0 : Math.max(0, round(row.due - row.paid)),
            settled,
            payments: payments.map(mapPayment),
        };
        return { status: "success", data };
    } catch (error) {
        console.error("getConsultationBalance error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/**
 * Every patient who still owes money, worst first. No date range on purpose —
 * this is the "who owes me" list, and a debt does not stop existing because the
 * visit was last month.
 *
 * Only Completed visits count: an InProgress draft is a patient still in the
 * room, not a debtor.
 */
export function getOutstandingBalances(defaultFee: number = FALLBACK_FEE) {
    try {
        const db = getDatabase();
        const rows = db
            .prepare(
                `SELECT c.id, c.patient_id, c.consultation_datetime,
                        COALESCE(c.fee, ?) AS due,
                        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.consultation_id = c.id), 0) AS paid,
                        pt.full_name AS patient_name, pt.phone_number AS patient_phone
                 FROM consultations c
                 JOIN patients pt ON pt.id = c.patient_id
                 WHERE c.status = 'Completed' AND c.is_paid = 0
                 ORDER BY c.consultation_datetime DESC`
            )
            .all(defaultFee) as {
                id: number; patient_id: number; consultation_datetime: string;
                due: number; paid: number; patient_name: string; patient_phone: string | null;
            }[];

        const byPatient = new Map<number, PatientBalance>();

        for (const row of rows) {
            const balance = round(row.due - row.paid);
            // A visit flagged unpaid but fully covered by payments is a data
            // artefact, not a debt — skip rather than show a zero-value row.
            if (balance <= 0) continue;

            let entry = byPatient.get(row.patient_id);
            if (!entry) {
                entry = {
                    patientId: row.patient_id,
                    patientName: row.patient_name,
                    patientPhone: row.patient_phone,
                    visits: [],
                    totalDue: 0,
                    totalPaid: 0,
                    totalBalance: 0,
                    oldestUnpaid: row.consultation_datetime,
                };
                byPatient.set(row.patient_id, entry);
            }

            entry.visits.push({
                consultationId: row.id,
                consultationDatetime: row.consultation_datetime,
                due: round(row.due),
                paid: round(row.paid),
                balance,
            });
            entry.totalDue = round(entry.totalDue + row.due);
            entry.totalPaid = round(entry.totalPaid + row.paid);
            entry.totalBalance = round(entry.totalBalance + balance);
            if (row.consultation_datetime < entry.oldestUnpaid) {
                entry.oldestUnpaid = row.consultation_datetime;
            }
        }

        const data = [...byPatient.values()].sort((a, b) => b.totalBalance - a.totalBalance);
        const totalOutstanding = round(data.reduce((sum, entry) => sum + entry.totalBalance, 0));

        return { status: "success", data: { patients: data, totalOutstanding, patientCount: data.length } };
    } catch (error) {
        console.error("getOutstandingBalances error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/**
 * Renders a receipt for one payment on the practice letterhead and files it in
 * the patient's documents. Reprintable: the row holds everything it needs, so
 * calling this again reproduces the same receipt number and amount.
 */
export async function generateReceiptPdf(paymentId: number, language: PrescriptionLanguage = 'fr', defaultFee: number = FALLBACK_FEE) {
    try {
        const db = getDatabase();
        const row = db.prepare(`SELECT * FROM payments WHERE id = ?`).get(paymentId) as PaymentRow | undefined;
        if (!row) return { status: "not_found" };
        const payment = mapPayment(row);

        const patient = db.prepare(`SELECT id, full_name FROM patients WHERE id = ?`)
            .get(payment.patientId) as { id: number; full_name: string } | undefined;
        if (!patient) return { status: "not_found", message: "patient_not_found" };

        const visit = db
            .prepare(
                `SELECT c.consultation_datetime, c.doctor_id, COALESCE(c.fee, ?) AS due,
                        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.consultation_id = c.id), 0) AS paid,
                        d.user_id
                 FROM consultations c
                 JOIN doctor_profile d ON d.id = c.doctor_id
                 WHERE c.id = ?`
            )
            .get(defaultFee, payment.consultationId) as
            { consultation_datetime: string; doctor_id: number; due: number; paid: number; user_id: number } | undefined;
        if (!visit) return { status: "not_found", message: "consultation_not_found" };

        const doctorRow = db.prepare(`SELECT * FROM doctor_profile WHERE user_id = ?`)
            .get(visit.user_id) as Record<string, unknown> | undefined;
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

        const labels = RECEIPT_LABELS[language];
        const fmtDate = (iso: string) => {
            const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
            return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(language === 'en' ? 'en-GB' : 'fr-FR');
        };
        const money = (value: number) => `${value.toLocaleString(language === 'en' ? 'en-GB' : 'fr-FR')} ${labels.currency}`;

        const remaining = Math.max(0, round(visit.due - visit.paid));
        const bodyLines = [
            `${labels.received}${money(payment.amount)}`,
            `${labels.from}${patient.full_name}`,
            `${labels.forVisit}${fmtDate(visit.consultation_datetime)}`,
            `${labels.method}${labels.methods[payment.method]}`,
            `${labels.total}${money(round(visit.due))}   ·   ${labels.alreadyPaid}${money(round(visit.paid))}   ·   ${labels.remaining}${money(remaining)}`,
        ];
        if (payment.note) bodyLines.push(`${labels.note}${payment.note}`);
        const body = bodyLines.join('\n');

        // Same Latin-only font limit as certificates; a note in Arabic would
        // otherwise blow up inside pdf-lib rather than here.
        const unsupported = unsupportedCharacters(body);
        if (unsupported.length) {
            return { status: "fail", message: "unsupported_characters", characters: unsupported };
        }

        const letterhead = await createLetterhead(doctor, language);
        const { page, font, bold, width } = letterhead;

        let cursor = letterhead.contentTop;
        cursor = drawCentered(page, labels.title, { y: cursor, size: 14, font: bold, width });
        cursor = drawCentered(page, `${labels.serial}${payment.receiptNumber}`, { y: cursor - 4, size: 9.5, font, width });

        cursor -= 34;
        cursor = drawParagraph(page, `${labels.received}${money(payment.amount)}`, {
            x: MARGIN, y: cursor, size: 13, font: bold, maxWidth: CONTENT_WIDTH,
        });

        cursor -= 12;
        drawParagraph(page, bodyLines.slice(1).join('\n'), {
            x: MARGIN, y: cursor, size: 11, font, maxWidth: CONTENT_WIDTH, lineHeight: 19,
        });

        drawSignatureBlock(letterhead, `${labels.madeAt}${fmtDate(payment.paidAt)}`, language);

        const bytes = await letterhead.pdfDoc.save();
        await fs.mkdir(RECEIPTS_DIR, { recursive: true });
        const fileName = `recu_${payment.receiptNumber}_${patient.id}.pdf`;
        const outputPath = path.join(RECEIPTS_DIR, fileName);
        await fs.writeFile(outputPath, bytes);

        const document = await uploadDocument({
            patientId: patient.id,
            prescriptionId: null,
            consultationId: payment.consultationId,
            fileCategory: "receipt",
            localPath: outputPath,
            fileName,
        });

        return { status: "success", data: { documentPath: document.localPath, receiptNumber: payment.receiptNumber } };
    } catch (error) {
        console.error("generateReceiptPdf error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

const RECEIPT_LABELS = {
    fr: {
        title: "REÇU DE PAIEMENT",
        serial: "N° ",
        currency: "DA",
        received: "Reçu la somme de : ",
        from: "De la part de : ",
        forVisit: "Au titre de la consultation du : ",
        method: "Mode de règlement : ",
        total: "Total dû : ",
        alreadyPaid: "Déjà réglé : ",
        remaining: "Reste à payer : ",
        note: "Note : ",
        madeAt: "Fait le ",
        methods: {
            cash: "Espèces", card: "Carte", transfer: "Virement", cheque: "Chèque", other: "Autre",
        } as Record<PaymentMethod, string>,
    },
    en: {
        title: "PAYMENT RECEIPT",
        serial: "No. ",
        currency: "DA",
        received: "Received the sum of: ",
        from: "From: ",
        forVisit: "For the consultation of: ",
        method: "Payment method: ",
        total: "Total due: ",
        alreadyPaid: "Already paid: ",
        remaining: "Remaining: ",
        note: "Note: ",
        madeAt: "Issued ",
        methods: {
            cash: "Cash", card: "Card", transfer: "Transfer", cheque: "Cheque", other: "Other",
        } as Record<PaymentMethod, string>,
    },
} as const;
