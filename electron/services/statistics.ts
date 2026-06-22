import { getDatabase } from '../db/db';

export function getFinancalStatistics(startDate: string, endDate: string, appointmentPrice: number = 2000) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
            SELECT COUNT(*) AS total_completed
            FROM appointments
            WHERE status = 'Completed' AND appointment_datetime BETWEEN ? AND ?
        `);
        const result = stmt.get(startDate, endDate) as { total_completed: number } | undefined;
        const total_completed = result ? result.total_completed : 0;
        const total_revenue = total_completed * appointmentPrice;
        return { total_completed, total_revenue };
    } catch (error) {
        console.error("getFinancalStatistics error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

export function getAppointmentStatistics(startDate: string, endDate: string, appointmentPrice: number = 2000) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`SELECT 
            (SELECT COUNT(*) FROM appointments WHERE status = 'Completed' AND appointment_datetime BETWEEN ? AND ?) AS total_completed,
            (SELECT COUNT(*) FROM appointments WHERE status = 'No-Show' AND appointment_datetime BETWEEN ? AND ?) AS total_no_show,
            (SELECT COUNT(*) FROM appointments WHERE status = 'Cancelled' AND appointment_datetime BETWEEN ? AND ?) AS total_cancelled,
            (SELECT COUNT(*) FROM appointments WHERE status = 'Scheduled' AND appointment_datetime BETWEEN ? AND ?) AS total_scheduled,
            (SELECT COUNT(*) FROM appointments WHERE appointment_datetime BETWEEN ? AND ?) AS total_appointments
        `);
        const result = stmt.get(
            startDate, endDate,
            startDate, endDate,
            startDate, endDate,
            startDate, endDate,
            startDate, endDate
        ) as {
            total_completed: number;
            total_no_show: number;
            total_cancelled: number;
            total_scheduled: number;
            total_appointments: number;
        } | undefined;

        if (!result) {
            return {
                total_completed: 0,
                total_no_show: 0,
                total_cancelled: 0,
                total_scheduled: 0,
                total_appointments: 0,
                total_revenue: 0
            };
        }

        return {
            ...result,
            total_revenue: result.total_completed * appointmentPrice
        };
    } catch (error) {
        console.error("getAppointmentStatistics error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

export function getNoShowRate(startDate: string, endDate: string) {
    try {
        const db = getDatabase();
        
        // Get counts for rate calculation
        const countsStmt = db.prepare(`SELECT 
            (SELECT COUNT(*) FROM appointments WHERE status = 'No-Show' AND appointment_datetime BETWEEN ? AND ?) AS total_no_show,
            (SELECT COUNT(*) FROM appointments WHERE appointment_datetime BETWEEN ? AND ?) AS total_appointments
        `);
        const counts = countsStmt.get(startDate, endDate, startDate, endDate) as {
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
        const top_no_show_patients = topPatientsStmt.all(startDate, endDate);

        return {
            total_no_show,
            total_appointments,
            no_show_rate,
            top_no_show_patients
        };
    } catch (error) {
        console.error("getNoShowRate error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

export function getConsultationVolume(startDate: string, endDate: string) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
            SELECT 
                strftime('%Y-%m', appointment_datetime) AS month,
                COUNT(*) AS total_appointments,
                SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed_appointments
            FROM appointments
            WHERE appointment_datetime BETWEEN ? AND ?
            GROUP BY month
            ORDER BY month ASC
        `);
        const monthlyVolume = stmt.all(startDate, endDate);
        return monthlyVolume;
    } catch (error) {
        console.error("getConsultationVolume error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}