/**
 * Whole-database backup and restore. Licensed installs only — the gate is
 * enforced in electron/services/backup.ts, not just in the UI.
 */

/**
 * How much a backup covers.
 *
 * 'database' is one .db file: every record, no PDFs. 'full' is a folder holding
 * that same .db plus a copy of the `records/` tree, so it can be carried to
 * another machine and still open its documents.
 */
export type BackupScope = 'database' | 'full';

/**
 * Machine-readable failures. No prose crosses the IPC boundary: the clinic may
 * be running fr, en or ar and only the renderer knows which (same reasoning as
 * LicenseErrorCode in types/trial.ts).
 */
export type BackupErrorCode =
    /** No active licence. Backup and restore are both licensed features. */
    | 'not_licensed'
    | 'not_found'
    /** The chosen file or folder is not an Ausculta backup. */
    | 'not_a_backup'
    /** It is an Ausculta database, but SQLite reports it as damaged. */
    | 'corrupt'
    /**
     * Written by a newer build of Ausculta. Migrations only run forwards, so
     * this is refused rather than half-understood.
     */
    | 'newer_schema'
    /** The chosen path IS the live database or user-data folder. */
    | 'target_is_live_db'
    /** The pre-restore snapshot could not be written, so the restore was abandoned. */
    | 'safety_backup_failed'
    /**
     * The database was replaced but its documents were not, so document rows may
     * point at PDFs this machine does not have. Recoverable — see safetyCopy.
     */
    | 'documents_incomplete'
    | 'write_failed';

/** Stamped into `ausculta-backup.json` inside a full backup folder. */
export interface BackupManifest {
    /** Always 'ausculta'. The marker that says this folder is ours. */
    app: 'ausculta';
    scope: BackupScope;
    /** db.ts SCHEMA_VERSION at the time of writing. */
    schemaVersion: number;
    /** package.json version of the build that wrote it. */
    appVersion: string;
    createdAt: string;
    /** Row counts, so a restore can say what it is about to bring back. */
    counts: { patients: number; documents: number };
}

export interface BackupResult {
    scope: BackupScope;
    /** The .db file, or the backup folder, that was written. */
    path: string;
    /** Total bytes written, database and documents together. */
    bytes: number;
    /** Documents copied. Always 0 for a 'database' backup. */
    documents: number;
}

export interface RestoreResult {
    scope: BackupScope;
    /**
     * Always true. Every module in the main process holds the connection opened
     * at startup, so the app must relaunch to read the restored file.
     */
    restartRequired: true;
    /** Where the replaced database was snapshotted, in case this was a mistake. */
    safetyCopy: string;
    /** What the backup said it contained, when it carried a manifest. */
    counts?: { patients: number; documents: number };
}
