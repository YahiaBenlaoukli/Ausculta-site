
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { initializeDatabase } from './db/db'
import { addPatient, getPatient, getAllPatients, updatePatient, deletePatient, searchPatients, countPatients, resetMedicalDatabase } from './services/patient'
import { uploadDocument, getDocumentsByPatientId, getAllDocuments, deleteDocument, openDocument } from './services/documents'
import { addPrescription, getPrescriptionById, getPatientPrescriptions, getAllPrescriptions, updatePrescription, deletePrescription, searchPrescription, countPrescriptions, createDoctorProfile, getDoctorProfileByUserId, updateDoctorProfile, setPrescriptionPdf, generatePatientPrescriptionPDF } from './services/prescription'
import { createUser, login, checkAuth, logout } from './services/auth'
import { bookAppointment, cancelAppointment, deleteAppointment, updateAppointment, getAppointmentsByDay, getAppointmentsByPatientId, getAppointmentsByDateRange } from './services/appointments'
import { getFinancialStatistics, getAppointmentStatistics, getConsultationStatistics, getNoShowRate, getConsultationVolume } from './services/statistics'
import { startConsultation, getConsultationById, getActiveConsultation, updateConsultation, completeConsultation, deleteConsultation, getConsultationArtifacts, getConsultationsByPatientId, getConsultationsByDay, getConsultationsByDateRange } from './services/consultations'
import { getTrialStatus, activateLicense } from './services/trial'

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
    icon: path.join(process.env.VITE_PUBLIC, 'logo.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // External links (target="_blank" / window.open) go to the default browser,
  // never a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
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
  ipcMain.handle('reset-database', async () => await resetMedicalDatabase());

  //gestion des documents
  ipcMain.handle('get-documents-by-patient-id', async (_event, patientId) => getDocumentsByPatientId(patientId));
  ipcMain.handle('get-all-documents', async () => getAllDocuments());
  ipcMain.handle('upload-document', async (_event, document) => await uploadDocument(document));
  ipcMain.handle('delete-document', async (_event, id) => deleteDocument(id));
  ipcMain.handle('open-document', async (_event, path) => await openDocument(path));

  //gestion profil médecin
  ipcMain.handle('create-doctor-profile', async (_event, userId, fullName, speciality, phoneNumber, address, email) => await createDoctorProfile(userId, fullName, speciality, phoneNumber, address, email));
  ipcMain.handle('get-doctor-profile', async (_event, userId) => getDoctorProfileByUserId(userId));
  ipcMain.handle('update-doctor-profile', async (_event, userId, fullName, speciality, phoneNumber, address, email) => await updateDoctorProfile(userId, fullName, speciality, phoneNumber, address, email));
  ipcMain.handle('set-prescription-pdf', async (_event, doctorId) => await setPrescriptionPdf(doctorId));

  //gestion des prescriptions 
  ipcMain.handle('add-prescription', async (_event, userId, patientId, medicines, notes, consultationId) => await addPrescription(userId, patientId, medicines, notes, consultationId));
  ipcMain.handle('get-prescription-by-id', async (_event, id, patientId) => getPrescriptionById(id, patientId));
  ipcMain.handle('get-patient-prescriptions', async (_event, patientId) => getPatientPrescriptions(patientId));
  ipcMain.handle('get-all-prescriptions', async () => await getAllPrescriptions());
  ipcMain.handle('update-prescription', async (_event, prescription) => await updatePrescription(prescription));
  ipcMain.handle('delete-prescription', async (_event, id) => await deletePrescription(id));
  ipcMain.handle('search-prescriptions', async (_event, query) => await searchPrescription(query));
  ipcMain.handle('count-prescriptions', async () => await countPrescriptions());
  ipcMain.handle('generate-patient-prescription-pdf', async (_event, patientId, prescriptions, doctor, weight, language, consultationId) => await generatePatientPrescriptionPDF(patientId, prescriptions, doctor, weight, language, consultationId));

  //gestion authentification
  ipcMain.handle('create-user', async (_event, user) => await createUser(user));
  ipcMain.handle('login', async (_event, fullName, password, stayLogged) => login(fullName, password, stayLogged));
  ipcMain.handle('check-auth', async () => checkAuth());
  ipcMain.handle('logout', async () => logout());

  //gestion des rendez-vous
  ipcMain.handle('book-appointment', async (_event, patientId, doctorId, datetime, duration, reason) => bookAppointment(patientId, doctorId, datetime, duration, reason));
  ipcMain.handle('cancel-appointment', async (_event, id) => cancelAppointment(id));
  ipcMain.handle('delete-appointment', async (_event, id) => deleteAppointment(id));
  ipcMain.handle('update-appointment', async (_event, id, status) => updateAppointment(id, status));
  ipcMain.handle('get-appointments-by-day', async (_event, doctorId, date) => getAppointmentsByDay(doctorId, date));
  ipcMain.handle('get-appointments-by-patient-id', async (_event, patientId) => getAppointmentsByPatientId(patientId));
  ipcMain.handle('get-appointments-by-date-range', async (_event, doctorId, startDate, endDate) => getAppointmentsByDateRange(doctorId, startDate, endDate));

  //gestion des consultations
  ipcMain.handle('start-consultation', async (_event, patientId, doctorId, appointmentId) => startConsultation(patientId, doctorId, appointmentId));
  ipcMain.handle('get-consultation-by-id', async (_event, id) => getConsultationById(id));
  ipcMain.handle('get-active-consultation', async (_event, doctorId) => getActiveConsultation(doctorId));
  ipcMain.handle('update-consultation', async (_event, id, draft) => updateConsultation(id, draft));
  ipcMain.handle('complete-consultation', async (_event, id, draft) => completeConsultation(id, draft));
  ipcMain.handle('delete-consultation', async (_event, id) => deleteConsultation(id));
  ipcMain.handle('get-consultation-artifacts', async (_event, consultationId) => getConsultationArtifacts(consultationId));
  ipcMain.handle('get-consultations-by-patient-id', async (_event, patientId) => getConsultationsByPatientId(patientId));
  ipcMain.handle('get-consultations-by-day', async (_event, doctorId, date) => getConsultationsByDay(doctorId, date));
  ipcMain.handle('get-consultations-by-date-range', async (_event, doctorId, startDate, endDate) => getConsultationsByDateRange(doctorId, startDate, endDate));

  //gestion des statistiques
  ipcMain.handle('get-financial-statistics', async (_event, startDate, endDate, appointmentPrice) => getFinancialStatistics(startDate, endDate, appointmentPrice));
  ipcMain.handle('get-consultation-statistics', async (_event, startDate, endDate, defaultFee) => getConsultationStatistics(startDate, endDate, defaultFee));
  ipcMain.handle('get-appointment-statistics', async (_event, startDate, endDate, appointmentPrice) => getAppointmentStatistics(startDate, endDate, appointmentPrice));
  ipcMain.handle('get-noshow-rate', async (_event, startDate, endDate) => getNoShowRate(startDate, endDate));
  ipcMain.handle('get-consultation-volume', async (_event, startDate, endDate) => getConsultationVolume(startDate, endDate));

  //gestion de la licence / période d'essai
  ipcMain.handle('get-trial-status', async () => getTrialStatus());
  ipcMain.handle('activate-license', async (_event, key) => activateLicense(key));

  createWindow();
})
