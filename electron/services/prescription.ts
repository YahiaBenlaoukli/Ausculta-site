import { getDatabase } from "../db/db";
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import type { DoctorProfile, Prescription, PrescriptionLanguage } from "../../types/doctor";

import { uploadDocument, getDocumentsByPatientId } from "./documents";


import type { Patient } from "../../types/patient";

const PDF_OUTPUT_DIR = path.join(app.getPath("userData"), "prescriptions");
const PATIENTS_PDF_DIR = path.join(app.getPath('userData'), 'records', 'Gestion-cabinet-medicale');

// Static labels drawn by code (not part of the template artwork) per language.
// The template files themselves (templateFr.pdf / templateEn.pdf) carry the
// rest of the localized layout; these are only the strings pdf-lib writes on top.
const PRESCRIPTION_LABELS = {
    fr: {
        doctorPrefix: "Dr: ",
        signature: "Signature :",
        weight: "Poids:",
        durationPrefix: "Durée : ",
        quantityPrefix: "Qté : ",
        ageSuffix: "ans",
        moreMeds: (count: number) => `+ ${count} autre(s) médicament(s) — voir dossier`,
    },
    en: {
        doctorPrefix: "Dr: ",
        signature: "Signature:",
        weight: "Weight:",
        durationPrefix: "Duration: ",
        quantityPrefix: "Qty: ",
        ageSuffix: "yrs",
        moreMeds: (count: number) => `+ ${count} more medicine(s) — see file`,
    },
} as const;

function normalizeLanguage(language?: string): PrescriptionLanguage {
    return language === "en" ? "en" : "fr";
}

function templateFileForLanguage(language: PrescriptionLanguage): string {
    return language === "en" ? "templateEn.pdf" : "templateFr.pdf";
}

function mapRowToDoctorProfile(row: Record<string, unknown>): DoctorProfile {
    return {
        id: row.id as number,
        userId: row.user_id as number,
        fullName: row.full_name as string,
        email: row.email as string,
        phoneNumber: row.phone_number as string,
        address: row.address as string,
        speciality: row.speciality as string,
        hasCompletedProfile: Boolean(row.has_completed_profile),
        pdfPath: row.pdf_path as string | undefined,
        pdfPathEn: row.pdf_path_en as string | undefined,
    };
}

export async function createDoctorProfile(userId: number, fullName: string, speciality: string, phoneNumber: string, address: string, email: string) {
    try {
        console.log("creating doctor profile in db");
        const db = getDatabase();
        const stmt = db.prepare(`
            INSERT INTO doctor_profile (user_id, full_name, email, phone_number, address, speciality, has_completed_profile)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(userId, fullName, email, phoneNumber, address, speciality, 1);

        const doctor: DoctorProfile = {
            id: result.lastInsertRowid as number,
            userId,
            fullName,
            email,
            phoneNumber,
            address,
            speciality,
            hasCompletedProfile: true,
        };

        return { status: "success", data: doctor };
    } catch (error) {
        console.error("createDoctorProfile error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

export async function getDoctorProfileByUserId(userId: number) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`SELECT * FROM doctor_profile WHERE user_id = ?`);
        let row = stmt.get(userId) as Record<string, unknown> | undefined;
        if (!row) {
            console.log("Doctor profile not found for user", userId, ". Initializing default profile...");
            const userStmt = db.prepare(`SELECT full_name FROM users WHERE id = ?`);
            const userRow = userStmt.get(userId) as { full_name: string } | undefined;
            const fullName = userRow?.full_name ?? "Médecin";

            const createResult = await createDoctorProfile(userId, fullName, "Médecin Généraliste", "", "", "");
            if (createResult.status === "success" && createResult.data) {
                // Initialize default prescription PDF template
                await setPrescriptionPdf(createResult.data.id);
                // Fetch the row again
                row = stmt.get(userId) as Record<string, unknown> | undefined;
            }
        }
        if (!row) {
            return { status: "not_found", data: null };
        }
        // Backfill the English preview for profiles created before language
        // support (pdf_path exists but pdf_path_en is still null). Runs once —
        // setPrescriptionPdf populates both columns, so the branch won't re-fire.
        if (row.pdf_path && !row.pdf_path_en) {
            await setPrescriptionPdf(row.id as number);
            row = stmt.get(userId) as Record<string, unknown> | undefined;
            if (!row) {
                return { status: "not_found", data: null };
            }
        }
        const doctor = mapRowToDoctorProfile(row);
        return { status: "success", data: doctor };
    } catch (error) {
        console.error("getDoctorProfileByUserId error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

export async function updateDoctorProfile(userId: number, fullName: string, speciality: string, phoneNumber: string, address: string, email: string) {
    try {
        console.log("updating doctor profile in db for user", userId);
        const db = getDatabase();
        const checkStmt = db.prepare(`SELECT id FROM doctor_profile WHERE user_id = ?`);
        let profile = checkStmt.get(userId) as { id: number } | undefined;

        if (!profile) {
            // If somehow doesn't exist, create it
            const createResult = await createDoctorProfile(userId, fullName, speciality, phoneNumber, address, email);
            if (createResult.status !== "success" || !createResult.data) {
                throw new Error(createResult.message || "Failed to create doctor profile");
            }
            profile = { id: createResult.data.id };
        } else {
            const stmt = db.prepare(`
                UPDATE doctor_profile 
                SET full_name = ?, speciality = ?, phone_number = ?, address = ?, email = ?
                WHERE user_id = ?
            `);
            stmt.run(fullName, speciality, phoneNumber, address, email, userId);
        }

        // Regenerate template PDF with the new details
        await setPrescriptionPdf(profile.id);

        // Fetch updated profile
        const selectStmt = db.prepare(`SELECT * FROM doctor_profile WHERE user_id = ?`);
        const row = selectStmt.get(userId) as Record<string, unknown> | undefined;
        const doctor = row ? mapRowToDoctorProfile(row) : null;

        return { status: "success", data: doctor };
    } catch (error) {
        console.error("updateDoctorProfile error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

export async function setPrescriptionPdf(doctorId: number) {
    try {
        const db = getDatabase();

        // 1. Fetch the doctor profile
        const selectStmt = db.prepare(`SELECT * FROM doctor_profile WHERE id = ?`);
        const row = selectStmt.get(doctorId) as Record<string, unknown> | undefined;
        if (!row) {
            return { status: "fail", message: "Doctor profile not found" };
        }
        const doctor = mapRowToDoctorProfile(row);

        // 2. Fill both language templates with the doctor's header info so each
        //    can be previewed (Settings / Prescriptions page).
        const frResult = await fillTemplate(doctor, "fr");
        if (frResult.status === "fail") {
            return frResult;
        }
        const enResult = await fillTemplate(doctor, "en");
        if (enResult.status === "fail") {
            return enResult;
        }

        // 3. Update the doctor_profile row with both saved PDF paths
        const updateStmt = db.prepare(`UPDATE doctor_profile SET pdf_path = ?, pdf_path_en = ? WHERE id = ?`);
        updateStmt.run(frResult.pdfPath, enResult.pdfPath, doctorId);

        // 4. Return the doctor with the attached PDF paths
        doctor.pdfPath = frResult.pdfPath;
        doctor.pdfPathEn = enResult.pdfPath;

        return { status: "success", data: { doctor, pdfPath: frResult.pdfPath, pdfPathEn: enResult.pdfPath } };
    } catch (error) {
        console.error("setPrescriptionPdf error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

export function addPrescription(userId: number, patientId: number, medicines: { medicineName: string; dosage: string; frequency: string; quantity: string; duration: string }[], notes?: string, consultationId?: number) {
    try {
        const db = getDatabase();
        const insertPrescription = db.prepare(`
            INSERT INTO prescriptions (user_id, patient_id, notes, consultation_id)
            VALUES (?, ?, ?, ?)
        `);
        const insertMedicine = db.prepare(`
            INSERT INTO prescription_medicines (prescription_id, medicine_name, dosage, frequency, duration, quantity)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        const transaction = db.transaction(() => {
            const result = insertPrescription.run(userId, patientId, notes || null, consultationId ?? null);
            const prescriptionId = result.lastInsertRowid as number;
            for (const med of medicines) {
                insertMedicine.run(prescriptionId, med.medicineName, med.dosage, med.frequency, med.duration, med.quantity);
            }
            return prescriptionId;
        });

        const prescriptionId = transaction();
        return { status: "success", data: { prescriptionId } };
    } catch (error) {
        console.error("addPrescription error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

function getCenteredX(text: string, font: import("pdf-lib").PDFFont, fontSize: number, pageWidth: number): number {
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    return (pageWidth - textWidth) / 2;
}

function drawFittedText(
    page: PDFPage,
    text: string,
    font: PDFFont,
    x: number,
    y: number,
    maxWidth: number,
    defaultSize: number,
    minSize: number
) {
    let size = defaultSize;
    while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) {
        size -= 0.5;
    }
    if (font.widthOfTextAtSize(text, size) <= maxWidth) {
        page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });
        return;
    }

    // Still too wide at minSize: break onto two lines at the last word that fits
    const words = text.split(" ");
    let firstLine = "";
    let i = 0;
    for (; i < words.length; i++) {
        const candidate = firstLine ? `${firstLine} ${words[i]}` : words[i];
        if (firstLine && font.widthOfTextAtSize(candidate, minSize) > maxWidth) break;
        firstLine = candidate;
    }
    const secondLine = words.slice(i).join(" ");

    page.drawText(firstLine, { x, y, size: minSize, font, color: rgb(0, 0, 0) });
    if (secondLine) {
        page.drawText(secondLine, { x, y: y - (minSize + 2), size: minSize, font, color: rgb(0, 0, 0) });
    }
}

// Draws the doctor's header block (name, speciality, contact info, signature
// label) onto a prescription page. Shared by the settings-preview template and
// the per-patient prescription so both stay in sync. Positions match the artwork
// in both templateFr.pdf and templateEn.pdf (identical layout, translated labels).
function drawDoctorHeader(
    page: PDFPage,
    doctor: DoctorProfile,
    helveticaFont: PDFFont,
    helveticaFontBold: PDFFont,
    width: number,
    height: number,
    language: PrescriptionLanguage
) {
    const labels = PRESCRIPTION_LABELS[language];

    const fullNameText = `${labels.doctorPrefix}${doctor.fullName}`;
    page.drawText(fullNameText, {
        x: getCenteredX(fullNameText, helveticaFontBold, 20, width),
        y: height - 54,
        size: 20,
        font: helveticaFontBold,
        color: rgb(0, 0, 0),
    });
    page.drawText(doctor.speciality, {
        x: getCenteredX(doctor.speciality, helveticaFontBold, 13, width),
        y: height - 78,
        size: 13,
        font: helveticaFontBold,
        color: rgb(0, 0, 0),
    });
    page.drawText(doctor.phoneNumber, {
        x: 91,
        y: height - 125,
        size: 10,
        font: helveticaFont,
        color: rgb(0, 0, 0),
    });
    page.drawText(doctor.email, {
        x: 240,
        y: height - 125,
        size: 10,
        font: helveticaFont,
        color: rgb(0, 0, 0)
    });
    const addressMaxWidth = width - 412 - 15;
    drawFittedText(page, doctor.address, helveticaFont, 412, height - 125, addressMaxWidth, 10, 7);

    const signatureLabel = labels.signature;
    const signatureFontSize = 11;
    const signatureMarginRight = 90;
    const signatureMarginBottom = 90;
    const signatureWidth = helveticaFontBold.widthOfTextAtSize(signatureLabel, signatureFontSize);
    page.drawText(signatureLabel, {
        x: width - signatureMarginRight - signatureWidth,
        y: signatureMarginBottom,
        size: signatureFontSize,
        font: helveticaFontBold,
        color: rgb(0, 0, 0),
    });
}

async function fillTemplate(
    doctor: DoctorProfile,
    language: PrescriptionLanguage = "fr"
): Promise<{ status: "success"; pdfPath: string } | { status: "fail"; message: string }> {
    try {
        const templatePath = path.join(process.env.VITE_PUBLIC, "ordonnance", templateFileForLanguage(language));
        const existingPdfBytes = await fs.readFile(templatePath);
        const pdfDoc = await PDFDocument.load(existingPdfBytes);

        const pages = pdfDoc.getPages();
        const firstPage = pages[0];
        const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const helveticaFontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const { width, height } = firstPage.getSize();

        drawDoctorHeader(firstPage, doctor, helveticaFont, helveticaFontBold, width, height, language);

        const modifiedPdfBytes = await pdfDoc.save();

        // Save the filled PDF to disk
        await fs.mkdir(PDF_OUTPUT_DIR, { recursive: true });
        const outputFileName = `prescription_dr_${doctor.id}_${Date.now()}.pdf`;
        const outputPath = path.join(PDF_OUTPUT_DIR, outputFileName);
        await fs.writeFile(outputPath, modifiedPdfBytes);

        return { status: "success", pdfPath: outputPath };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

// Helper: hydrate a prescription row with its medicines
function hydratePrescription(db: ReturnType<typeof getDatabase>, prescriptionRow: Record<string, unknown>): Prescription {
    const medicinesStmt = db.prepare(`SELECT * FROM prescription_medicines WHERE prescription_id = ? ORDER BY id`);
    const medicineRows = medicinesStmt.all(prescriptionRow.id as number) as Record<string, unknown>[];
    return {
        id: prescriptionRow.id as number,
        userId: prescriptionRow.user_id as number,
        patientId: prescriptionRow.patient_id as number,
        consultationId: (prescriptionRow.consultation_id ?? null) as number | null,
        notes: prescriptionRow.notes as string | null,
        medicines: medicineRows.map(m => ({
            id: m.id as number,
            prescriptionId: m.prescription_id as number,
            medicineName: m.medicine_name as string,
            dosage: m.dosage as string,
            frequency: m.frequency as string,
            duration: m.duration as string,
            quantity: m.quantity as string,
            createdAt: m.created_at as string,
        })),
        createdAt: prescriptionRow.created_at as string,
    };
}

export function getAllPrescriptions() {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`SELECT * FROM prescriptions ORDER BY created_at DESC`);
        const rows = stmt.all() as Record<string, unknown>[];
        const result = rows.map(row => hydratePrescription(db, row));
        return { status: "success", data: result };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

export function getPatientPrescriptions(patientId: number) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`SELECT * FROM prescriptions WHERE patient_id = ? ORDER BY created_at DESC`);
        const rows = stmt.all(patientId) as Record<string, unknown>[];
        const result = rows.map(row => hydratePrescription(db, row));
        return { status: "success", data: result };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

export function getPrescriptionById(id: number, patientId: number) {
    try {
        const db = getDatabase();

        const prescriptionStmt = db.prepare(`SELECT * FROM prescriptions WHERE id = ? AND patient_id = ?`);
        const row = prescriptionStmt.get(id, patientId) as Record<string, unknown> | undefined;
        if (!row) {
            return { status: "fail", message: "Prescription not found" };
        }

        const prescription = hydratePrescription(db, row);

        // Get documents linked to this specific prescription, or all prescription docs for this patient
        const allDocs = getDocumentsByPatientId(patientId);
        const linkedDocs = allDocs.filter(doc => doc.prescriptionId === id);
        const documents = linkedDocs.length > 0
            ? linkedDocs
            : allDocs.filter(doc => doc.fileCategory === "prescription");

        return { status: "success", data: { prescription, documents } };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

export function updatePrescription(prescription: Prescription) {
    try {
        const db = getDatabase();

        const transaction = db.transaction(() => {
            // Update the prescription header
            const updateHeader = db.prepare(`
                UPDATE prescriptions SET user_id = ?, patient_id = ?, notes = ? WHERE id = ?
            `);
            updateHeader.run(prescription.userId, prescription.patientId, prescription.notes, prescription.id);

            // Delete old medicines and re-insert
            const deleteMeds = db.prepare(`DELETE FROM prescription_medicines WHERE prescription_id = ?`);
            deleteMeds.run(prescription.id);

            const insertMed = db.prepare(`
                INSERT INTO prescription_medicines (prescription_id, medicine_name, dosage, frequency, duration, quantity)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            for (const med of prescription.medicines) {
                insertMed.run(prescription.id, med.medicineName, med.dosage, med.frequency, med.duration, med.quantity);
            }
        });

        transaction();
        return { status: "success", data: { prescriptionId: prescription.id } };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

export function deletePrescription(id: number) {
    try {
        const db = getDatabase();
        // ON DELETE CASCADE will remove prescription_medicines automatically
        const stmt = db.prepare(`DELETE FROM prescriptions WHERE id = ?`);
        const result = stmt.run(id);
        return { status: "success", data: result };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}


export async function searchPrescription(query: string) {
    try {
        const db = getDatabase();
        // Search across prescription_medicines and return the parent prescriptions
        const stmt = db.prepare(`
            SELECT DISTINCT p.* FROM prescriptions p
            LEFT JOIN prescription_medicines pm ON pm.prescription_id = p.id
            WHERE pm.medicine_name LIKE ? ESCAPE '\\' OR pm.dosage LIKE ? ESCAPE '\\' OR pm.frequency LIKE ? ESCAPE '\\' OR pm.duration LIKE ? ESCAPE '\\' OR p.notes LIKE ? ESCAPE '\\'
            ORDER BY p.created_at DESC
        `);
        const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const rows = stmt.all(pattern, pattern, pattern, pattern, pattern) as Record<string, unknown>[];
        const result = rows.map(row => hydratePrescription(db, row));
        return { status: "success", data: result };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

export async function countPrescriptions() {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`SELECT COUNT(*) as count FROM prescriptions`);
        const result = stmt.get() as Record<string, unknown>;
        return { status: "success", data: result.count };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}


function mapRowToPatient(row: Record<string, unknown>): Patient {
    return {
        id: row.id as number,
        fullName: row.full_name as string,
        dateOfBirth: row.date_of_birth as string,
        address: row.address as string,
        phoneNumber: row.phone_number as string,
        ssn: row.ssn as string,
        bloodType: (row.blood_type as Patient["bloodType"]) ?? null,
        createdAt: row.created_at as string,
    };
}

export function getPrescriptionsByConsultationId(consultationId: number) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`SELECT * FROM prescriptions WHERE consultation_id = ? ORDER BY created_at DESC`);
        const rows = stmt.all(consultationId) as Record<string, unknown>[];
        return rows.map(row => hydratePrescription(db, row));
    } catch (error) {
        console.error("getPrescriptionsByConsultationId error:", error);
        return [];
    }
}

export async function generatePatientPrescriptionPDF(patientId: number, prescriptions: Prescription[], doctor: DoctorProfile, weight?: string, language?: string, consultationId?: number) {
    try {
        const db = getDatabase();
        const patientStmt = db.prepare(`SELECT * FROM patients WHERE id = ?`);
        const patientResult = patientStmt.get(patientId) as Record<string, unknown> | undefined;
        if (!patientResult) {
            return { status: "fail", message: "Patient not found" };
        }
        const patient = mapRowToPatient(patientResult);
        // Use the first prescription's ID to link the document
        const prescriptionId = prescriptions.length > 0 ? prescriptions[0].id : undefined;
        // Fall back to the prescription's own consultation when the caller did
        // not pass one, so a PDF regenerated later from the Prescriptions page
        // still lands in the right visit.
        const visitId = consultationId ?? (prescriptions.length > 0 ? prescriptions[0].consultationId ?? undefined : undefined);
        const pdfResult = await fillPatientPrescriptionTemplate(patient, prescriptions, doctor, normalizeLanguage(language), weight, prescriptionId, visitId);
        if (pdfResult.status === "fail") {
            return pdfResult;
        }

        return { status: "success", data: pdfResult.pdfPath };
    } catch (error) {
        console.error("generatePatientPrescriptionPDF error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

async function fillPatientPrescriptionTemplate(
    patient: Patient,
    prescriptions: Prescription[],
    doctor: DoctorProfile,
    language: PrescriptionLanguage,
    weight?: string,
    prescriptionId?: number,
    consultationId?: number
): Promise<{ status: "success"; pdfPath: string } | { status: "fail"; message: string }> {
    try {
        // Draw the doctor header fresh onto the chosen-language template rather
        // than reusing the pre-baked doctor.pdfPath (which is always French), so
        // the whole prescription — header labels included — matches the language.
        const templatePath = path.join(process.env.VITE_PUBLIC, "ordonnance", templateFileForLanguage(language));
        const existingPdfBytes = await fs.readFile(templatePath);
        const pdfDoc = await PDFDocument.load(existingPdfBytes);
        const pages = pdfDoc.getPages();
        const firstPage = pages[0];
        const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const helveticaFontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const { width, height } = firstPage.getSize();

        drawDoctorHeader(firstPage, doctor, helveticaFont, helveticaFontBold, width, height, language);
        drawPatientInformation(firstPage, patient, helveticaFontBold, helveticaFont, width, height, language, weight);
        drawPrescriptions(firstPage, prescriptions, helveticaFontBold, helveticaFont, width, height, language);

        const modifiedPdfBytes = await pdfDoc.save();

        await fs.mkdir(PATIENTS_PDF_DIR, { recursive: true });
        const outputFileName = `prescription_patient_${patient.id}_${Date.now()}.pdf`;
        const outputPath = path.join(PATIENTS_PDF_DIR, outputFileName);
        await fs.writeFile(outputPath, modifiedPdfBytes);

        await uploadDocument({
            patientId: patient.id,
            prescriptionId: prescriptionId ?? null,
            consultationId: consultationId ?? null,
            fileCategory: "prescription",
            localPath: outputPath,
            fileName: outputFileName,
        });

        return { status: "success", pdfPath: outputPath };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

function drawPatientInformation(page: PDFPage, patient: Patient, helveticaFontBold: PDFFont, _helveticaFont: PDFFont, _width: number, height: number, language: PrescriptionLanguage, weight?: string) {
    const labels = PRESCRIPTION_LABELS[language];
    // The English template's labels have slightly different widths, so nudge a
    // few value positions when generating in English only (French unchanged).
    const isEn = language === "en";
    const dayOfConsultationText = new Date().toLocaleDateString('en-GB');
    page.drawText(dayOfConsultationText, {
        x: 67 + (isEn ? 21 : 0),
        y: height - 209,
        size: 10,
        font: helveticaFontBold,
        color: rgb(0, 0, 0),
    });
    page.drawText(patient.fullName, {
        x: 434 - (isEn ? 15 : 0),
        y: height - 209,
        size: 10,
        font: helveticaFontBold,
        color: rgb(0, 0, 0),
    });
    page.drawText(patient.dateOfBirth, {
        x: 485 - (isEn ? 25 : 0),
        y: height - 238,
        size: 10,
        font: helveticaFontBold,
        color: rgb(0, 0, 0),
    });
    const ageText = `${calculateAge(patient.dateOfBirth).years} ${labels.ageSuffix}`;
    page.drawText(ageText, {
        x: 401,
        y: height - 270,
        size: 10,
        font: helveticaFontBold,
        color: rgb(0, 0, 0),
    });
    if (weight) {
        const weightLabel = labels.weight;
        const weightLabelX = 455;
        page.drawText(weightLabel, {
            x: weightLabelX,
            y: height - 270,
            size: 12,
            font: helveticaFontBold,
            color: rgb(0, 0, 0),
        });
        const patientWeight = `${weight} kg`;
        page.drawText(patientWeight, {
            x: weightLabelX + helveticaFontBold.widthOfTextAtSize(weightLabel, 12) + 2,
            y: height - 270,
            size: 10,
            font: helveticaFontBold,
            color: rgb(0, 0, 0),
        });
    }
}

function drawPrescriptions(page: PDFPage, prescriptions: Prescription[], helveticaFontBold: PDFFont, helveticaFont: PDFFont, width: number, height: number, language: PrescriptionLanguage) {
    const labels = PRESCRIPTION_LABELS[language];
    const marginX = 30;
    const rightMargin = 35;
    // Keep above the signature block: stop before running off the page.
    const bottomLimit = 120;
    let currentY = height - 315;

    const allMedicines = prescriptions.flatMap(p => p.medicines);
    let medIndex = 1;
    for (const med of allMedicines) {
        // Each entry needs ~45pt (name line + detail line + spacing).
        if (currentY - 45 < bottomLimit) {
            const remaining = allMedicines.length - (medIndex - 1);
            page.drawText(labels.moreMeds(remaining), {
                x: marginX,
                y: currentY,
                size: 10,
                font: helveticaFont,
                color: rgb(0.3, 0.3, 0.3),
            });
            break;
        }
        // Top line: index + medicine name (left), quantity badge (far right)
        const nameText = `${medIndex}.  ${med.medicineName}`;
        page.drawText(nameText, {
            x: marginX,
            y: currentY,
            size: 13,
            font: helveticaFontBold,
            color: rgb(0, 0, 0),
        });

        const quantityText = `${labels.quantityPrefix}${med.quantity}`;
        const quantitySize = 11;
        const quantityWidth = helveticaFontBold.widthOfTextAtSize(quantityText, quantitySize);
        page.drawText(quantityText, {
            x: width - rightMargin - quantityWidth,
            y: currentY,
            size: quantitySize,
            font: helveticaFontBold,
            color: rgb(0, 0, 0),
        });

        currentY -= 17;

        // Detail line: dosage, frequency and duration
        const detailsLine = `${med.dosage}  -  ${med.frequency}  -  ${labels.durationPrefix}${med.duration}`;
        page.drawText(detailsLine, {
            x: marginX + 16,
            y: currentY,
            size: 10,
            font: helveticaFont,
            color: rgb(0.3, 0.3, 0.3),
        });

        currentY -= 28;
        medIndex++;
    }
}

function calculateAge(birthDate: string): { years: number; months: number } {
    const birth = new Date(birthDate);
    const today = new Date();
    let years = today.getFullYear() - birth.getFullYear();
    let months = today.getMonth() - birth.getMonth();
    if (months < 0 || (months === 0 && today.getDate() < birth.getDate())) {
        years--;
        months += 12;
    }
    return { years, months };
}