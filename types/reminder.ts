/**
 * Appointment reminders sent over WhatsApp's click-to-chat link.
 *
 * The channel is deliberately the dumbest one available: the app builds a
 * wa.me URL and hands it to the OS. That needs no Meta account, no approved
 * message template and costs nothing — and it tells us nothing. Every type
 * here is shaped around that blindness.
 */

/**
 * What a patient's phone_number turned out to be.
 *
 * The field is free text, so this is the answer to "can we even try?". Only
 * 'mobile' can carry a WhatsApp message; the other three are the reasons a row
 * is greyed out in the panel before anybody clicks.
 */
export type PhoneReachability =
    /** An Algerian mobile (NSN starts 5, 6 or 7) — worth trying. */
    | 'mobile'
    /** A fixed line. Reachable by voice, never by WhatsApp. */
    | 'landline'
    /** Present but not parsable as an Algerian number. */
    | 'invalid'
    /** No phone number recorded for this patient at all. */
    | 'missing';

/**
 * How far a reminder for one appointment has got.
 *
 * 'opened' is the ceiling of what the app can observe on its own: once
 * shell.openExternal resolves, WhatsApp may have sent the message, told the
 * user the number is not registered, or asked them to link a device — none of
 * which comes back to us. 'sent' and 'failed' therefore only ever come from
 * the user reporting what they saw.
 */
export type ReminderStatus = 'none' | 'opened' | 'sent' | 'failed';

/** The two outcomes a user can report after WhatsApp has been opened. */
export type ReminderOutcome = 'sent' | 'failed';

/** One of tomorrow's scheduled appointments, as the dashboard panel needs it. */
export interface ReminderTarget {
    appointmentId: number;
    patientId: number;
    patientName: string;
    /** Naive local 'YYYY-MM-DDTHH:MM:SS', same as appointments.appointment_datetime. */
    appointmentDatetime: string;
    /** Grouped '+213 555 12 34 56' for a mobile; the raw text as typed otherwise. */
    phoneDisplay: string;
    reachability: PhoneReachability;
    reminderStatus: ReminderStatus;
    /** When the reminder was last opened; null when it never was. */
    remindedAt: string | null;
}

export interface ReminderList {
    /** The 'YYYY-MM-DD' the main process resolved as tomorrow, so both sides agree. */
    date: string;
    targets: ReminderTarget[];
}

/**
 * Machine-readable failures. The main process never returns prose here — the
 * clinic may be running in fr, en or ar and only the renderer knows which
 * (same reasoning as LicenseErrorCode).
 */
export type ReminderErrorCode =
    | 'not_found'
    /** Cancelled, completed or flipped to No-Show since the panel was drawn. */
    | 'not_scheduled'
    | 'unreachable'
    | 'empty_message'
    /** The OS refused to open the URL — usually no WhatsApp and no browser. */
    | 'launch_failed';
