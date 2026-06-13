import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { initializeDatabase } from './db/db'
import { addPatient, getPatient, getAllPatients, updatePatient, deletePatient, searchPatients, countPatients } from './services/patient'
import { uploadDocument, getDocumentsByPatientId, deleteDocument, openDocument } from './services/documents'
import { addPrescription, getPrescriptionById, getAllPrescriptions, updatePrescription, deletePrescription, searchPrescription, countPrescriptions, createDoctorProfile, getDoctorProfileByUserId, setPrescriptionPdf } from './services/prescription'
import { createUser, login, checkAuth, logout } from './services/auth'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  initializeDatabase();
  ipcMain.handle('add-patient', async (_event, patient) => await addPatient(patient));
  ipcMain.handle('get-patient-by-id', async (_event, id) => await getPatient(id));
  ipcMain.handle('get-all-patients', async () => await getAllPatients());
  ipcMain.handle('update-patient', async (_event, patient) => await updatePatient(patient));
  ipcMain.handle('delete-patient', async (_event, id) => await deletePatient(id));
  ipcMain.handle('search-patients', async (_event, query) => await searchPatients(query));
  ipcMain.handle('count-patients', async () => await countPatients());
  //gestion des documents
  ipcMain.handle('get-documents-by-patient-id', async (_event, patientId) => getDocumentsByPatientId(patientId));
  ipcMain.handle('upload-document', async (_event, document) => await uploadDocument(document));
  ipcMain.handle('delete-document', async (_event, id) => deleteDocument(id));
  ipcMain.handle('open-document', async (_event, path) => await openDocument(path));
  //gestion profil médecin
  ipcMain.handle('create-doctor-profile', async (_event, userId, fullName, speciality, phoneNumber, address, email) => await createDoctorProfile(userId, fullName, speciality, phoneNumber, address, email));
  ipcMain.handle('get-doctor-profile', async (_event, userId) => getDoctorProfileByUserId(userId));
  ipcMain.handle('set-prescription-pdf', async (_event, doctorId, pdfPath) => await setPrescriptionPdf(doctorId, pdfPath));
  //gestion des prescriptions
  ipcMain.handle('add-prescription', async (_event, userId, patientId, medicineName, dosage, frequency, duration) => await addPrescription(userId, patientId, medicineName, dosage, frequency, duration));
  ipcMain.handle('get-prescription-by-id', async (_event, id) => await getPrescriptionById(id));
  ipcMain.handle('get-all-prescriptions', async () => await getAllPrescriptions());
  ipcMain.handle('update-prescription', async (_event, prescription) => await updatePrescription(prescription));
  ipcMain.handle('delete-prescription', async (_event, id) => await deletePrescription(id));
  ipcMain.handle('search-prescriptions', async (_event, query) => await searchPrescription(query));
  ipcMain.handle('count-prescriptions', async () => await countPrescriptions());
  //gestion authentification
  ipcMain.handle('create-user', async (_event, user) => await createUser(user));
  ipcMain.handle('login', async (_event, phoneNumber, password, stayLogged) => login(phoneNumber, password, stayLogged));
  ipcMain.handle('check-auth', async () => checkAuth());
  ipcMain.handle('logout', async () => logout());
  createWindow();
})
