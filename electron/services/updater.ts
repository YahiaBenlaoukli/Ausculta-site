import { app, BrowserWindow } from "electron";
import electronUpdater from "electron-updater";

/**
 * Auto-update service.
 *
 * Ausculta runs on a doctor's desk during consultations, and many clinics have
 * unreliable internet. Two rules follow from that, and they drive this whole
 * file:
 *
 *   1. NOTHING is downloaded without the doctor agreeing. `autoDownload` is
 *      off; we only ask. A 100 MB installer must never start pulling itself
 *      down over a metered phone tether mid-appointment.
 *   2. NOTHING blocks or interrupts. The check is delayed after launch, every
 *      failure is swallowed, and the installer is applied on quit -- never by
 *      restarting the app out from under someone.
 *
 * Update files live in Cloudflare R2 and are fetched through the signing
 * endpoint on the licence server (see license-server/api/updates/), which
 * hands out short-lived signed URLs. electron-updater follows the redirect and
 * then verifies the SHA-512 from latest.yml, so a tampered file is rejected
 * even though the transfer went through a redirect.
 */

// electron-updater ships CommonJS; with an ESM main process the named exports
// are only reachable through the default import.
const { autoUpdater } = electronUpdater;

/** Where latest.yml and the installers are served from. */
const UPDATE_FEED_URL =
    process.env.AUSCULTA_UPDATE_URL || "https://api.ausculta.site/api/updates";

/**
 * Delay before the first check. Launch is when the doctor is waiting to get
 * to work; the network call can wait until the app is usable.
 */
const FIRST_CHECK_DELAY_MS = 15_000;

/** Re-check occasionally for long-running installs that are never closed. */
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export type { UpdateStatus, UpdateActionResult } from "../../types/update";
import type { UpdateStatus, UpdateActionResult } from "../../types/update";

let state: UpdateStatus = { phase: "idle", currentVersion: app.getVersion() };
let mainWindow: BrowserWindow | null = null;
let configured = false;

/** Pushes state to the renderer and keeps the local copy in sync. */
function setState(next: Partial<UpdateStatus>): void {
    state = { ...state, ...next, currentVersion: app.getVersion() };
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-status", state);
    }
}

function configure(): void {
    if (configured) return;
    configured = true;

    autoUpdater.setFeedURL({ provider: "generic", url: UPDATE_FEED_URL });

    // Ask first, download second. This is the core of the UX contract above.
    autoUpdater.autoDownload = false;

    // Once downloaded, apply it when the app closes rather than forcing a
    // restart. The doctor decides when Ausculta stops being open.
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () => setState({ phase: "checking" }));

    autoUpdater.on("update-available", (info) => {
        setState({
            phase: "available",
            newVersion: info.version,
            releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
        });
    });

    autoUpdater.on("update-not-available", () => setState({ phase: "none" }));

    autoUpdater.on("download-progress", (progress) => {
        setState({
            phase: "downloading",
            percent: Math.round(progress.percent),
            bytesPerSecond: Math.round(progress.bytesPerSecond),
            totalBytes: progress.total,
        });
    });

    autoUpdater.on("update-downloaded", (info) => {
        setState({ phase: "ready", newVersion: info.version, percent: 100 });
    });

    autoUpdater.on("error", (error) => {
        // Being offline is the normal case for a lot of clinics, not a fault.
        // Record it for the Settings screen, but the UI stays quiet unless the
        // user asked for the check themselves.
        setState({ phase: "error", message: error?.message });
    });
}

/**
 * Called once from main.ts after the window exists. Schedules the first check
 * and a slow repeat; never throws.
 */
export function initializeUpdater(window: BrowserWindow): void {
    mainWindow = window;

    // In dev there is no packaged app to replace, and electron-updater would
    // just log a confusing error about app-update.yml being missing.
    if (!app.isPackaged) {
        setState({ phase: "idle" });
        return;
    }

    try {
        configure();
        setTimeout(() => { void checkForUpdates(); }, FIRST_CHECK_DELAY_MS);
        setInterval(() => { void checkForUpdates(); }, RECHECK_INTERVAL_MS);
    } catch (error) {
        setState({ phase: "error", message: (error as Error).message });
    }
}

/** Current state, for a renderer that just mounted. */
export function getUpdateStatus(): UpdateStatus {
    return state;
}

/** Asks the server whether a newer version exists. Does NOT download. */
export async function checkForUpdates(): Promise<UpdateStatus> {
    if (!app.isPackaged) {
        // Report honestly rather than pretending to check.
        setState({ phase: "none" });
        return state;
    }

    try {
        configure();
        await autoUpdater.checkForUpdates();
    } catch (error) {
        setState({ phase: "error", message: (error as Error).message });
    }
    return state;
}

/** Starts the download. Only ever called after the user agreed. */
export async function downloadUpdate(): Promise<UpdateActionResult> {
    try {
        configure();
        setState({ phase: "downloading", percent: 0 });
        await autoUpdater.downloadUpdate();
        return { status: "success" };
    } catch (error) {
        const message = (error as Error).message;
        setState({ phase: "error", message });
        return { status: "fail", message };
    }
}

/**
 * Quits and installs now, for a user who clicked "restart". Otherwise the
 * update applies on the next ordinary quit via autoInstallOnAppQuit.
 */
export function quitAndInstall(): UpdateActionResult {
    try {
        if (state.phase !== "ready") {
            return { status: "fail", message: "No update has been downloaded." };
        }
        // isSilent = false so the NSIS installer shows progress; isForceRunAfter
        // = true so Ausculta comes back up once it finishes.
        setImmediate(() => autoUpdater.quitAndInstall(false, true));
        return { status: "success" };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}
