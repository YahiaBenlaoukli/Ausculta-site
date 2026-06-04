import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Database from "better-sqlite3";
let db;
function initializeDatabase() {
  const dbPath = path.join(app.getPath("userData"), "cabinet-medicale.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  const version = db.pragma("user_version", { simple: true });
  if (version === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    address TEXT,
    phone_number TEXT,
    ssn TEXT UNIQUE,
    blood_type TEXT CHECK(blood_type IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', NULL)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS patient_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    file_category TEXT,
    local_path TEXT NOT NULL,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    );  
    `);
    db.pragma("user_version = 1");
  }
  return db;
}
function getDatabase() {
  if (!db) throw new Error("Database not initialized. Call initializeDatabase() first.");
  return db;
}
function mapRow(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    dateOfBirth: row.date_of_birth,
    address: row.address,
    phoneNumber: row.phone_number,
    ssn: row.ssn,
    bloodType: row.blood_type,
    createdAt: row.created_at
  };
}
async function addPatient(patient) {
  try {
    const db2 = getDatabase();
    const stmt = db2.prepare(`
        INSERT INTO patients (full_name, date_of_birth, address, phone_number, ssn, blood_type)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(patient.fullName, patient.dateOfBirth, patient.address, patient.phoneNumber, patient.ssn, patient.bloodType);
    return {
      ...patient,
      id: result.lastInsertRowid,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch (error) {
    console.log(error);
    throw error;
  }
}
async function getPatient(id) {
  try {
    const db2 = getDatabase();
    const stmt = db2.prepare(`
        SELECT * FROM patients WHERE id = ?
    `);
    const result = stmt.get(id);
    return mapRow(result);
  } catch (error) {
    console.log(error);
    throw error;
  }
}
async function getAllPatients() {
  try {
    const db2 = getDatabase();
    const stmt = db2.prepare(`
        SELECT * FROM patients
    `);
    const result = stmt.all();
    return result.map(mapRow);
  } catch (error) {
    console.log(error);
    throw error;
  }
}
async function updatePatient(patient) {
  try {
    const db2 = getDatabase();
    const stmt = db2.prepare(`
        UPDATE patients SET full_name = ?, date_of_birth = ?, address = ?, phone_number = ?, ssn = ?, blood_type = ? WHERE id = ?
    `);
    stmt.run(patient.fullName, patient.dateOfBirth, patient.address, patient.phoneNumber, patient.ssn, patient.bloodType, patient.id);
    return patient;
  } catch (error) {
    console.log(error);
    throw error;
  }
}
async function deletePatient(id) {
  try {
    const db2 = getDatabase();
    const stmt = db2.prepare(`
        DELETE FROM patients WHERE id = ?
    `);
    stmt.run(id);
  } catch (error) {
    console.log(error);
    throw error;
  }
}
async function searchPatients(query) {
  try {
    const db2 = getDatabase();
    const stmt = db2.prepare(`
        SELECT * FROM patients WHERE full_name LIKE ? OR ssn LIKE ?
    `);
    const result = stmt.all(`%${query}%`, `%${query}%`);
    return result.map(mapRow);
  } catch (error) {
    console.log(error);
    throw error;
  }
}
async function countPatients() {
  try {
    const db2 = getDatabase();
    const stmt = db2.prepare(`
        SELECT COUNT(*) as count FROM patients
    `);
    const result = stmt.get();
    return result.count;
  } catch (error) {
    console.log(error);
    throw error;
  }
}
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs")
    }
  });
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.whenReady().then(() => {
  initializeDatabase();
  ipcMain.handle("add-patient", async (_event, patient) => await addPatient(patient));
  ipcMain.handle("get-patient", async (_event, id) => await getPatient(id));
  ipcMain.handle("get-all-patients", async () => await getAllPatients());
  ipcMain.handle("update-patient", async (_event, patient) => await updatePatient(patient));
  ipcMain.handle("delete-patient", async (_event, id) => await deletePatient(id));
  ipcMain.handle("search-patients", async (_event, query) => await searchPatients(query));
  ipcMain.handle("count-patients", async () => await countPatients());
  createWindow();
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
