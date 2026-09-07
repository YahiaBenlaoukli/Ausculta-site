/**
 * Who may call which IPC channel.
 *
 * Enforced in exactly one place — the `handle()` wrapper in main.ts — rather
 * than sprinkled through the services. Two reasons: a service called from two
 * channels would otherwise need the check twice, and a single table is the only
 * form of this that can be read and argued about as a policy.
 *
 * The assistant list is an ALLOWLIST, deliberately. A denylist would silently
 * expose every channel added after it was written, and the failure mode of
 * forgetting to add a channel here (the assistant sees "access refused" and
 * says so) is enormously better than the failure mode of forgetting to deny one
 * (the assistant quietly reads the practice's revenue).
 *
 * Field-level rules cannot live here — a channel is either reachable or not.
 * `update-consultation` is the case in point: the assistant may record vitals
 * at check-in but not a diagnosis, so the channel is allowed and consultations.ts
 * narrows the draft. Anything shaped like that belongs in the service.
 *
 * Both lists are written as `ChannelName`, so a typo or a channel that has
 * since been renamed is a compile error rather than a permission that silently
 * matches nothing. They are then held as `ReadonlySet<string>` because the
 * lookup takes whatever a caller supplies — a URL segment, eventually.
 */

import type { SessionUser } from "./session";
import type { ChannelName } from "../ipc/registry";

/**
 * Reachable with no session at all.
 *
 * Everything here either establishes a session or is needed to render the
 * screens that come before one. `create-user` is public because the very first
 * launch has nobody to authorise it — auth.ts refuses it once any account
 * exists, which is the rule that keeps the login screen from minting doctors.
 */
const PUBLIC_CHANNELS: ReadonlySet<string> = new Set<ChannelName>([
    'login',
    'logout',
    'check-auth',
    'create-user',
    'needs-registration',
    // The trial gate renders before the login screen; without this the app
    // cannot tell the user why it is refusing to start.
    'get-trial-status',
    // And this is how it gets un-refused.
    //
    // Not an oversight that it sits beside get-trial-status: an expired machine
    // shows TrialGate's full-screen activation page INSTEAD of the login screen,
    // so there is no session and no way to obtain one. Requiring a signed-in
    // doctor here would mean the only route out of a locked-out install is
    // blocked by the lockout — on the front desk's machine and on the doctor's
    // own. The key itself is the credential; someone without one gains nothing
    // by reaching this, and it only ever licenses the machine it is called on.
    'activate-license',
    // UpdateNotice is mounted app-wide, outside the router, so it polls this
    // on the login screen too. It reports the state of this installation, not
    // anything about the practice.
    'get-update-status',

    // ── Pairing, which necessarily precedes signing in ────────────────────
    //
    // A fresh client cannot authenticate until it can reach the host, and it
    // cannot reach the host until it has been told where the host is. So the
    // settings that establish the link have to be reachable from the login
    // screen, before any account exists on this machine.
    //
    // What they expose is this INSTALLATION's own configuration — a mode, an
    // address, a port, a certificate fingerprint — and nothing about the
    // practice or its patients. Anyone who could reach these could also edit
    // network.json in the user's own directory, so requiring a session here
    // would buy no security and would leave a client permanently unable to be
    // set up.
    'get-network-config',
    'set-network-config',
    'get-host-info',
    'test-host-connection',
    'get-pinned-fingerprint',
    'unpair-host',
    'check-firewall-rule',
    'add-firewall-rule',
    // Changing any of the above needs a restart to take effect, and restarting
    // the application you are sitting in front of is not a privileged act —
    // closing and reopening it does the same thing.
    'relaunch-app',
]);

/**
 * Reachable by an assistant. Anything absent is doctor-only.
 *
 * The shape of the policy: the assistant runs the front desk — patients, the
 * calendar, documents, the till — and reads whatever they need to do that.
 * They do not author clinical records, and they do not see the practice's
 * financial position.
 */
const ASSISTANT_CHANNELS: ReadonlySet<string> = new Set<ChannelName>([
    // ── Patients ──────────────────────────────────────────────────────────
    // Including delete: duplicate records are created at the desk and cleaned
    // up at the desk. It cascades the whole clinical history, so the audit log
    // is what makes this safe to allow rather than the permission.
    'add-patient',
    'get-patient-by-id',
    'get-all-patients',
    'update-patient',
    'delete-patient',
    'search-patients',
    'count-patients',
    'global-search',

    // ── Documents ─────────────────────────────────────────────────────────
    'get-documents-by-patient-id',
    'get-all-documents',
    'upload-document',
    'delete-document',
    'open-document',

    // ── Whose practice this is ────────────────────────────────────────────
    // The practice profile, not "my profile": an assistant has no
    // doctor_profile row of their own and must never be given one.
    'get-practice-doctor-profile',

    // ── Prescriptions: read only ──────────────────────────────────────────
    // Enough to find and reprint what the doctor already issued; authoring is
    // add/update/delete and stays with the doctor.
    'get-prescription-by-id',
    'get-patient-prescriptions',
    'get-all-prescriptions',
    'search-prescriptions',
    'count-prescriptions',
    'suggest-medicines',

    // ── Drug catalogue: read-only reference data ──────────────────────────
    'browse-medications',
    'get-medication-detail',
    'get-medication-facets',

    // ── Certificates: read only ───────────────────────────────────────────
    // Listing them is desk work; issuing or reprinting one carries the
    // doctor's signature and does not.
    'get-certificates-by-patient-id',
    'get-certificates-by-consultation-id',

    // ── Appointments and reminders ────────────────────────────────────────
    'book-appointment',
    'cancel-appointment',
    'delete-appointment',
    'update-appointment',
    'get-appointments-by-day',
    'get-appointments-by-patient-id',
    'get-appointments-by-date-range',
    'get-tomorrow-reminders',
    'open-whatsapp-reminder',
    'set-reminder-outcome',

    // ── La salle d'attente ────────────────────────────────────────────────
    // The desk runs the queue: who has arrived, in what order, and who gave up
    // and went home. It does not decide when the doctor is ready for the next
    // one — 'call-patient-in' is absent on purpose, and that omission is the
    // whole reason this queue is worth having rather than a shout down the hall.
    'get-waiting-room',
    'check-in-patient',
    'set-queue-priority',
    'remove-from-queue',
    // The waiting-room TV. The board is a second window on THIS machine that
    // polls the queue, and the seat the TV is plugged into is usually the desk,
    // so opening and closing it has to be reachable from here.
    //
    // Nothing is granted by this that the desk does not already have: the board
    // shows the same queue the assistant can read, and the settings behind it
    // live in network.json, whose channel is public anyway (a client has to be
    // able to pair before anyone can sign in). What the desk cannot do is reach
    // the Settings page that presents these choices — same arrangement as the
    // front-desk printer, per MULTI-POSTE.md.
    'list-displays',
    'open-queue-display',
    'close-queue-display',
    'get-queue-display-status',

    // ── Consultations: vitals and lookup ──────────────────────────────────
    // 'start-consultation' is deliberately NOT here any more: it now stamps
    // called_at, which means "the patient is in the room with the doctor", and
    // the desk saying that would empty the waiting room from the wrong end.
    // Checking a patient in — which is what this grant was always for — is
    // 'check-in-patient' above.
    //
    // update-consultation stays: taking a weight and a blood pressure while the
    // patient waits is desk work, and consultations.ts narrows the draft to
    // exactly those fields (scopeDraftToRole). complete- and delete-consultation
    // are sign-offs and stay out.
    'get-consultation-by-id',
    'get-active-consultation',
    'update-consultation',
    'get-consultation-artifacts',
    'get-consultations-by-patient-id',
    'get-consultations-by-day',
    'get-consultations-by-date-range',

    // ── The print queue ───────────────────────────────────────────────────
    // The desk is the whole point of this queue: it reads what is waiting,
    // prints it and says so. It does not get to ADD to the queue — sending a
    // prescription to be printed is the doctor deciding it is finished.
    'get-print-queue',
    'mark-print-job-printed',
    'cancel-print-job',
    'print-document',
    'list-printers',

    // ── The till ──────────────────────────────────────────────────────────
    // Taking money and handing over the receipt. Reversing a payment is a
    // correction and should carry the doctor's name; the practice-wide
    // outstanding-balance view is the financial position and stays out.
    'record-payment',
    'get-payments-by-consultation-id',
    'get-consultation-balance',
    'generate-receipt-pdf',

]);

export type PermissionDenial = { status: 'fail'; message: string; code: 'forbidden' | 'unauthenticated' };

/**
 * Returns a denial to hand straight back to the renderer, or null to proceed.
 *
 * Note the return shape is the services' own `{ status: 'fail' }` convention,
 * so a denied call looks to the renderer exactly like any other failed one. A
 * handful of channels resolve to a bare array or number instead, and their
 * callers all guard with `Array.isArray(...)` — so a denial there degrades to
 * an empty list rather than a crash. The sidebar should never route an
 * assistant at those screens in the first place; this is the backstop.
 */
export function checkPermission(channel: string, user: SessionUser | null): PermissionDenial | null {
    if (PUBLIC_CHANNELS.has(channel)) return null;

    if (!user) {
        return {
            status: 'fail',
            code: 'unauthenticated',
            message: "Session expirée. Reconnectez-vous.",
        };
    }

    if (user.role === 'doctor') return null;

    if (user.role === 'assistant' && ASSISTANT_CHANNELS.has(channel)) return null;

    return {
        status: 'fail',
        code: 'forbidden',
        message: "Cette action est réservée au médecin.",
    };
}

/** True when an assistant may reach `channel`. Exported for the renderer's route guard. */
export function isAssistantChannel(channel: string): boolean {
    return ASSISTANT_CHANNELS.has(channel) || PUBLIC_CHANNELS.has(channel);
}
