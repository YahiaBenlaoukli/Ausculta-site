import { app } from 'electron';
import path from 'node:path';
import Database from 'better-sqlite3';

let db: Database.Database;

export function initializeDatabase(): Database.Database {
  const dbPath = path.join(app.getPath('userData'), 'cabinet-medicale.db');
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  // CRITICAL ADDITION: SQLite disables foreign keys by default. 
  // You must turn this on for your 'ON DELETE CASCADE' rules to actually work.
  db.pragma('foreign_keys = ON');

  const version = db.pragma('user_version', { simple: true }) as number;

  // I have reordered the tables slightly so that parent tables 
  // are created before the child tables that reference them.
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      address TEXT,
      phone_number TEXT,
      ssn TEXT UNIQUE,
      blood_type TEXT CHECK(blood_type IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', NULL)),
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS doctor_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      email TEXT,
      phone_number TEXT,
      address TEXT,
      speciality TEXT,
      has_completed_profile INTEGER DEFAULT 0,
      pdf_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 1. THE PRESCRIPTION HEADER
    -- Represents the event of prescribing.
    CREATE TABLE IF NOT EXISTS prescriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, -- The doctor who issued it
      patient_id INTEGER NOT NULL,
      notes TEXT, -- ADDED: Useful for general advice (e.g., "Drink plenty of water")
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES doctor_profile(user_id),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    );

    -- 2. THE MEDICINES LIST (Line Items)
    -- Links multiple medicines to a single prescription_id.
    CREATE TABLE IF NOT EXISTS prescription_medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prescription_id INTEGER NOT NULL,
      medicine_name TEXT NOT NULL,
      dosage TEXT,
      frequency TEXT,
      duration TEXT,
      quantity TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (prescription_id) REFERENCES prescriptions(id) ON DELETE CASCADE
    );

    -- 3. THE DOCUMENTS
    -- Stays mostly as is, but conceptually its prescription_id now 
    -- perfectly links back to the new prescription header.
    CREATE TABLE IF NOT EXISTS patient_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      prescription_id INTEGER,
      file_name TEXT NOT NULL,
      file_category TEXT,
      local_path TEXT NOT NULL,
      upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (prescription_id) REFERENCES prescriptions(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      
      -- Store as ISO8601 string (e.g., '2026-06-21T14:30:00') for easy sorting
      appointment_datetime TEXT NOT NULL, 
      
      -- Standardize how long the slot takes to block out the calendar
      duration_minutes INTEGER DEFAULT 30, 
      
      -- Why is the patient visiting?
      reason TEXT, 
      
      -- The status is locked to these 4 specific states to prevent typos
      status TEXT DEFAULT 'Scheduled' CHECK(status IN ('Scheduled', 'Completed', 'Cancelled', 'No-Show')),
      
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES doctor_profile(id) ON DELETE CASCADE
    );
  `);

  // Safety net: guarantee patients.notes exists regardless of how (or whether)
  // user_version was stamped by older builds. An unversioned legacy DB reads as
  // version 0 and would be treated as a "fresh install" below, skipping the v6
  // migration — so the follow-up notes tab would silently fail to persist.
  try {
    const hasNotes = db
      .prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('patients') WHERE name = 'notes'`)
      .get() as { n: number };
    if (!hasNotes.n) db.exec(`ALTER TABLE patients ADD COLUMN notes TEXT`);
  } catch (error) {
    console.error("ensure patients.notes column:", error);
  }

  // If this is a fresh install, set it to the newest version (6)
  if (version === 0) {
    db.pragma('user_version = 6');
  }

  // v6: patients.notes — the follow-up notes tab used to write a field that
  // had no column, so the text silently vanished on restart.
  if (version > 0 && version < 6) {
    try {
      db.exec(`ALTER TABLE patients ADD COLUMN notes TEXT`);
    } catch (error) {
      // Column already exists (e.g. fresh table created above) — fine.
      console.error("patients.notes migration:", error);
    }
    db.pragma('user_version = 6');
  }

  // Run auto-linking for prescriptions that have PDFs but were created before the foreign key link was implemented
  try {
    db.exec(`
      UPDATE patient_documents
      SET prescription_id = (
        SELECT p.id 
        FROM prescriptions p 
        WHERE p.patient_id = patient_documents.patient_id
          AND abs(strftime('%s', p.created_at) - strftime('%s', patient_documents.upload_date)) < 60
        LIMIT 1
      )
      WHERE prescription_id IS NULL AND file_category = 'prescription';
    `);
  } catch (error) {
    console.error("Failed to auto-link existing prescriptions to documents:", error);
  }
  syncMissedAppointments();
  return db;
}

function syncMissedAppointments() {
  try {
    const db = getDatabase();
    // Appointments are stored as timezone-naive LOCAL strings
    // ('YYYY-MM-DDTHH:MM:SS'), so compare against local time in the same
    // format — toISOString() would be UTC and off by the timezone offset.
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const localNow = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const stmt = db.prepare(`UPDATE appointments SET status = 'No-Show' WHERE appointment_datetime < ? AND status = 'Scheduled'`);
    const result = stmt.run(localNow);
    return result;
  } catch (error) {
    console.error("syncMissedAppointments error:", error);
    return { status: "fail", message: (error as Error).message };
  }
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initializeDatabase() first.');
  return db;
}