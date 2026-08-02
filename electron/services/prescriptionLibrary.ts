// Reusable prescribing content: what the doctor has typed before (suggestions)
// and what they deliberately saved for reuse (templates).
//
// Kept out of prescription.ts, which is dominated by pdf-lib layout code and
// concerns itself with issuing a prescription to a specific patient. Nothing in
// here touches a patient — it is the doctor's own library.
import { getDatabase } from "../db/db";
import { escapeLike, normalizeSearchText } from "../db/normalize";
import type { MedicineLine, MedicineSuggestion, PrescriptionTemplate } from "../../types/doctor";

/** Suggestions shown at once. Enough to be useful, few enough to scan. */
const SUGGESTION_LIMIT = 8;

type MedicineRow = {
    medicine_name: string;
    dosage: string | null;
    frequency: string | null;
    duration: string | null;
    quantity: string | null;
};

function mapMedicineLine(row: MedicineRow): MedicineLine {
    return {
        medicineName: row.medicine_name,
        dosage: row.dosage ?? '',
        frequency: row.frequency ?? '',
        duration: row.duration ?? '',
        quantity: row.quantity ?? '',
    };
}

/**
 * Autocomplete over the doctor's own prescribing history.
 *
 * Drugs are grouped by their folded name (see db/normalize.ts) so "Paracétamol"
 * and "paracetamol" are one entry rather than two, and each entry carries the
 * posology from the MOST RECENT time that drug was prescribed — picking a
 * suggestion refills dosage, frequency, duration and quantity too, which is
 * where the actual typing is saved.
 *
 * An empty query returns the most-prescribed drugs, so focusing the field with
 * nothing typed shows the doctor their own top-8 shortlist.
 */
export function suggestMedicines(query: string, limit: number = SUGGESTION_LIMIT) {
    try {
        const db = getDatabase();
        const terms = normalizeSearchText(query).split(' ').filter(Boolean);

        // MAX(id) identifies the newest row per drug; joining back on it is what
        // makes the returned posology the last-used one rather than an arbitrary
        // row from the group.
        const grouped = `
            SELECT norm(medicine_name) AS folded, MAX(id) AS last_id, COUNT(*) AS uses
            FROM prescription_medicines
            WHERE TRIM(COALESCE(medicine_name, '')) <> ''
            GROUP BY norm(medicine_name)
        `;

        const where = terms.length
            ? `WHERE ${terms.map(() => `agg.folded LIKE ? ESCAPE '\\'`).join(' AND ')}`
            : '';
        const params = terms.map((t) => `%${escapeLike(t)}%`);

        const rows = db
            .prepare(
                `SELECT m.medicine_name, m.dosage, m.frequency, m.duration, m.quantity, agg.uses
                 FROM (${grouped}) agg
                 JOIN prescription_medicines m ON m.id = agg.last_id
                 ${where}
                 ORDER BY agg.uses DESC, m.id DESC
                 LIMIT ?`
            )
            .all(...params, limit) as (MedicineRow & { uses: number })[];

        const data: MedicineSuggestion[] = rows.map((row) => ({
            ...mapMedicineLine(row),
            uses: row.uses,
        }));
        return { status: "success", data };
    } catch (error) {
        console.error("suggestMedicines error:", error);
        return { status: "fail", message: (error as Error).message, data: [] as MedicineSuggestion[] };
    }
}

/** Every template belonging to a doctor, newest first, with its lines attached. */
export function getPrescriptionTemplates(userId: number) {
    try {
        const db = getDatabase();
        const templates = db
            .prepare(
                `SELECT id, user_id, name, notes, created_at
                 FROM prescription_templates WHERE user_id = ? ORDER BY name COLLATE NOCASE`
            )
            .all(userId) as { id: number; user_id: number; name: string; notes: string | null; created_at: string }[];

        const linesStmt = db.prepare(
            `SELECT medicine_name, dosage, frequency, duration, quantity
             FROM prescription_template_medicines
             WHERE template_id = ? ORDER BY position, id`
        );

        const data: PrescriptionTemplate[] = templates.map((row) => ({
            id: row.id,
            userId: row.user_id,
            name: row.name,
            notes: row.notes,
            createdAt: row.created_at,
            medicines: (linesStmt.all(row.id) as MedicineRow[]).map(mapMedicineLine),
        }));
        return { status: "success", data };
    } catch (error) {
        console.error("getPrescriptionTemplates error:", error);
        return { status: "fail", message: (error as Error).message, data: [] as PrescriptionTemplate[] };
    }
}

/**
 * Saves (or replaces) a named template.
 *
 * Re-using an existing name overwrites that template rather than creating a
 * near-duplicate the doctor then has to tell apart in a dropdown — the unique
 * index on (user_id, name) enforces it, and the delete-then-insert below makes
 * the replacement total instead of merging old lines with new.
 */
export function savePrescriptionTemplate(
    userId: number,
    name: string,
    medicines: MedicineLine[],
    notes?: string
) {
    try {
        const trimmedName = name.trim();
        if (!trimmedName) return { status: "fail", message: "empty_name" };

        const lines = medicines.filter((m) => m.medicineName?.trim());
        if (!lines.length) return { status: "fail", message: "no_medicines" };

        const db = getDatabase();
        const save = db.transaction(() => {
            const existing = db
                .prepare(`SELECT id FROM prescription_templates WHERE user_id = ? AND name = ?`)
                .get(userId, trimmedName) as { id: number } | undefined;

            let templateId: number;
            if (existing) {
                db.prepare(`UPDATE prescription_templates SET notes = ? WHERE id = ?`)
                    .run(notes?.trim() || null, existing.id);
                db.prepare(`DELETE FROM prescription_template_medicines WHERE template_id = ?`)
                    .run(existing.id);
                templateId = existing.id;
            } else {
                const result = db
                    .prepare(`INSERT INTO prescription_templates (user_id, name, notes) VALUES (?, ?, ?)`)
                    .run(userId, trimmedName, notes?.trim() || null);
                templateId = result.lastInsertRowid as number;
            }
            const replaced = Boolean(existing);

            const insertLine = db.prepare(
                `INSERT INTO prescription_template_medicines
                   (template_id, medicine_name, dosage, frequency, duration, quantity, position)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            );
            lines.forEach((line, position) => {
                insertLine.run(
                    templateId,
                    line.medicineName.trim(),
                    line.dosage || null,
                    line.frequency || null,
                    line.duration || null,
                    line.quantity || null,
                    position
                );
            });
            return { templateId, replaced };
        });

        return { status: "success", data: save() };
    } catch (error) {
        console.error("savePrescriptionTemplate error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/** Removes a template. Its lines go with it via ON DELETE CASCADE. */
export function deletePrescriptionTemplate(id: number) {
    try {
        const db = getDatabase();
        const result = db.prepare(`DELETE FROM prescription_templates WHERE id = ?`).run(id);
        if (!result.changes) return { status: "not_found" };
        return { status: "success" };
    } catch (error) {
        console.error("deletePrescriptionTemplate error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}
