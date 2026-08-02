// The append-only "who did what" trail.
//
// Two rules the rest of the codebase depends on:
//
//  1. recordAudit NEVER throws and never blocks the caller. A failure to write
//     the log must not be able to abort a prescription or lose a payment — the
//     record of the act matters less than the act.
//  2. There is no delete or update function here, and none should be added.
//     An audit trail with an erase button is not an audit trail.
import { getDatabase } from "../db/db";
import { escapeLike, normalizeSearchText } from "../db/normalize";
import { getCurrentUser } from "./session";
import type { AuditAction, AuditEntry, AuditPage, AuditQuery } from "../../types/audit";

/** Shown when something is logged with nobody signed in (e.g. a failed login). */
const SYSTEM_ACTOR = 'system';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

type AuditRow = {
    id: number;
    actor_id: number | null;
    actor_name: string;
    action: AuditAction;
    entity_type: string | null;
    entity_id: number | null;
    summary: string | null;
    details: string | null;
    at: string;
};

function mapRow(row: AuditRow): AuditEntry {
    let details: Record<string, unknown> | null = null;
    if (row.details) {
        try {
            details = JSON.parse(row.details) as Record<string, unknown>;
        } catch {
            // A malformed blob must not break the whole page of results.
            details = { raw: row.details };
        }
    }
    return {
        id: row.id,
        actorId: row.actor_id,
        actorName: row.actor_name,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        summary: row.summary,
        details,
        at: row.at,
    };
}

export interface AuditOptions {
    entityType?: string;
    entityId?: number | null;
    summary?: string;
    details?: Record<string, unknown>;
    /**
     * Overrides the signed-in user. Only for events that describe someone who
     * is NOT signed in — a failed login naming the attempted account.
     */
    actorName?: string;
}

/**
 * Writes one entry. Fire-and-forget: callers do not check the result, and
 * every failure is swallowed after being logged to the console.
 */
export function recordAudit(action: AuditAction, options: AuditOptions = {}) {
    try {
        const user = getCurrentUser();
        const actorName = options.actorName ?? user?.fullName ?? SYSTEM_ACTOR;
        // actor_id stays NULL when the name was supplied explicitly: that entry
        // is about an attempted identity, not an authenticated one.
        const actorId = options.actorName ? null : user?.id ?? null;

        getDatabase()
            .prepare(
                `INSERT INTO audit_log (actor_id, actor_name, action, entity_type, entity_id, summary, details)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                actorId,
                actorName,
                action,
                options.entityType ?? null,
                options.entityId ?? null,
                options.summary ?? null,
                options.details ? JSON.stringify(options.details) : null
            );
    } catch (error) {
        console.error("recordAudit error:", action, error);
    }
}

/** Filtered, paged view of the trail, newest first. */
export function getAuditLog(query: AuditQuery = {}) {
    try {
        const db = getDatabase();
        const where: string[] = [];
        const params: unknown[] = [];

        if (query.actions?.length) {
            where.push(`action IN (${query.actions.map(() => '?').join(', ')})`);
            params.push(...query.actions);
        }
        if (query.startDate) {
            where.push(`at >= ?`);
            params.push(query.startDate);
        }
        if (query.endDate) {
            // `at` is a full datetime; a bare date would exclude that whole day.
            where.push(`at <= ?`);
            params.push(query.endDate.length === 10 ? `${query.endDate} 23:59:59` : query.endDate);
        }

        const search = normalizeSearchText(query.search ?? '');
        if (search) {
            // norm() so an accented actor name matches an unaccented query,
            // consistent with search everywhere else in the app.
            where.push(`(norm(COALESCE(summary, '')) LIKE ? ESCAPE '\\' OR norm(actor_name) LIKE ? ESCAPE '\\')`);
            const pattern = `%${escapeLike(search)}%`;
            params.push(pattern, pattern);
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
        const offset = Math.max(query.offset ?? 0, 0);

        const total = (db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${whereSql}`)
            .get(...params) as { n: number }).n;

        const rows = db
            .prepare(`SELECT * FROM audit_log ${whereSql} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`)
            .all(...params, limit, offset) as AuditRow[];

        const data: AuditPage = { entries: rows.map(mapRow), total };
        return { status: "success", data };
    } catch (error) {
        console.error("getAuditLog error:", error);
        return { status: "fail", message: (error as Error).message, data: { entries: [], total: 0 } as AuditPage };
    }
}

/** Everything ever recorded against one record — the per-patient history view. */
export function getAuditLogForEntity(entityType: string, entityId: number) {
    try {
        const rows = getDatabase()
            .prepare(`SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY at DESC, id DESC`)
            .all(entityType, entityId) as AuditRow[];
        return { status: "success", data: rows.map(mapRow) };
    } catch (error) {
        console.error("getAuditLogForEntity error:", error);
        return { status: "fail", message: (error as Error).message, data: [] as AuditEntry[] };
    }
}
