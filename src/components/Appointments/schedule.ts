/* Shared scheduling constants. Kept out of BookingModal.tsx so that file
   exports nothing but its component — the repo's convention, and what
   react-refresh needs to hot-reload a component file. */

/** The consulting hours the calendar is drawn on. */
export const TIME_SLOTS = [
    "08:00", "08:30", "09:00", "09:30", "10:00", "10:30",
    "11:00", "11:30", "12:00", "12:30", "13:00", "13:30",
    "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30"
];

/** Local 'YYYY-MM-DD' — the format the appointment queries expect. */
export function dateKey(date: Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
