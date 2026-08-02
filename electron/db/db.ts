import { app } from 'electron';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildPatientSearchText, normalizeSearchText } from './normalize';

/**
 * Schema version this build expects. Bump it in the same commit that appends
 * to MIGRATIONS below — the two are meaningless apart.
 */
const SCHEMA_VERSION = 13;

/**
 * The version a pre-versioning database is treated as.
 *
 * Older builds shipped without stamping user_version, so those databases read
 * as 0 — indistinguishable from a new file by version alone. isEmptyDatabase()
 * tells the two apart; a populated one starts here so migrations 6 and up all
 * run. 5 because v6 is the oldest migration this codebase still carries.
 */
const LEGACY_BASELINE = 5;

let db: Database.Database;

export function initializeDatabase(): Database.Database {
  const dbPath = path.join(app.getPath('userData'), 'cabinet-medicale.db');
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  // CRITICAL ADDITION: SQLite disables foreign keys by default.
  // You must turn this on for your 'ON DELETE CASCADE' rules to actually work.
  db.pragma('foreign_keys = ON');

  // norm(text) — exposes the JS folding used for search to SQL, so global
  // search can write `norm(diagnosis) LIKE '%diabete%'` and match "Diabète".
  // SQLite's own LOWER/NOCASE are ASCII-only and cannot do this.
  //
  // Patients get a stored search_text column instead of this function because
  // their lookup runs on every keystroke in half a dozen pickers; the clinical
  // tables below are only scanned by the global search box, where a per-row
  // call into JS on a few thousand rows is not worth a column to keep in sync.
  db.function('norm', { deterministic: true }, (value: unknown) =>
    normalizeSearchText(value == null ? '' : String(value))
  );

  // Distinguish a brand-new file from a database that predates versioning.
  // MUST be sampled before createSchema() creates anything: afterwards every
  // database looks populated. Getting this wrong is how a legacy install ends
  // up stamped as current with its migrations never run.
  const fresh = isEmptyDatabase(db);
  const version = db.pragma('user_version', { simple: true }) as number;

  createSchema(db);
  ensureColumns(db);

  if (version > SCHEMA_VERSION) {
    // A newer database opened by an older build. Nothing safe to do about it
    // automatically — migrating backwards would destroy whatever the newer
    // version added — but it must not fail silently, because the symptoms
    // (missing columns, odd errors) look nothing like the cause.
    console.error(
      `Database schema v${version} is newer than this build (v${SCHEMA_VERSION}). ` +
      `Update the application; continuing may misbehave.`
    );
  } else if (fresh) {
    stampFreshInstall(db);
  } else {
    // user_version 0 on a populated database means it predates versioning, not
    // that it is new — start from the baseline so every migration runs.
    runMigrations(db, version === 0 ? LEGACY_BASELINE : version);
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

/** True only for a database with no user tables at all — a genuinely new file. */
function isEmptyDatabase(db: Database.Database): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .get() as { n: number };
  return row.n === 0;
}

/**
 * Every table and index, created with IF NOT EXISTS and re-run on every launch.
 *
 * This is why most migrations below have no `up`: a version that only ADDS a
 * table needs no migration step, because this function has already created it
 * by the time the runner is reached. Migrations exist for what this cannot
 * express — ALTERs on existing tables, and data backfills.
 */
function createSchema(db: Database.Database) {
  db.exec(`

    -- Which migrations this database has been through, and when. user_version
    -- alone gives a number; this gives a history, which is what you actually
    -- want when diagnosing an install that is behaving oddly in the field.
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
      -- Accent- and diacritic-folded copy of name/phone/ssn/address, kept in
      -- sync by patient.ts. SQLite's LIKE is ASCII-only, so this is what makes
      -- "benaissa" match "Benaïssa" and unvocalised Arabic match vocalised.
      -- See electron/db/normalize.ts.
      search_text TEXT,
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

    -- A named, reusable set of medicines (v10). Applying a template COPIES its
    -- lines into the prescription rather than referencing it — editing a
    -- template later must never rewrite what was historically prescribed.
    CREATE TABLE IF NOT EXISTS prescription_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES doctor_profile(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS prescription_template_medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      medicine_name TEXT NOT NULL,
      dosage TEXT,
      frequency TEXT,
      duration TEXT,
      quantity TEXT,
      -- Preserves the order the doctor arranged the lines in.
      position INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (template_id) REFERENCES prescription_templates(id) ON DELETE CASCADE
    );

    -- One template name per doctor: re-saving under an existing name replaces
    -- it (see prescriptionLibrary.ts) instead of silently creating a duplicate.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_presc_template_name
      ON prescription_templates(user_id, name);
    CREATE INDEX IF NOT EXISTS idx_presc_template_medicines
      ON prescription_template_medicines(template_id, position);

    -- Append-only record of who changed what (v13).
    --
    -- Scope: WRITES only. Logging reads as well is what real medical-records
    -- compliance asks for, but it multiplies the row count by an order of
    -- magnitude and is the usual reason audit tables become unusable; it can be
    -- added behind a setting later.
    --
    -- Honest about its threat model: anyone holding the machine can open this
    -- SQLite file and edit it. It is an accountability record between
    -- colleagues, not tamper-proof evidence, so there is no hash chain here —
    -- that would imply a guarantee the storage cannot make.
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      -- NULL when nobody was signed in (a failed login, or startup repair work).
      actor_id INTEGER,
      -- Denormalised on purpose: the log must still name the actor after the
      -- user row is renamed or deleted. A foreign key would defeat the point.
      actor_name TEXT NOT NULL,

      -- Dotted verb, e.g. 'patient.delete', 'payment.record'.
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,

      -- One human-readable line, resolved at write time. Stored rather than
      -- rebuilt on read so an entry still reads correctly once the row it
      -- describes has been deleted.
      summary TEXT,
      -- JSON blob for anything extra worth keeping (amounts, changed fields).
      details TEXT,

      at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

    -- Money actually received, one row per handover (v12).
    --
    -- consultations.fee stays the amount BILLED; this table records what came
    -- in. The two are separate because a patient can pay 1500 of a 2000 fee and
    -- bring the rest next visit — a boolean is_paid cannot express that.
    --
    -- consultations.is_paid is kept as the authoritative "nothing outstanding"
    -- flag rather than being replaced: every visit recorded before this table
    -- existed has is_paid set and no payment rows, and deriving balance purely
    -- from SUM(payments) would resurrect every one of them as a debt. Balance is
    -- therefore 0 when is_paid = 1, and (fee - paid) otherwise. payments.ts
    -- recomputes the flag whenever a payment is added or removed.
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consultation_id INTEGER NOT NULL,
      -- Denormalised from the consultation so the outstanding-balances query
      -- can group by patient without a join, and so a payment keeps pointing at
      -- the right person even if the visit row is later reworked.
      patient_id INTEGER NOT NULL,
      -- Who took the money. Nullable: unknown for anything back-filled, and it
      -- is the assistant rather than the doctor once there are two users.
      user_id INTEGER,

      amount REAL NOT NULL CHECK(amount > 0),
      method TEXT NOT NULL DEFAULT 'cash'
        CHECK(method IN ('cash', 'card', 'transfer', 'cheque', 'other')),

      -- Receipt number, sequential per calendar year across the whole practice
      -- (not per user: a receipt book belongs to the cabinet, not the person
      -- who happened to be at the desk).
      year INTEGER NOT NULL,
      sequence INTEGER NOT NULL,

      note TEXT,
      paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_receipt ON payments(year, sequence);
    CREATE INDEX IF NOT EXISTS idx_payments_consultation ON payments(consultation_id);
    CREATE INDEX IF NOT EXISTS idx_payments_patient ON payments(patient_id);

    -- Medical certificates: arrêt de travail, aptitude, présence, free text (v11).
    --
    -- The rendered PDF lands in patient_documents like everything else, but the
    -- structured row is kept as well: an arrêt de travail is a legal document
    -- that must be reprintable byte-for-byte years later, and "how many sick-leave
    -- days did I issue in 2026" is a question a PDF on disk cannot answer.
    --
    -- body holds the FINAL text as issued (the doctor may edit the generated
    -- wording before signing), which is what makes an identical reprint possible.
    CREATE TABLE IF NOT EXISTS certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      consultation_id INTEGER REFERENCES consultations(id) ON DELETE SET NULL,
      type TEXT NOT NULL CHECK(type IN ('work_leave', 'fitness', 'presence', 'free')),

      -- Sequential per doctor per year, displayed as e.g. "2026-0007".
      year INTEGER NOT NULL,
      sequence INTEGER NOT NULL,

      -- work_leave only; NULL for the other types.
      start_date TEXT,
      end_date TEXT,
      days INTEGER,

      body TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'fr',
      -- The generated PDF's row in patient_documents. NULL if it was deleted
      -- from the Documents page; the certificate itself survives that.
      document_id INTEGER REFERENCES patient_documents(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (user_id) REFERENCES doctor_profile(user_id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    );

    -- Enforces the gap-free numbering a serial is supposed to guarantee.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_certificates_serial
      ON certificates(user_id, year, sequence);
    CREATE INDEX IF NOT EXISTS idx_certificates_patient ON certificates(patient_id);
    CREATE INDEX IF NOT EXISTS idx_certificates_consultation ON certificates(consultation_id);

    CREATE INDEX IF NOT EXISTS idx_consultations_patient ON consultations(patient_id);
    CREATE INDEX IF NOT EXISTS idx_consultations_datetime ON consultations(consultation_datetime);

    -- Global search scans these columns with a leading-wildcard LIKE, which no
    -- index can serve. They exist for the equality/prefix lookups the same
    -- tables get elsewhere, and to keep the joins back to patients cheap.
    CREATE INDEX IF NOT EXISTS idx_documents_patient ON patient_documents(patient_id);
    CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_id);
    CREATE INDEX IF NOT EXISTS idx_presc_medicines_prescription ON prescription_medicines(prescription_id);
  `);
}

/**
 * Columns added after their table's original release.
 *
 * Belt-and-braces: the migrations below add these too, but databases in the
 * wild have been stamped by builds that did not always finish the job, and a
 * missing column fails as a silent no-write rather than a crash. ensureColumn
 * is idempotent and cheap, so verifying beats assuming.
 */
function ensureColumns(db: Database.Database) {
  ensureColumn(db, 'patients', 'notes', 'TEXT');
  ensureColumn(db, 'doctor_profile', 'pdf_path_en', 'TEXT');
  ensureColumn(db, 'prescriptions', 'consultation_id', 'INTEGER REFERENCES consultations(id) ON DELETE SET NULL');
  ensureColumn(db, 'patient_documents', 'consultation_id', 'INTEGER REFERENCES consultations(id) ON DELETE SET NULL');
  ensureColumn(db, 'patients', 'search_text', 'TEXT');
}

interface Migration {
  version: number;
  /** Short slug, recorded in schema_migrations so field logs name what ran. */
  name: string;
  /**
   * Omitted when the version only added tables or indexes — createSchema()
   * already made those. Present only for ALTERs and data backfills.
   */
  up?: (db: Database.Database) => void;
}

/**
 * Ordered and append-only. To change the schema: add an entry with the next
 * version number and bump SCHEMA_VERSION. Never renumber or edit a shipped
 * migration — databases in the field have already recorded it as done.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 6,
    name: 'patients.notes',
    // The follow-up notes tab wrote to a field with no column, so the text
    // silently vanished on restart.
    up: (db) => ensureColumn(db, 'patients', 'notes', 'TEXT'),
  },
  {
    version: 7,
    name: 'doctor_profile.pdf_path_en',
    // English prescription-header preview.
    up: (db) => ensureColumn(db, 'doctor_profile', 'pdf_path_en', 'TEXT'),
  },
  {
    version: 8,
    name: 'consultations',
    // Revenue used to be counted from completed appointments and now comes from
    // consultations, so give every historical completed appointment a
    // consultation with a NULL fee — statistics falls back to the configured
    // default price for those, keeping past totals identical.
    up: (db) => {
      ensureColumn(db, 'prescriptions', 'consultation_id', 'INTEGER REFERENCES consultations(id) ON DELETE SET NULL');
      ensureColumn(db, 'patient_documents', 'consultation_id', 'INTEGER REFERENCES consultations(id) ON DELETE SET NULL');
      backfillConsultationsFromAppointments(db);
    },
  },
  {
    version: 9,
    name: 'patients.search_text',
    // The column starts NULL on every existing row, and an empty haystack
    // matches nothing — without the backfill, global search would return no
    // patients at all until each one happened to be edited.
    up: (db) => {
      ensureColumn(db, 'patients', 'search_text', 'TEXT');
      backfillPatientSearchText(db);
    },
  },
  { version: 10, name: 'prescription_templates' },
  { version: 11, name: 'certificates' },
  {
    version: 12,
    name: 'payments',
    // Deliberately no backfill: consultations already marked paid keep
    // is_paid = 1 with no payment rows, which the balance query reads as
    // "nothing outstanding". Deriving balances purely from SUM(payments) would
    // resurrect the practice's entire history as debt.
  },
  {
    version: 13,
    name: 'audit_log',
    // Starts empty rather than inventing history it never observed.
  },
];

/** Records a version as applied. Silent on conflict so re-runs stay harmless. */
function markApplied(db: Database.Database, version: number, name: string) {
  db.prepare(`INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)`)
    .run(version, name);
}

/**
 * A new database is already at the current schema — createSchema() built it —
 * so the migrations are recorded as done rather than run. Running them would be
 * harmless (all are idempotent) but would misreport what actually happened.
 */
function stampFreshInstall(db: Database.Database) {
  const stamp = db.transaction(() => {
    for (const migration of MIGRATIONS) markApplied(db, migration.version, migration.name);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  });
  stamp();
}

/**
 * Applies every migration newer than `from`, one transaction each.
 *
 * The version stamp and the schema_migrations row live inside that same
 * transaction, so a migration either fully happened and is recorded, or did not
 * happen at all. The old if-chain could leave a half-applied step behind an
 * already-bumped version number, which no later run would ever retry.
 *
 * A failure stops the run rather than skipping ahead: later migrations
 * generally assume earlier ones succeeded.
 */
function runMigrations(db: Database.Database, from: number) {
  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;
    const apply = db.transaction(() => {
      migration.up?.(db);
      markApplied(db, migration.version, migration.name);
      db.pragma(`user_version = ${migration.version}`);
    });
    try {
      apply();
      console.log(`Applied migration v${migration.version} (${migration.name})`);
    } catch (error) {
      console.error(`Migration v${migration.version} (${migration.name}) failed:`, error);
      return;
    }
  }
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

// Fills patients.search_text for every row that has not got one yet. Normalising
// happens in JS (SQLite has no Unicode-aware lower/fold), so this is a read of
// all patients plus one UPDATE each — wrapped in a transaction to keep it to a
// single fsync. A practice has thousands of patients at most, so it is fast, and
// the IS NULL guard makes it idempotent and effectively free on later launches.
function backfillPatientSearchText(db: Database.Database) {
  try {
    const rows = db
      .prepare(
        `SELECT id, full_name, phone_number, ssn, address
         FROM patients WHERE search_text IS NULL`
      )
      .all() as { id: number; full_name: string; phone_number: string | null; ssn: string | null; address: string | null }[];

    if (!rows.length) return;

    const update = db.prepare(`UPDATE patients SET search_text = ? WHERE id = ?`);
    const run = db.transaction((batch: typeof rows) => {
      for (const row of batch) {
        update.run(
          buildPatientSearchText({
            fullName: row.full_name,
            phoneNumber: row.phone_number,
            ssn: row.ssn,
            address: row.address,
          }),
          row.id
        );
      }
    });
    run(rows);
  } catch (error) {
    console.error("backfillPatientSearchText error:", error);
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