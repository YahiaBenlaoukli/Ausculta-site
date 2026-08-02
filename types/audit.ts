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
    | 'patient.create'
    | 'patient.update'
    | 'patient.delete'
    | 'consultation.complete'
    | 'consultation.delete'
    | 'prescription.create'
    | 'prescription.delete'
    | 'document.upload'
    | 'document.delete'
    | 'certificate.create'
    | 'certificate.delete'
    | 'payment.record'
    | 'payment.delete'
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
