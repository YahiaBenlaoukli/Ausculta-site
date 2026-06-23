import { getDatabase } from "../db/db";
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import type { DoctorProfile, Prescription } from "../../types/doctor";

import { uploadDocument, getDocumentsByPatientId } from "./documents";


import { fileURLToPath } from "node:url";
import type { Patient } from "../../types/patient";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "src", "assets", "ordonnance", "template.pdf");
const PDF_OUTPUT_DIR = path.join(app.getPath("userData"), "prescriptions");
const PATIENTS_PDF_DIR = path.join(app.getPath('userData'), 'records', 'Gestion-cabinet-medicale');

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

export function addPrescription(userId: number, patientId: number, medicines: { medicineName: string; dosage: string; frequency: string; quantity: string; duration: string }[], notes?: string) {
    try {
        const db = getDatabase();
        const insertPrescription = db.prepare(`
            INSERT INTO prescriptions (user_id, patient_id, notes)
            VALUES (?, ?, ?)
        `);
        const insertMedicine = db.prepare(`
            INSERT INTO prescription_medicines (prescription_id, medicine_name, dosage, frequency, duration, quantity)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        const transaction = db.transaction(() => {
            const result = insertPrescription.run(userId, patientId, notes || null);
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

// Helper: hydrate a prescription row with its medicines
function hydratePrescription(db: ReturnType<typeof getDatabase>, prescriptionRow: Record<string, unknown>): Prescription {
    const medicinesStmt = db.prepare(`SELECT * FROM prescription_medicines WHERE prescription_id = ? ORDER BY id`);
    const medicineRows = medicinesStmt.all(prescriptionRow.id as number) as Record<string, unknown>[];
    return {
        id: prescriptionRow.id as number,
        userId: prescriptionRow.user_id as number,
        patientId: prescriptionRow.patient_id as number,
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
            WHERE pm.medicine_name LIKE ? OR pm.dosage LIKE ? OR pm.frequency LIKE ? OR pm.duration LIKE ? OR p.notes LIKE ?
            ORDER BY p.created_at DESC
        `);
        const rows = stmt.all(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`) as Record<string, unknown>[];
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

export async function generatePatientPrescriptionPDF(patientId: number, prescriptions: Prescription[], doctor: DoctorProfile, weight?: string) {
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
        const pdfResult = await fillPatientPrescriptionTemplate(patient, prescriptions, doctor, weight, prescriptionId);
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
    weight?: string,
    prescriptionId?: number
): Promise<{ status: "success"; pdfPath: string } | { status: "fail"; message: string }> {
    try {
        const existingPdfBytes = await fs.readFile(doctor.pdfPath!);
        const pdfDoc = await PDFDocument.load(existingPdfBytes);
        const pages = pdfDoc.getPages();
        const firstPage = pages[0];
        const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const helveticaFontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const { width, height } = firstPage.getSize();

        drawPatientInformation(firstPage, patient, helveticaFontBold, helveticaFont, width, height, weight);
        drawPrescriptions(firstPage, prescriptions, helveticaFontBold, helveticaFont, width, height);

        const modifiedPdfBytes = await pdfDoc.save();

        await fs.mkdir(PATIENTS_PDF_DIR, { recursive: true });
        const outputFileName = `prescription_patient_${patient.id}_${Date.now()}.pdf`;
        const outputPath = path.join(PATIENTS_PDF_DIR, outputFileName);
        await fs.writeFile(outputPath, modifiedPdfBytes);

        await uploadDocument({
            patientId: patient.id,
            prescriptionId: prescriptionId ?? null,
            fileCategory: "prescription",
            localPath: outputPath,
            fileName: outputFileName,
        });

        return { status: "success", pdfPath: outputPath };
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    }
}

function drawPatientInformation(page: PDFPage, patient: Patient, helveticaFontBold: PDFFont, helveticaFont: PDFFont, _width: number, height: number, weight?: string) {
    const dayOfConsultationText = new Date().toLocaleDateString('en-GB');
    page.drawText(dayOfConsultationText, {
        x: 67,
        y: height - 207,
        size: 10,
        font: helveticaFontBold,
        color: rgb(0, 0, 0),
    });
    page.drawText(patient.fullName, {
        x: 434,
        y: height - 207,
        size: 10,
        font: helveticaFont,
        color: rgb(0, 0, 0),
    });
    page.drawText(patient.dateOfBirth, {
        x: 486,
        y: height - 238,
        size: 10,
        font: helveticaFontBold,
        color: rgb(0, 0, 0),
    });
    const ageText = `${calculateAge(patient.dateOfBirth).years} ans`;
    page.drawText(ageText, {
        x: 400,
        y: height - 269,
        size: 10,
        font: helveticaFontBold,
        color: rgb(0, 0, 0),
    });
    if (weight) {
        page.drawText(weight, {
            x: 500,
            y: height - 269,
            size: 10,
            font: helveticaFontBold,
            color: rgb(0, 0, 0),
        });
    }
}

function drawPrescriptions(page: PDFPage, prescriptions: Prescription[], helveticaFontBold: PDFFont, helveticaFont: PDFFont, _width: number, height: number) {
    const startX = 30;
    let currentY = height - 315;
    const lineSpacing = 15;
    const prescriptionSpacing = 30;

    let medIndex = 1;
    for (const prescription of prescriptions) {
        for (const med of prescription.medicines) {
            const numberPrefix = `${medIndex}. `;
            const medicineLine = `${numberPrefix}${med.medicineName}  —  ${med.dosage}`;

            page.drawText(medicineLine, {
                x: startX,
                y: currentY,
                size: 11,
                font: helveticaFontBold,
                color: rgb(0, 0, 0),
            });
            currentY -= lineSpacing;

            const detailsLine = `${med.frequency} | Qté: ${med.quantity} | Durée: ${med.duration}`;
            page.drawText(detailsLine, {
                x: startX + 20,
                y: currentY,
                size: 9,
                font: helveticaFont,
                color: rgb(0.25, 0.25, 0.25),
            });
            currentY -= prescriptionSpacing;
            medIndex++;
        }
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