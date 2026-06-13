import { getDatabase } from "../db/db";
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { DoctorProfile, Prescription } from "../../types/doctor";

import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "src", "assets", "ordonnance", "template.pdf");
const PDF_OUTPUT_DIR = path.join(app.getPath("userData"), "prescriptions");

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

export function getDoctorProfileByUserId(userId: number) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`SELECT * FROM doctor_profile WHERE user_id = ?`);
        const row = stmt.get(userId) as Record<string, unknown> | undefined;
        if (!row) {
            return { status: "not_found", data: null };
        }
        const doctor = mapRowToDoctorProfile(row);
        return { status: "success", data: doctor };
    } catch (error) {
        console.error("getDoctorProfileByUserId error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

export async function setPrescriptionPdf(doctorId: number, pdfPath: string) {
    try {
        const db = getDatabase();

        // 1. Fetch the doctor profile
        const selectStmt = db.prepare(`SELECT * FROM doctor_profile WHERE id = ?`);
        const row = selectStmt.get(doctorId) as Record<string, unknown> | undefined;
        if (!row) {
            return { status: "fail", message: "Doctor profile not found" };
        }
        const doctor = mapRowToDoctorProfile(row);

        // 2. Fill the template PDF with doctor info
        const pdfResult = await fillTemplate(doctor);
        if (pdfResult.status === "fail") {
            return pdfResult;
        }

        // 3. Update the doctor_profile row with the saved PDF path
        const updateStmt = db.prepare(`UPDATE doctor_profile SET pdf_path = ? WHERE id = ?`);
        updateStmt.run(pdfResult.pdfPath, doctorId);

        // 4. Return the doctor with the attached PDF path
        doctor.pdfPath = pdfResult.pdfPath;

        return { status: "success", data: { doctor, pdfPath: pdfResult.pdfPath } };
    } catch (error) {
        console.error("setPrescriptionPdf error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

export function addPrescription(userId: number, patientId: number, medicineName: string, dosage: string, frequency: string, duration: string) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
            INSERT INTO prescriptions (user_id, patient_id, medicine_name, dosage, frequency, duration)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(userId, patientId, medicineName, dosage, frequency, duration);
        return { status: "success", data: result };
    } catch (error) {
        console.error("addPrescription error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

function getCenteredX(text: string, font: import("pdf-lib").PDFFont, fontSize: number, pageWidth: number): number {
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    return (pageWidth - textWidth) / 2;
}

async function fillTemplate(
    doctor: DoctorProfile
): Promise<{ status: "success"; pdfPath: string } | { status: "fail"; message: string }> {
    try {
        const existingPdfBytes = await fs.readFile(TEMPLATE_PATH);
        const pdfDoc = await PDFDocument.load(existingPdfBytes);

        const pages = pdfDoc.getPages();
        const firstPage = pages[0];
        const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const helveticaFontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const { width, height } = firstPage.getSize();

        const fullNameText = `Dr: ${doctor.fullName}`;
        firstPage.drawText(fullNameText, {
            x: getCenteredX(fullNameText, helveticaFontBold, 20, width),
            y: height - 54,
            size: 20,
            font: helveticaFontBold,
            color: rgb(0, 0, 0),
        });
        firstPage.drawText(doctor.speciality, {
            x: getCenteredX(doctor.speciality, helveticaFontBold, 13, width),
            y: height - 78,
            size: 13,
            font: helveticaFontBold,
            color: rgb(0, 0, 0),
        });
        firstPage.drawText(doctor.phoneNumber, {
            x: 91,
            y: height - 127,
            size: 10,
            font: helveticaFont,
            color: rgb(0, 0, 0),
        });
        firstPage.drawText(doctor.email, {
            x: 240,
            y: height - 127,
            size: 10,
            font: helveticaFont,
            color: rgb(0, 0, 0)
        })
        firstPage.drawText(doctor.address, {
            x: 412,
            y: height - 127,
            size: 10,
            font: helveticaFont,
            color: rgb(0, 0, 0),
        });

        const modifiedPdfBytes = await pdfDoc.save();

        // Save the filled PDF to disk
        await fs.mkdir(PDF_OUTPUT_DIR, { recursive: true });
        const outputFileName = `prescription_dr_${doctor.id}_${Date.now()}.pdf`;
        const outputPath = path.join(PDF_OUTPUT_DIR, outputFileName);
        await fs.writeFile(outputPath, modifiedPdfBytes);

        return { status: "success", pdfPath: outputPath };
    } catch (error) {
        return { status: "fail", message: error as string };
    }
}

export function getAllPrescriptions() {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`SELECT * FROM prescriptions`);
        const result = stmt.all();
        return { status: "success", data: result };
    } catch (error) {
        return { status: "fail", message: error as string };
    }
}

export function getPrescriptionById(id: number) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`SELECT * FROM prescriptions WHERE id = ?`);
        const result = stmt.get(id);
        return { status: "success", data: result };
    } catch (error) {
        return { status: "fail", message: error as string };
    }
}

export function updatePrescription(prescription: Prescription) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
            UPDATE prescriptions SET user_id = ?, patient_id = ?, medicine_name = ?, dosage = ?, frequency = ?, duration = ? WHERE id = ?
        `);
        const result = stmt.run(prescription.userId, prescription.patientId, prescription.medicineName, prescription.dosage, prescription.frequency, prescription.duration, prescription.id);
        return { status: "success", data: result };
    } catch (error) {
        return { status: "fail", message: error as string };
    }
}

export function deletePrescription(id: number) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`DELETE FROM prescriptions WHERE id = ?`);
        const result = stmt.run(id);
        return { status: "success", data: result };
    } catch (error) {
        return { status: "fail", message: error as string };
    }
}


export async function searchPrescription(query: string) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`SELECT * FROM prescriptions WHERE medicine_name LIKE ? OR dosage LIKE ? OR frequency LIKE ? OR duration LIKE ?`);
        const result = stmt.all(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
        return { status: "success", data: result };
    } catch (error) {
        return { status: "fail", message: error as string };
    }
}

export async function countPrescriptions() {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`SELECT COUNT(*) as count FROM prescriptions`);
        const result = stmt.get();
        return { status: "success", data: result.count };
    } catch (error) {
        return { status: "fail", message: error as string };
    }
}

