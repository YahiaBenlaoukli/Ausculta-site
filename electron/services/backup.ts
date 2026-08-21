/**
 * Backup and restore, in two scopes.
 *
 *   'database' — one .db file. Every record; no PDFs. Small, e-mailable, and
 *                the right thing for a nightly copy onto the same machine.
 *   'full'     — a folder holding that .db plus a copy of `records/`, so the
 *                backup can be carried to another machine and still open its
 *                documents.
 *
 * LICENSED ONLY. Both refuse to run unless getTrialStatus() reports an active
 * license, checked in the MAIN process on every call — the renderer hides the
 * buttons too, but that is cosmetic and a tampered build could send the IPC
 * message anyway.
 *
 * WHY NOT A FILE COPY. The database runs in WAL mode, so recent commits live in
 * a `-wal` sidecar until a checkpoint folds them into the main file. Copying
 * `cabinet-medicale.db` on its own therefore yields a file that is not merely
 * stale but structurally broken: measured on this schema, the copy came back
 * with user_version 0 and no tables at all. Every snapshot here goes through
 * `VACUUM INTO`, which asks SQLite to serialise a consistent image — WAL
 * contents included, along with the user_version stamp db.ts needs to decide
 * which migrations a restored file still wants.
 *
 * WHY A FOLDER AND NOT A ZIP. Ausculta ships no archive library. `archiver` and
 * `tar` resolve in this repo only as transitive dependencies of
 * electron-builder, which is a devDependency — they are absent from the
 * packaged app, so building on them would work in development and fail in
 * production. Adding a zip dependency to a medical app buys a tidier artefact
 * in exchange for an archive parser in the restore path (zip-slip and friends),
 * and a `records/` tree of scanned documents can run to hundreds of megabytes,
 * which the convenient sync zip libraries handle badly. A plain folder copied
 * with fs.cpSync streams, needs nothing, and is what a clinic drags onto a USB
 * stick anyway.
 */

import { app, dialog, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getDatabase, closeDatabase, SCHEMA_VERSION } from "../db/db";
import { getTrialStatus } from "./trial";
import { recordAudit } from "./audit";
import type { BackupErrorCode, BackupManifest, BackupScope } from "../../types/backup";

/** The live database filename, as initializeDatabase() creates it. */
const DB_FILENAME = 'cabinet-medicale.db';

/** The uploaded/generated PDF tree. MUST match documents.ts. */
const RECORDS_FOLDER = 'records';

/** Names inside a full-backup folder. */
const MANIFEST_FILENAME = 'ausculta-backup.json';
const ARCHIVED_DB_FILENAME = 'database.db';

/** Where the replaced data is parked during a restore, for one level of undo. */
const SAFETY_DB = 'pre-restore-backup.db';
const SAFETY_RECORDS = 'records.pre-restore';
/** Documents are staged here first, so the destructive part stays fast. */
const STAGED_RECORDS = 'records.incoming';

/**
 * Tables every Ausculta database has had since before backups existed. A file
 * missing these is not an Ausculta backup, whatever it is called — checked
 * before anything is overwritten.
 */
const REQUIRED_TABLES = ['patients', 'appointments', 'users'] as const;

function fail(code: BackupErrorCode, message: string) {
    return { status: "fail" as const, code, message };
}

const userData = () => app.getPath('userData');
const livePath = () => path.join(userData(), DB_FILENAME);
const liveRecords = () => path.join(userData(), RECORDS_FOLDER);

/**
 * The licence gate. Re-checked in the main process on every call rather than
 * trusted from the renderer: hidden buttons are a UI courtesy, not a control.
 */
function licensed(): boolean {
    try {
        return getTrialStatus().licensed === true;
    } catch (error) {
        // A licence check that fails to run is not permission to proceed.
        console.error("backup: license check failed:", error);
        return false;
    }
}

/** 'ausculta-backup-2026-08-15-1430' — sorts chronologically by name. */
function stamp(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `ausculta-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
        + `-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** Single-quoted SQL string literal, with any quote in the path doubled. */
const asSqlPath = (file: string) => `'${file.replace(/'/g, "''")}'`;

/**
 * Serialises the live database to `target`.
 *
 * VACUUM INTO refuses to write onto an existing path (verified: "output file
 * already exists"), so the caller's chosen-and-confirmed target is cleared
 * first — the OS dialog has already asked about replacing it.
 */
function snapshotDatabase(target: string) {
    if (fs.existsSync(target)) fs.rmSync(target);
    getDatabase().exec(`VACUUM INTO ${asSqlPath(target)}`);
}

/** Total size of a file, or of a directory tree. */
function sizeOf(target: string): number {
    const stats = fs.statSync(target);
    if (!stats.isDirectory()) return stats.size;
    return fs.readdirSync(target)
        .reduce((total, entry) => total + sizeOf(path.join(target, entry)), 0);
}

function countFiles(target: string): number {
    if (!fs.existsSync(target)) return 0;
    const stats = fs.statSync(target);
    if (!stats.isDirectory()) return 1;
    return fs.readdirSync(target)
        .reduce((total, entry) => total + countFiles(path.join(target, entry)), 0);
}

/** Removes a file or tree if it is there. Used to clear previous safety copies. */
function discard(target: string) {
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────── backup ────

export async function backupDatabase(scope: BackupScope, parent?: BrowserWindow | null) {
    if (!licensed()) return fail('not_licensed', 'a licence is required to back up');
    try {
        return scope === 'full' ? await backupFull(parent) : await backupDatabaseOnly(parent);
    } catch (error) {
        console.error(`backupDatabase(${scope}) error:`, error);
        return fail('write_failed', (error as Error).message);
    }
}

/** One .db file, chosen with a save dialog. */
async function backupDatabaseOnly(parent?: BrowserWindow | null) {
    const target = await dialog.showSaveDialog(parent ?? undefined!, {
        defaultPath: path.join(app.getPath('documents'), `${stamp()}.db`),
        filters: [{ name: 'Ausculta backup', extensions: ['db'] }],
    });
    if (target.canceled || !target.filePath) return { status: "cancelled" as const };

    // Backing up onto the live database would have VACUUM INTO write to the file
    // it is reading. Refused rather than risked.
    if (path.resolve(target.filePath) === path.resolve(livePath())) {
        return fail('target_is_live_db', 'cannot overwrite the live database');
    }

    snapshotDatabase(target.filePath);
    const bytes = fs.statSync(target.filePath).size;

    recordAudit('database.backup', {
        summary: path.basename(target.filePath),
        details: { scope: 'database', path: target.filePath, bytes },
    });
    return { status: "success" as const, data: { scope: 'database' as const, path: target.filePath, bytes, documents: 0 } };
}

/**
 * A folder holding the database plus the documents tree.
 *
 * The user picks a DESTINATION (a USB stick, a network share) and the backup
 * goes into a timestamped subfolder of it, so backing up twice to the same
 * place does not silently overwrite the earlier one.
 */
async function backupFull(parent?: BrowserWindow | null) {
    const chosen = await dialog.showOpenDialog(parent ?? undefined!, {
        defaultPath: app.getPath('documents'),
        properties: ['openDirectory', 'createDirectory'],
    });
    if (chosen.canceled || !chosen.filePaths.length) return { status: "cancelled" as const };

    const destination = chosen.filePaths[0];
    // Writing a backup into the user-data folder would put a copy of the
    // documents tree inside the tree being copied.
    if (path.resolve(destination).startsWith(path.resolve(userData()))) {
        return fail('target_is_live_db', 'cannot back up into the live data folder');
    }

    const folder = path.join(destination, stamp());
    discard(folder);
    fs.mkdirSync(folder, { recursive: true });

    snapshotDatabase(path.join(folder, ARCHIVED_DB_FILENAME));

    let documents = 0;
    const records = liveRecords();
    if (fs.existsSync(records)) {
        fs.cpSync(records, path.join(folder, RECORDS_FOLDER), { recursive: true });
        documents = countFiles(path.join(folder, RECORDS_FOLDER));
    }

    const db = getDatabase();
    const patients = (db.prepare(`SELECT COUNT(*) AS n FROM patients`).get() as { n: number }).n;
    const manifest: BackupManifest = {
        app: 'ausculta',
        scope: 'full',
        schemaVersion: SCHEMA_VERSION,
        appVersion: app.getVersion(),
        createdAt: new Date().toISOString(),
        counts: { patients, documents },
    };
    fs.writeFileSync(path.join(folder, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2), 'utf8');

    const bytes = sizeOf(folder);
    recordAudit('database.backup', {
        summary: path.basename(folder),
        details: { scope: 'full', path: folder, bytes, documents, patients },
    });
    return { status: "success" as const, data: { scope: 'full' as const, path: folder, bytes, documents } };
}

// ────────────────────────────────────────────────────────────── restore ────

/**
 * Reads a candidate database without touching the live one.
 *
 * Returns null when the file is acceptable, or a failure describing why not.
 * Runs BEFORE anything is overwritten — this is the whole reason a bad restore
 * is a refusal rather than a disaster.
 */
function rejectDatabaseFile(file: string) {
    if (!fs.existsSync(file)) return fail('not_found', 'the selected file no longer exists');
    try {
        const candidate = new Database(file, { readonly: true, fileMustExist: true });
        try {
            const found = candidate
                .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${REQUIRED_TABLES.map(() => '?').join(', ')})`)
                .all(...REQUIRED_TABLES) as { name: string }[];
            if (found.length !== REQUIRED_TABLES.length) {
                return fail('not_a_backup', 'the file is not an Ausculta database');
            }

            const version = candidate.pragma('user_version', { simple: true }) as number;
            if (version > SCHEMA_VERSION) {
                return fail('newer_schema', `backup is v${version}, this build reads v${SCHEMA_VERSION}`);
            }

            // Cheap structural check. A full `PRAGMA integrity_check` reads every
            // page, which is slow on a large file and would run while the doctor
            // waits; quick_check still catches a truncated or garbled file.
            const quick = candidate.pragma('quick_check', { simple: true });
            if (quick !== 'ok') return fail('corrupt', `integrity check: ${quick}`);

            return null;
        } finally {
            candidate.close();
        }
    } catch (error) {
        return fail('not_a_backup', (error as Error).message);
    }
}

export async function restoreDatabase(scope: BackupScope, parent?: BrowserWindow | null) {
    if (!licensed()) return fail('not_licensed', 'a licence is required to restore');
    try {
        return scope === 'full' ? await restoreFull(parent) : await restoreDatabaseOnly(parent);
    } catch (error) {
        console.error(`restoreDatabase(${scope}) error:`, error);
        return fail('write_failed', (error as Error).message);
    }
}

/**
 * Puts `source` in place of the live database.
 *
 * Assumes the caller has already validated `source` and taken the safety
 * snapshot. Closes the connection first: replacing the file underneath an open
 * handle is how a half-read database and a corrupt -wal happen.
 */
function swapInDatabase(source: string) {
    const target = livePath();
    // Clears the module's reference as well as closing the handle, so anything
    // that reaches for the database between here and the relaunch fails loudly
    // instead of querying a dead connection.
    closeDatabase();
    fs.copyFileSync(source, target);
    // Sidecars from the OLD database. Leaving them next to the new file is how
    // SQLite ends up reading half of each.
    for (const suffix of ['-wal', '-shm']) discard(`${target}${suffix}`);
}

/** Snapshots the current database. A restore without a way back is not worth it. */
function takeSafetySnapshot() {
    const safety = path.join(userData(), SAFETY_DB);
    snapshotDatabase(safety);
    return safety;
}

async function restoreDatabaseOnly(parent?: BrowserWindow | null) {
    const picked = await dialog.showOpenDialog(parent ?? undefined!, {
        properties: ['openFile'],
        filters: [{ name: 'Ausculta backup', extensions: ['db'] }],
    });
    if (picked.canceled || !picked.filePaths.length) return { status: "cancelled" as const };

    const source = picked.filePaths[0];
    if (path.resolve(source) === path.resolve(livePath())) {
        return fail('target_is_live_db', 'that file IS the live database');
    }

    const rejection = rejectDatabaseFile(source);
    if (rejection) return rejection;

    let safety: string;
    try {
        safety = takeSafetySnapshot();
    } catch (error) {
        console.error("restoreDatabaseOnly: safety snapshot failed:", error);
        return fail('safety_backup_failed', (error as Error).message);
    }

    // Audited BEFORE the connection closes: this database is about to stop being
    // the one that gets written to, so the entry has to land here to land at
    // all. The pre-restore snapshot preserves it either way.
    recordAudit('database.restore', {
        summary: path.basename(source),
        details: { scope: 'database', source, safetyCopy: safety },
    });

    swapInDatabase(source);
    return { status: "success" as const, data: { scope: 'database' as const, restartRequired: true as const, safetyCopy: safety } };
}

/**
 * Restores a full-backup folder: database and documents together.
 *
 * The documents are copied into a staging folder FIRST, while nothing is
 * committed. That copy is the slow, failure-prone part — a USB stick pulled
 * halfway through, a disk that fills — and doing it up front means such a
 * failure aborts with the live data still completely intact. Only once staging
 * succeeds does the destructive part run, and it is then just a file copy and
 * two renames.
 */
async function restoreFull(parent?: BrowserWindow | null) {
    const picked = await dialog.showOpenDialog(parent ?? undefined!, {
        properties: ['openDirectory'],
    });
    if (picked.canceled || !picked.filePaths.length) return { status: "cancelled" as const };

    const folder = picked.filePaths[0];
    if (path.resolve(folder).startsWith(path.resolve(userData()))) {
        return fail('target_is_live_db', 'that folder is inside the live data folder');
    }

    // The manifest is what makes a full backup self-identifying, rather than us
    // guessing from whatever happens to be in the folder.
    let manifest: BackupManifest;
    try {
        manifest = JSON.parse(fs.readFileSync(path.join(folder, MANIFEST_FILENAME), 'utf8')) as BackupManifest;
        if (manifest?.app !== 'ausculta') return fail('not_a_backup', 'manifest is not an Ausculta backup');
    } catch {
        return fail('not_a_backup', `no ${MANIFEST_FILENAME} in the selected folder`);
    }
    if (typeof manifest.schemaVersion === 'number' && manifest.schemaVersion > SCHEMA_VERSION) {
        return fail('newer_schema', `backup is v${manifest.schemaVersion}, this build reads v${SCHEMA_VERSION}`);
    }

    const archivedDb = path.join(folder, ARCHIVED_DB_FILENAME);
    const rejection = rejectDatabaseFile(archivedDb);
    if (rejection) return rejection;

    // ---- stage the documents while nothing is committed ----
    const staged = path.join(userData(), STAGED_RECORDS);
    const archivedRecords = path.join(folder, RECORDS_FOLDER);
    try {
        discard(staged);
        if (fs.existsSync(archivedRecords)) {
            fs.cpSync(archivedRecords, staged, { recursive: true });
        } else {
            // A practice with no documents yet backs up without a records tree.
            fs.mkdirSync(staged, { recursive: true });
        }
    } catch (error) {
        discard(staged);
        console.error("restoreFull: staging documents failed:", error);
        return fail('write_failed', (error as Error).message);
    }

    let safety: string;
    try {
        safety = takeSafetySnapshot();
    } catch (error) {
        discard(staged);
        console.error("restoreFull: safety snapshot failed:", error);
        return fail('safety_backup_failed', (error as Error).message);
    }

    recordAudit('database.restore', {
        summary: path.basename(folder),
        details: {
            scope: 'full', source: folder, safetyCopy: safety,
            patients: manifest.counts?.patients, documents: manifest.counts?.documents,
        },
    });

    swapInDatabase(archivedDb);

    // ---- swap the documents in: two renames, no copying ----
    const records = liveRecords();
    const safetyRecords = path.join(userData(), SAFETY_RECORDS);
    try {
        discard(safetyRecords);
        if (fs.existsSync(records)) fs.renameSync(records, safetyRecords);
        fs.renameSync(staged, records);
    } catch (error) {
        // The database is already the restored one, so this is not a clean
        // abort. Reported distinctly instead of as success: document rows may
        // point at PDFs that are not on this machine, and the user needs to
        // know that rather than discover it at a printer.
        console.error("restoreFull: swapping documents failed:", error);
        return fail('documents_incomplete', (error as Error).message);
    }

    return {
        status: "success" as const,
        data: {
            scope: 'full' as const,
            restartRequired: true as const,
            safetyCopy: safety,
            counts: manifest.counts,
        },
    };
}

/**
 * Quits and relaunches, so the restored file is opened by a fresh
 * initializeDatabase() — which also runs any migrations the backup predates.
 *
 * app.quit(), NOT app.exit(). Both trigger the pending relaunch, but exit()
 * tears the process down immediately: renderers are killed mid-flight and
 * Chromium never closes out the profile directory it keeps under userData
 * (Local Storage, Session Storage, its lock files). The replacement instance
 * then starts against a profile the previous one still had claimed, and comes
 * up blank — which fixes itself on the NEXT launch, once nothing is holding it.
 * quit() runs the normal shutdown, so everything is released before the new
 * process exists.
 */
export function relaunchApp() {
    app.relaunch();
    app.quit();

    // quit() is cancellable — a stuck window or a beforeunload handler can eat
    // it, and a restore that never comes back is worse than an abrupt one. If
    // we are still alive well past a normal shutdown, stop asking. The relaunch
    // is already registered, so the new instance starts either way.
    setTimeout(() => app.exit(0), 4000);
}
