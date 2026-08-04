/**
 * Auto-update state shared between the main process and the renderer.
 *
 * The app is offline-first and used during consultations, so the update flow
 * is deliberately non-intrusive: nothing is downloaded without the doctor
 * agreeing, and nothing is ever installed while the app is open.
 */
export type UpdatePhase =
    | "idle"          // nothing happening
    | "checking"      // asking the server
    | "available"     // an update exists, waiting for the user to accept
    | "downloading"   // user accepted, transfer in progress
    | "ready"         // downloaded, will install on quit
    | "none"          // checked, already up to date
    | "error";        // check or download failed

export type UpdateStatus = {
    phase: UpdatePhase;
    /** Version currently running. */
    currentVersion: string;
    /** Version on offer, when phase is available/downloading/ready. */
    newVersion?: string;
    /** Release notes, if the publisher provided any. */
    releaseNotes?: string;
    /** 0-100 while downloading. */
    percent?: number;
    /** Bytes per second while downloading. */
    bytesPerSecond?: number;
    /** Total download size in bytes. */
    totalBytes?: number;
    /** Developer-facing failure detail; never shown raw to the user. */
    message?: string;
};

export type UpdateActionResult = {
    status: "success" | "fail";
    message?: string;
};
