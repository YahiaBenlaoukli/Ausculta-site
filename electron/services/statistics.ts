import { getDatabase } from '../db/db';

// Appointment datetimes are stored as 'YYYY-MM-DDTHH:MM:SS' strings, so a bare
// 'YYYY-MM-DD' end date would exclude every appointment on that day in a
// string BETWEEN comparison. Extend it to the end of the day.
function endOfDay(date: string): string {
    return date.length === 10 ? `${date}T23:59:59.999` : date;
}

// Revenue is billed from consultations, not appointments: a walk-in earns money
// without ever having been on the calendar, and a completed appointment where
// the patient left before being seen did not. Consultations with a NULL fee —
// which includes every visit migrated from the pre-v8 schema — fall back to the
// practice's configured default price, so historical totals are unchanged.
export function getFinancialStatistics(startDate: string, endDate: string, defaultFee: number = 2000) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
            SELECT COUNT(*) AS total_completed,
                   COALESCE(SUM(COALESCE(fee, ?)), 0) AS total_revenue
            FROM consultations
            WHERE status = 'Completed' AND consultation_datetime BETWEEN ? AND ?
        `);
        const result = stmt.get(defaultFee, startDate, endOfDay(endDate)) as { total_completed: number; total_revenue: number } | undefined;
        return {
            total_completed: result ? result.total_completed : 0,
            total_revenue: result ? result.total_revenue : 0,
        };
    } catch (error) {
        console.error("getFinancialStatistics error:", error);
        return { total_completed: 0, total_revenue: 0 };
    }
}

// The clinical/financial side of the practice: how many people were actually
// seen, how many walked in, and what that is worth. Pairs with
// getAppointmentStatistics below, which stays purely about the calendar funnel.
export function getConsultationStatistics(startDate: string, endDate: string, defaultFee: number = 2000) {
    const empty = {
        total_consultations: 0,
        total_walk_ins: 0,
        total_scheduled_visits: 0,
        total_revenue: 0,
        total_unpaid: 0,
    };
    try {
        const db = getDatabase();
        const end = endOfDay(endDate);
        const stmt = db.prepare(`
            SELECT COUNT(*) AS total_consultations,
                   COALESCE(SUM(CASE WHEN is_walk_in = 1 THEN 1 ELSE 0 END), 0) AS total_walk_ins,
                   COALESCE(SUM(CASE WHEN is_walk_in = 1 THEN 0 ELSE 1 END), 0) AS total_scheduled_visits,
                   COALESCE(SUM(COALESCE(fee, ?)), 0) AS total_revenue,
                   COALESCE(SUM(CASE WHEN is_paid = 0 THEN COALESCE(fee, ?) ELSE 0 END), 0) AS total_unpaid
            FROM consultations
            WHERE status = 'Completed' AND consultation_datetime BETWEEN ? AND ?
        `);
        const result = stmt.get(defaultFee, defaultFee, startDate, end) as typeof empty | undefined;
        return result ?? empty;
    } catch (error) {
        console.error("getConsultationStatistics error:", error);
        return empty;
    }
}

// The calendar funnel: how the scheduled appointments in the range resolved.
// `total_completed` here counts *appointments*, so it can legitimately differ
// from getConsultationStatistics().total_consultations — the gap is the
// walk-ins, who were seen without ever being booked.
export function getAppointmentStatistics(startDate: string, endDate: string, defaultFee: number = 2000) {
    const empty = {
        total_completed: 0,
        total_no_show: 0,
        total_cancelled: 0,
        total_scheduled: 0,
        total_appointments: 0,
        total_revenue: 0
    };
    try {
        const db = getDatabase();
        const end = endOfDay(endDate);
        const stmt = db.prepare(`SELECT
            (SELECT COUNT(*) FROM appointments WHERE status = 'Completed' AND appointment_datetime BETWEEN ? AND ?) AS total_completed,
            (SELECT COUNT(*) FROM appointments WHERE status = 'No-Show' AND appointment_datetime BETWEEN ? AND ?) AS total_no_show,
            (SELECT COUNT(*) FROM appointments WHERE status = 'Cancelled' AND appointment_datetime BETWEEN ? AND ?) AS total_cancelled,
            (SELECT COUNT(*) FROM appointments WHERE status = 'Scheduled' AND appointment_datetime BETWEEN ? AND ?) AS total_scheduled,
            (SELECT COUNT(*) FROM appointments WHERE appointment_datetime BETWEEN ? AND ?) AS total_appointments
        `);
        const result = stmt.get(
            startDate, end,
            startDate, end,
            startDate, end,
            startDate, end,
            startDate, end
        ) as {
            total_completed: number;
            total_no_show: number;
            total_cancelled: number;
            total_scheduled: number;
            total_appointments: number;
        } | undefined;

        if (!result) {
            return empty;
        }

        // Revenue comes from consultations so this agrees with
        // getFinancialStatistics / getConsultationStatistics rather than
        // silently reporting a second, appointment-based total.
        return {
            ...result,
            total_revenue: getFinancialStatistics(startDate, endDate, defaultFee).total_revenue
        };
    } catch (error) {
        console.error("getAppointmentStatistics error:", error);
        return empty;
    }
}

export function getNoShowRate(startDate: string, endDate: string) {
    try {
        const db = getDatabase();
        const end = endOfDay(endDate);

        // Get counts for rate calculation
        const countsStmt = db.prepare(`SELECT
            (SELECT COUNT(*) FROM appointments WHERE status = 'No-Show' AND appointment_datetime BETWEEN ? AND ?) AS total_no_show,
            (SELECT COUNT(*) FROM appointments WHERE appointment_datetime BETWEEN ? AND ?) AS total_appointments
        `);
        const counts = countsStmt.get(startDate, end, startDate, end) as {
            total_no_show: number;
            total_appointments: number;
        } | undefined;

        const total_no_show = counts ? counts.total_no_show : 0;
        const total_appointments = counts ? counts.total_appointments : 0;
        const no_show_rate = total_appointments > 0 ? (total_no_show / total_appointments) * 100 : 0;

        // Get top patients who did not show up
        const topPatientsStmt = db.prepare(`
            SELECT p.id, p.full_name, p.phone_number, COUNT(a.id) AS no_show_count
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            WHERE a.status = 'No-Show' AND a.appointment_datetime BETWEEN ? AND ?
            GROUP BY p.id
            ORDER BY no_show_count DESC
            LIMIT 5
        `);
        const top_no_show_patients = topPatientsStmt.all(startDate, end);

        return {
            total_no_show,
            total_appointments,
            no_show_rate,
            top_no_show_patients
        };
    } catch (error) {
        console.error("getNoShowRate error:", error);
        return { total_no_show: 0, total_appointments: 0, no_show_rate: 0, top_no_show_patients: [] };
    }
}

// Monthly volume of visits actually carried out, split by how the patient
// arrived — a rising walk-in share is a scheduling signal worth seeing.
export function getConsultationVolume(startDate: string, endDate: string) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
            SELECT
                strftime('%Y-%m', consultation_datetime) AS month,
                COUNT(*) AS total_consultations,
                SUM(CASE WHEN is_walk_in = 1 THEN 1 ELSE 0 END) AS walk_in_consultations
            FROM consultations
            WHERE status = 'Completed' AND consultation_datetime BETWEEN ? AND ?
            GROUP BY month
            ORDER BY month ASC
        `);
        const monthlyVolume = stmt.all(startDate, endOfDay(endDate));
        return monthlyVolume;
    } catch (error) {
        console.error("getConsultationVolume error:", error);
        return [];
    }
}
