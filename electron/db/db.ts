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
      pdf_path_en TEXT,
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
      -- Set when the prescription was written during a consultation. SQLite
      -- resolves foreign keys at DML time, so referencing the consultations
      -- table before it is declared below is fine.
      consultation_id INTEGER REFERENCES consultations(id) ON DELETE SET NULL,
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
      consultation_id INTEGER REFERENCES consultations(id) ON DELETE SET NULL,
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

    -- THE CONSULTATION (the visit that actually happened)
    -- Separate from appointments on purpose: an appointment is the *intent* to
    -- see a patient (and can be cancelled or no-showed), a consultation is the
    -- encounter itself. A walk-in has a consultation with no appointment.
    -- Must be created after the appointments table: it references it.
    CREATE TABLE IF NOT EXISTS consultations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,

      -- NULL for a walk-in; set when the visit came from the calendar.
      appointment_id INTEGER,

      -- Same timezone-naive local format as appointment_datetime.
      consultation_datetime TEXT NOT NULL,
      is_walk_in INTEGER DEFAULT 0,
      reason TEXT,

      -- Vitals. blood_pressure is text because "120/80" is not two numbers.
      weight REAL,
      height REAL,
      temperature REAL,
      blood_pressure TEXT,
      heart_rate INTEGER,

      exam_notes TEXT,
      diagnosis TEXT,
      treatment_plan TEXT,
      follow_up_notes TEXT,

      -- NULL fee means "bill at the practice default" (see statistics.ts).
      fee REAL,
      is_paid INTEGER DEFAULT 1,

      -- 'InProgress' is a draft opened while the patient is in the room, so
      -- prescriptions and documents created mid-visit can be linked to it.
      status TEXT DEFAULT 'InProgress' CHECK(status IN ('InProgress', 'Completed')),

      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES doctor_profile(id) ON DELETE CASCADE,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_consultations_patient ON consultations(patient_id);
    CREATE INDEX IF NOT EXISTS idx_consultations_datetime ON consultations(consultation_datetime);
  `);

  // Safety net for columns added after the initial release: guarantee they
  // exist regardless of how (or whether) user_version was stamped by older
  // builds. An unversioned legacy DB reads as version 0 and would be treated as
  // a "fresh install" below, skipping its migration — so a feature writing to
  // one of these columns would silently fail to persist.
  ensureColumn(db, 'patients', 'notes', 'TEXT');
  ensureColumn(db, 'doctor_profile', 'pdf_path_en', 'TEXT');
  // v8 — link a prescription / document back to the visit that produced it.
  ensureColumn(db, 'prescriptions', 'consultation_id', 'INTEGER REFERENCES consultations(id) ON DELETE SET NULL');
  ensureColumn(db, 'patient_documents', 'consultation_id', 'INTEGER REFERENCES consultations(id) ON DELETE SET NULL');

  // If this is a fresh install, set it to the newest version (8). An
  // unversioned legacy DB also lands here, so run the consultation backfill —
  // on a genuinely fresh install there are no appointments and it is a no-op.
  if (version === 0) {
    backfillConsultationsFromAppointments(db);
    db.pragma('user_version = 8');
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

  // v7: doctor_profile.pdf_path_en — the English prescription-header preview.
  // The column is added above by the safety net; here we just stamp the version.
  if (version > 0 && version < 7) {
    db.pragma('user_version = 7');
  }

  // v8: consultations. Revenue used to be counted from completed appointments;
  // it now comes from consultations, so give every historical completed
  // appointment a consultation with a NULL fee — statistics falls back to the
  // configured default price for those, keeping past totals identical.
  if (version > 0 && version < 8) {
    backfillConsultationsFromAppointments(db);
    db.pragma('user_version = 8');
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
  discardAbandonedConsultations();
  return db;
}

// Adds a column only when it is missing. `ALTER TABLE ... ADD COLUMN` throws if
// the column already exists, and SQLite has no `IF NOT EXISTS` for columns.
function ensureColumn(db: Database.Database, table: string, column: string, definition: string) {
  try {
    const existing = db
      .prepare(`SELECT COUNT(*) AS n FROM pragma_table_info(?) WHERE name = ?`)
      .get(table, column) as { n: number };
    if (!existing.n) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    console.error(`ensure ${table}.${column} column:`, error);
  }
}

// Gives every historical completed appointment the consultation row that the
// statistics module now bills from. The NOT EXISTS guard makes it idempotent,
// and the NULL fee means those visits bill at the configured default price —
// so revenue totals are unchanged by the migration.
function backfillConsultationsFromAppointments(db: Database.Database) {
  try {
    db.exec(`
      INSERT INTO consultations (
        patient_id, doctor_id, appointment_id, consultation_datetime,
        is_walk_in, reason, status, created_at
      )
      SELECT a.patient_id, a.doctor_id, a.id, a.appointment_datetime,
             0, a.reason, 'Completed', a.created_at
      FROM appointments a
      WHERE a.status = 'Completed'
        AND NOT EXISTS (SELECT 1 FROM consultations c WHERE c.appointment_id = a.id);
    `);
  } catch (error) {
    console.error("backfillConsultationsFromAppointments error:", error);
  }
}

// A consultation is created as an 'InProgress' draft the moment the doctor
// opens the page, so anything produced during the visit can be linked to it.
// Drafts the doctor walked away from would otherwise pile up forever, so drop
// the ones older than a day that never got any clinical content or artefacts.
function discardAbandonedConsultations() {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      DELETE FROM consultations
      WHERE status = 'InProgress'
        AND datetime(created_at) < datetime('now', '-1 day')
        AND COALESCE(reason, '') = ''
        AND COALESCE(exam_notes, '') = ''
        AND COALESCE(diagnosis, '') = ''
        AND COALESCE(treatment_plan, '') = ''
        AND COALESCE(follow_up_notes, '') = ''
        AND weight IS NULL AND height IS NULL AND temperature IS NULL
        AND blood_pressure IS NULL AND heart_rate IS NULL
        AND NOT EXISTS (SELECT 1 FROM prescriptions p WHERE p.consultation_id = consultations.id)
        AND NOT EXISTS (SELECT 1 FROM patient_documents d WHERE d.consultation_id = consultations.id)
    `);
    return stmt.run();
  } catch (error) {
    console.error("discardAbandonedConsultations error:", error);
    return { status: "fail", message: (error as Error).message };
  }
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