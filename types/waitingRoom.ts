/**
 * Who is physically in the practice right now.
 *
 * This is not a third table. A visit is already a `consultations` row — an
 * appointment is the *intent* to see someone, a consultation is the encounter —
 * and arriving is a fact about the encounter, so the queue is derived from two
 * timestamps on that row rather than tracked beside it:
 *
 *   waiting  → arrived_at IS NOT NULL AND called_at IS NULL
 *   in room  → called_at IS NOT NULL
 *
 * The consequence worth knowing: checking a patient in CREATES the consultation
 * draft. That is what lets the desk record a weight and a blood pressure while
 * the patient waits (see scopeDraftToRole in electron/services/consultations.ts)
 * and what lets the doctor pick the visit up with everything already attached.
 */

import type { ConsultationListItem } from './consultation';

export interface WaitingRoomEntry extends ConsultationListItem {
    /** Local 'YYYY-MM-DDTHH:MM:SS'. Never null on an entry in this list. */
    arrivedAt: string;
    /** Set only on the patient in the room; null for everyone waiting. */
    calledAt: string | null;
    /** True when the desk floated this patient to the front of the queue. */
    isPriority: boolean;
    /**
     * Whole minutes since arrival — until `calledAt` for the patient in the
     * room, until now for everyone else.
     *
     * Computed in the main process so both seats agree on it. Deriving it in the
     * renderer would measure against the CLIENT's clock, and two machines in a
     * clinic are routinely a few minutes apart.
     */
    waitedMinutes: number;
    /**
     * Minutes since the doctor called this patient in — how long the
     * consultation has been running. 0 for everyone still waiting.
     *
     * Separate from `waitedMinutes`, which stops counting at `calledAt`: one is
     * how long they sat outside, the other how long they have been inside, and
     * on the board they answer different questions.
     */
    inRoomMinutes: number;
    /**
     * ESTIMATED minutes still to wait, rounded up to the nearest 5. Always 0 for
     * the patient already in the room.
     *
     * A projection, not a promise: queue position × how long a consultation
     * typically takes here (see typicalVisitMinutes), less whatever the current
     * visit has already used. It cannot know that the next patient will need
     * forty minutes, so anything showing it to a patient should say "about".
     */
    etaMinutes: number;
    /** Scheduled time 'HH:MM' when this visit came from the calendar. */
    appointmentTime: string | null;
}

export interface WaitingRoom {
    /** Arrival order, except that prioritised patients come first. */
    waiting: WaitingRoomEntry[];
    /** The visit currently open, if the doctor is with someone. */
    inRoom: WaitingRoomEntry | null;
    /**
     * What one consultation is currently reckoned to take, in minutes — measured
     * from this practice's own recent visits where possible. Exposed so a screen
     * can explain where its estimates come from rather than presenting them as
     * fact.
     */
    typicalMinutes: number;
}
