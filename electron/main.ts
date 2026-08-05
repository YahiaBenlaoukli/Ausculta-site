
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
import { initializeUpdater, getUpdateStatus, checkForUpdates, downloadUpdate, quitAndInstall } from './services/updater'
import { globalSearch } from './services/search'
import { suggestMedicines, getPrescriptionTemplates, savePrescriptionTemplate, deletePrescriptionTemplate } from './services/prescriptionLibrary'
import { createCertificate, getCertificatesByPatientId, getCertificatesByConsultationId, reprintCertificate, deleteCertificate, getCertificateStatistics } from './services/certificates'
import { recordPayment, getPaymentsByConsultationId, deletePayment, getConsultationBalance, getOutstandingBalances, generateReceiptPdf } from './services/payments'
import { getAuditLog, getAuditLogForEntity } from './services/audit'

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

  //recherche globale
  ipcMain.handle('global-search', async (_event, query) => globalSearch(query));

  //gestion des documents
  ipcMain.handle('get-documents-by-patient-id', async (_event, patientId) => getDocumentsByPatientId(patientId));
  ipcMain.handle('get-all-documents', async () => getAllDocuments());
  ipcMain.handle('upload-document', async (_event, document) => await uploadDocument(document));
  ipcMain.handle('delete-document', async (_event, id) => deleteDocument(id));
  ipcMain.handle('open-document', async (_event, path) => await openDocument(path));

  //gestion profil médecin
  ipcMain.handle('create-doctor-profile', async (_event, userId, fullName, speciality, phoneNumber, address, email) => await createDoctorProfile(userId, fullName, speciality, phoneNumber, address, email));
  ipcMain.handle('get-doctor-profile', async (_event, userId) => getDoctorProfileByUserId(userId));
  ipcMain.handle('update-doctor-profile', async (_event, userId, input) => await updateDoctorProfile(userId, input));
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

  //bibliothèque d'ordonnances (suggestions + modèles)
  ipcMain.handle('suggest-medicines', async (_event, query, limit) => suggestMedicines(query, limit));
  ipcMain.handle('get-prescription-templates', async (_event, userId) => getPrescriptionTemplates(userId));
  ipcMain.handle('save-prescription-template', async (_event, userId, name, medicines, notes) => savePrescriptionTemplate(userId, name, medicines, notes));
  ipcMain.handle('delete-prescription-template', async (_event, id) => deletePrescriptionTemplate(id));

  //gestion des certificats médicaux
  ipcMain.handle('create-certificate', async (_event, userId, draft) => await createCertificate(userId, draft));
  ipcMain.handle('get-certificates-by-patient-id', async (_event, patientId) => getCertificatesByPatientId(patientId));
  ipcMain.handle('get-certificates-by-consultation-id', async (_event, consultationId) => getCertificatesByConsultationId(consultationId));
  ipcMain.handle('reprint-certificate', async (_event, id) => await reprintCertificate(id));
  ipcMain.handle('delete-certificate', async (_event, id) => deleteCertificate(id));
  ipcMain.handle('get-certificate-statistics', async (_event, userId, year) => getCertificateStatistics(userId, year));

  //gestion des paiements et des impayés
  ipcMain.handle('record-payment', async (_event, draft, userId, defaultFee) => recordPayment(draft, userId, defaultFee));
  ipcMain.handle('get-payments-by-consultation-id', async (_event, consultationId) => getPaymentsByConsultationId(consultationId));
  ipcMain.handle('delete-payment', async (_event, id, defaultFee) => deletePayment(id, defaultFee));
  ipcMain.handle('get-consultation-balance', async (_event, consultationId, defaultFee) => getConsultationBalance(consultationId, defaultFee));
  ipcMain.handle('get-outstanding-balances', async (_event, defaultFee) => getOutstandingBalances(defaultFee));
  ipcMain.handle('generate-receipt-pdf', async (_event, paymentId, language, defaultFee) => await generateReceiptPdf(paymentId, language, defaultFee));

  //journal d'activité (audit)
  // Read-only on purpose: there is no delete-audit-entry channel, and adding
  // one would defeat the point of the table.
  ipcMain.handle('get-audit-log', async (_event, query) => getAuditLog(query));
  ipcMain.handle('get-audit-log-for-entity', async (_event, entityType, entityId) => getAuditLogForEntity(entityType, entityId));
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

  //gestion des mises à jour
  ipcMain.handle('get-update-status', async () => getUpdateStatus());
  ipcMain.handle('check-for-updates', async () => checkForUpdates());
  ipcMain.handle('download-update', async () => downloadUpdate());
  ipcMain.handle('quit-and-install', async () => quitAndInstall());

  createWindow();

  // Needs the window: update progress is pushed to the renderer over IPC.
  if (win) initializeUpdater(win);
})
