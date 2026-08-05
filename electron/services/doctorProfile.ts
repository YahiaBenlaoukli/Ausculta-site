// The one place a doctor_profile row becomes a DoctorProfile.
//
// prescription.ts, certificates.ts and payments.ts each used to carry their own
// copy of this mapping, all reading `SELECT * FROM doctor_profile`. Adding a
// column meant remembering three files, and forgetting one produced a profile
// that was silently missing a field rather than a compile error.
import type { DoctorProfile, PrescriptionStyle } from "../../types/doctor";

/**
 * Anything other than an explicit "colorful" is the classic artwork. An
 * allow-list rather than a comparison against "classic", so a null column on a
 * database that predates schema v14 — and any value written by a newer build —
 * both resolve to the template that is guaranteed to exist.
 */
export function normalizeStyle(style?: string | null): PrescriptionStyle {
    return style === "colorful" ? "colorful" : "classic";
}

/**
 * Trims a nullable TEXT column, mapping blank to undefined.
 *
 * The colorful letterhead decides whether to print a row by testing the field
 * for truthiness; without this, a field the doctor cleared to spaces would
 * reserve a line of whitespace in the middle of the header.
 */
export function optionalText(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}

/** Maps a full `SELECT * FROM doctor_profile` row. */
export function mapRowToDoctorProfile(row: Record<string, unknown>): DoctorProfile {
    return {
        id: row.id as number,
        userId: row.user_id as number,
        fullName: row.full_name as string,
        // Coalesced because these three are nullable in the schema but every
        // consumer draws them straight onto a page.
        email: (row.email as string) ?? "",
        phoneNumber: (row.phone_number as string) ?? "",
        address: (row.address as string) ?? "",
        speciality: (row.speciality as string) ?? "",
        hasCompletedProfile: Boolean(row.has_completed_profile),
        prescriptionStyle: normalizeStyle(row.prescription_style as string | null),
        fullNameAr: optionalText(row.full_name_ar),
        specialityAr: optionalText(row.speciality_ar),
        diploma: optionalText(row.diploma),
        diplomaAr: optionalText(row.diploma_ar),
        clinicName: optionalText(row.clinic_name),
        clinicNameAr: optionalText(row.clinic_name_ar),
        orderNumber: optionalText(row.order_number),
        city: optionalText(row.city),
        pdfPath: row.pdf_path as string | undefined,
        pdfPathEn: row.pdf_path_en as string | undefined,
    };
}
