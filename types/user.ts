/**
 * Who may sign in, and what they are allowed to reach.
 *
 * `doctor` is the practice owner: one per install, created by registering on
 * the login screen the first time the app runs, and the only role that owns a
 * `doctor_profile` row. Every clinical record keys off that profile, not off
 * the user — so an assistant works on the doctor's patients, appointments and
 * consultations without owning any of them.
 *
 * `assistant` is a front-desk seat created by the doctor in Settings. What it
 * may reach is decided in one place, `electron/services/permissions.ts`.
 */
export type UserRole = 'doctor' | 'assistant';

export type User = {
    id: number;
    fullName: string;
    phoneNumber: string;
    password: string;
    role: UserRole;
    createdAt: string;
    updatedAt: string;
}

/**
 * A user as the Settings list shows them.
 *
 * Deliberately not `Omit<User, 'password'>`: this crosses IPC and one day the
 * wire, and a shape derived by subtraction quietly re-admits the hash the day
 * someone renames the column. Listing the safe fields is the point.
 */
export type UserSummary = {
    id: number;
    fullName: string;
    role: UserRole;
    createdAt: string;
};
