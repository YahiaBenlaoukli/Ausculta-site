/**
 * Dotted `entity.verb` names for everything the log records.
 *
 * A closed union rather than free-form strings so the filter dropdown, the
 * translations and the call sites cannot drift apart.
 */
export type AuditAction =
    | 'auth.login'
    | 'auth.login_failed'
    | 'auth.logout'
    /**
     * Someone tried to register from the login screen on an install that
     * already has an account. Worth a line: on a two-seat practice this is
     * either an assistant who does not know how they get access, or someone
     * trying to mint themselves a doctor account.
     */
    | 'auth.register_refused'
    | 'user.create'
    | 'user.delete'
    | 'user.password_reset'
    | 'patient.create'
    | 'patient.update'
    | 'patient.delete'
    | 'consultation.complete'
    | 'consultation.delete'
    /**
     * A patient arrived and was put in the waiting room. Usually the desk, and
     * the first record that they were here at all — a walk-in who leaves before
     * being seen leaves no other trace.
     */
    | 'consultation.check_in'
    /** The doctor called a waiting patient into the room. */
    | 'consultation.call_in'
    /**
     * Someone was taken out of the queue without being seen — they left, or
     * were checked in by mistake. Worth a line precisely because it deletes the
     * draft, so nothing else survives to say it happened.
     */
    | 'consultation.remove_from_queue'
    | 'prescription.create'
    | 'prescription.delete'
    | 'document.upload'
    | 'document.delete'
    | 'certificate.create'
    | 'certificate.delete'
    | 'payment.record'
    | 'payment.delete'
    /** A WhatsApp appointment reminder was opened for a patient. */
    | 'reminder.send'
    /** A document was sent to the front desk to be printed. */
    | 'print.queue'
    /** The front desk confirmed it came out of the printer. */
    | 'print.done'
    | 'database.backup'
    /**
     * Recorded in the database being REPLACED, moments before the swap — the
     * only place it can land. It survives in the pre-restore snapshot.
     */
    | 'database.restore'
    | 'database.reset';

export interface AuditEntry {
    id: number;
    /** Null when nobody was signed in — a failed login, or startup repair work. */
    actorId: number | null;
    actorName: string;
    action: AuditAction;
    entityType: string | null;
    entityId: number | null;
    /** Human-readable line, resolved when the entry was written. */
    summary: string | null;
    /** Parsed from the stored JSON; null when there was nothing extra to keep. */
    details: Record<string, unknown> | null;
    at: string;
}

export interface AuditQuery {
    /** Restrict to these actions; omit or empty for all. */
    actions?: AuditAction[];
    /** Inclusive ISO dates (YYYY-MM-DD). */
    startDate?: string;
    endDate?: string;
    /** Substring match over the summary and the actor's name. */
    search?: string;
    limit?: number;
    offset?: number;
}

export interface AuditPage {
    entries: AuditEntry[];
    /** Total matching the filters, ignoring limit/offset. */
    total: number;
}
