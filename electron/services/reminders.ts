/**
 * Tomorrow's appointment reminders, delivered over WhatsApp click-to-chat.
 *
 * WHY THIS CHANNEL. wa.me needs no Meta Business account, no approved message
 * template, no access token and costs nothing per message. The price is that it
 * is completely blind: shell.openExternal resolves as soon as the OS accepts
 * the URL, and everything interesting happens after that inside WhatsApp —
 * message sent, "this number is not on WhatsApp", or a request to link a
 * device. None of it comes back.
 *
 * Two consequences run through this whole file:
 *
 *   1. Nothing here may claim a message was delivered. The furthest the app can
 *      go on its own is 'opened'; 'sent' and 'failed' arrive later via
 *      setReminderOutcome, i.e. from the person who watched it happen.
 *   2. The one failure worth predicting is predicted. A fixed line is never on
 *      WhatsApp, so phone.ts classifies numbers up front and those rows are
 *      refused before a click is wasted on them.
 *
 * The message body is built in the RENDERER and passed in. It is patient-facing
 * prose that has to exist in fr, en and ar, and the locale files are where all
 * three already live; duplicating the templates in the main process to avoid
 * one string parameter would guarantee the two copies drift. What this side
 * still owns is everything the renderer must not be trusted with: the phone
 * number, the appointment's current status, and the record that it happened.
 */

import { shell } from "electron";
import { getDatabase } from "../db/db";
import { normalizePhone } from "./phone";
import { recordAudit } from "./audit";
import type {
    ReminderErrorCode,
    ReminderList,
    ReminderOutcome,
    ReminderStatus,
    ReminderTarget,
} from "../../types/reminder";

/**
 * Ceiling on the message text put into the URL. Our own templates land around
 * 130 characters; this is only here so a pathological value cannot build a URL
 * long enough for the OS to reject (and take the reminder down with it).
 */
const MAX_MESSAGE_LENGTH = 700;

type TargetRow = {
    id: number;
    patient_id: number;
    appointment_datetime: string;
    full_name: string | null;
    phone_number: string | null;
    reminder_status: Exclude<ReminderStatus, 'none'> | null;
    reminded_at: string | null;
};

function fail(code: ReminderErrorCode, message: string) {
    return { status: "fail" as const, code, message };
}

/**
 * Tomorrow as 'YYYY-MM-DD' in LOCAL time.
 *
 * appointment_datetime is a timezone-naive local string, so the comparison has
 * to be built the same way — toISOString() would be UTC and, for an evening
 * appointment in Algeria (UTC+1), would silently ask for the wrong day.
 * setDate() handles month and year rollover.
 */
function tomorrowDateString(): string {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function mapRow(row: TargetRow): ReminderTarget {
    const phone = normalizePhone(row.phone_number);
    return {
        appointmentId: row.id,
        patientId: row.patient_id,
        patientName: row.full_name ?? `#${row.patient_id}`,
        appointmentDatetime: row.appointment_datetime,
        phoneDisplay: phone.display,
        reachability: phone.reachability,
        reminderStatus: row.reminder_status ?? 'none',
        remindedAt: row.reminded_at,
    };
}

/**
 * Tomorrow's still-scheduled appointments and how far their reminder has got.
 *
 * Only 'Scheduled' rows: a cancelled visit must not be reminded about, and a
 * No-Show cannot be in the future anyway. The reminder join matches on the
 * appointment's CURRENT datetime, which is what makes a rescheduled visit come
 * back as un-reminded (see the table comment in db.ts).
 */
export function getTomorrowReminders(doctorId: number) {
    const date = tomorrowDateString();
    try {
        const rows = getDatabase()
            .prepare(
                `SELECT a.id, a.patient_id, a.appointment_datetime,
                        p.full_name, p.phone_number,
                        r.status AS reminder_status, r.created_at AS reminded_at
                 FROM appointments a
                 LEFT JOIN patients p ON p.id = a.patient_id
                 LEFT JOIN appointment_reminders r
                        ON r.appointment_id = a.id
                       AND r.appointment_datetime = a.appointment_datetime
                 WHERE a.doctor_id = ?
                   AND a.status = 'Scheduled'
                   AND strftime('%Y-%m-%d', a.appointment_datetime) = ?
                 ORDER BY a.appointment_datetime ASC`
            )
            .all(doctorId, date) as TargetRow[];

        const data: ReminderList = { date, targets: rows.map(mapRow) };
        return { status: "success" as const, data };
    } catch (error) {
        console.error("getTomorrowReminders error:", error);
        return {
            status: "fail" as const,
            message: (error as Error).message,
            data: { date, targets: [] } as ReminderList,
        };
    }
}

/**
 * Strips control characters, which would percent-encode into visible junk in
 * WhatsApp's composer. A line break (10) is kept — a two-line reminder reads
 * better than one long run-on, and WhatsApp honours it.
 */
function sanitizeMessage(message: string): string {
    const cleaned = Array.from(message ?? '', (character) => {
        const code = character.codePointAt(0) ?? 0;
        if (code === 10) return character;
        return code < 32 || code === 127 ? ' ' : character;
    }).join('');

    return cleaned.trim().slice(0, MAX_MESSAGE_LENGTH);
}

/**
 * Opens WhatsApp with the reminder loaded, and records that we did.
 *
 * Note what "success" means here: WhatsApp was launched. It does NOT mean the
 * patient was messaged — the user still has to press send, and the number may
 * not be registered at all. The row is therefore written as 'opened' and the
 * panel asks the user what actually happened.
 */
export async function openWhatsAppReminder(appointmentId: number, message: string) {
    try {
        const db = getDatabase();
        const row = db
            .prepare(
                `SELECT a.id, a.status, a.patient_id, a.appointment_datetime,
                        p.full_name, p.phone_number
                 FROM appointments a
                 LEFT JOIN patients p ON p.id = a.patient_id
                 WHERE a.id = ?`
            )
            .get(appointmentId) as
            | { id: number; status: string; patient_id: number; appointment_datetime: string; full_name: string | null; phone_number: string | null }
            | undefined;

        if (!row) return fail('not_found', `appointment ${appointmentId} not found`);

        // Re-checked here rather than trusted from the panel: syncMissedAppointments()
        // on a restart, or a cancellation from the calendar in another tab, both
        // move this out from under a dashboard that was drawn minutes ago.
        if (row.status !== 'Scheduled') return fail('not_scheduled', `appointment is ${row.status}`);

        const phone = normalizePhone(row.phone_number);
        if (phone.reachability !== 'mobile') {
            return fail('unreachable', `phone is ${phone.reachability}`);
        }

        const body = sanitizeMessage(message);
        if (!body) return fail('empty_message', 'message body is empty');

        const url = `https://wa.me/${phone.waNumber}?text=${encodeURIComponent(body)}`;
        try {
            await shell.openExternal(url);
        } catch (error) {
            // No WhatsApp and no browser to fall back on, or the shell refused
            // the handler. The one failure this channel CAN report.
            console.error("openWhatsAppReminder: openExternal failed:", error);
            return fail('launch_failed', (error as Error).message);
        }

        // Re-opening deliberately resets status and clears the confirmation:
        // the user is having another go, so whatever they reported about the
        // previous attempt no longer describes the latest one.
        db.prepare(
            `INSERT INTO appointment_reminders
                (appointment_id, patient_id, appointment_datetime, channel, phone_used, body, status)
             VALUES (?, ?, ?, 'whatsapp_link', ?, ?, 'opened')
             ON CONFLICT(appointment_id, appointment_datetime) DO UPDATE SET
                phone_used = excluded.phone_used,
                body = excluded.body,
                status = 'opened',
                created_at = CURRENT_TIMESTAMP,
                confirmed_at = NULL`
        ).run(appointmentId, row.patient_id, row.appointment_datetime, phone.display, body);

        recordAudit('reminder.send', {
            entityType: 'appointment',
            entityId: appointmentId,
            summary: `${row.full_name ?? `#${row.patient_id}`} — ${row.appointment_datetime}`,
            details: { channel: 'whatsapp_link', phone: phone.display },
        });

        return { status: "success" as const, data: { phoneDisplay: phone.display } };
    } catch (error) {
        console.error("openWhatsAppReminder error:", error);
        return { status: "fail" as const, message: (error as Error).message };
    }
}

/**
 * Records what the user saw after WhatsApp opened.
 *
 * This is the only way a reminder ever becomes 'sent' or 'failed'. No audit
 * entry: the act was already logged by openWhatsAppReminder, and this is the
 * user annotating their own attempt rather than doing something new.
 */
export function setReminderOutcome(appointmentId: number, outcome: ReminderOutcome) {
    try {
        if (outcome !== 'sent' && outcome !== 'failed') {
            return fail('not_found', `unknown outcome '${outcome}'`);
        }
        const db = getDatabase();
        const appointment = db
            .prepare(`SELECT appointment_datetime FROM appointments WHERE id = ?`)
            .get(appointmentId) as { appointment_datetime: string } | undefined;

        if (!appointment) return fail('not_found', `appointment ${appointmentId} not found`);

        // Scoped to the announced datetime so confirming an outcome cannot
        // resurrect a reminder that a reschedule has already invalidated.
        const result = db
            .prepare(
                `UPDATE appointment_reminders
                 SET status = ?, confirmed_at = CURRENT_TIMESTAMP
                 WHERE appointment_id = ? AND appointment_datetime = ?`
            )
            .run(outcome, appointmentId, appointment.appointment_datetime);

        if (!result.changes) return fail('not_found', 'no reminder to confirm');
        return { status: "success" as const };
    } catch (error) {
        console.error("setReminderOutcome error:", error);
        return { status: "fail" as const, message: (error as Error).message };
    }
}
