import { ipcRenderer, contextBridge } from 'electron'
import type { Patient } from '../types/patient'
import type { Prescription } from '../types/doctor'
import type { DoctorProfile, DoctorProfileInput, MedicineLine } from '../types/doctor'
import { PatientDocument } from '../types/documents'
import type { ConsultationDraft } from '../types/consultation'
import type { CertificateDraft } from '../types/certificate'
import type { PaymentDraft } from '../types/payment'
import type { AuditQuery } from '../types/audit'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  //gestion patient
  getAllPatients: () => ipcRenderer.invoke('get-all-patients'),
  addPatient: (patient: Patient) => ipcRenderer.invoke('add-patient', patient),
  updatePatient: (patient: Patient) => ipcRenderer.invoke('update-patient', patient),
  deletePatient: (id: number) => ipcRenderer.invoke('delete-patient', id),
  getPatientById: (id: number) => ipcRenderer.invoke('get-patient-by-id', id),
  searchPatient: (query: string) => ipcRenderer.invoke('search-patients', query),
  countPatients: () => ipcRenderer.invoke('count-patients'),
  resetDatabase: () => ipcRenderer.invoke('reset-database'),

  //recherche globale
  globalSearch: (query: string) => ipcRenderer.invoke('global-search', query),


  //gestion documents
  uploadDocument: (document: Omit<PatientDocument, 'id' | 'uploadDate'>) => ipcRenderer.invoke('upload-document', document),
  getDocumentsByPatientId: (patientId: number) => ipcRenderer.invoke('get-documents-by-patient-id', patientId),
  getAllDocuments: () => ipcRenderer.invoke('get-all-documents'),
  deleteDocument: (id: number) => ipcRenderer.invoke('delete-document', id),
  openDocument: (path: string) => ipcRenderer.invoke('open-document', path),
  //gestion profil médecin
  createDoctorProfile: (userId: number, fullName: string, speciality: string, phoneNumber: string, address: string, email: string) => ipcRenderer.invoke('create-doctor-profile', userId, fullName, speciality, phoneNumber, address, email),
  getDoctorProfile: (userId: number) => ipcRenderer.invoke('get-doctor-profile', userId),
  updateDoctorProfile: (userId: number, input: DoctorProfileInput) => ipcRenderer.invoke('update-doctor-profile', userId, input),
  setPrescriptionPdf: (doctorId: number) => ipcRenderer.invoke('set-prescription-pdf', doctorId),
  //gestion des prescriptions
  addPrescription: (userId: number, patientId: number, medicines: { medicineName: string; dosage: string; frequency: string; quantity: string; duration: string }[], notes?: string, consultationId?: number) => ipcRenderer.invoke('add-prescription', userId, patientId, medicines, notes, consultationId),
  getPrescriptionById: (id: number, patientId: number) => ipcRenderer.invoke('get-prescription-by-id', id, patientId),
  getPatientPrescriptions: (patientId: number) => ipcRenderer.invoke('get-patient-prescriptions', patientId),
  getAllPrescriptions: () => ipcRenderer.invoke('get-all-prescriptions'),
  updatePrescription: (prescription: Prescription) => ipcRenderer.invoke('update-prescription', prescription),
  deletePrescription: (id: number) => ipcRenderer.invoke('delete-prescription', id),
  searchPrescription: (query: string) => ipcRenderer.invoke('search-prescriptions', query),
  countPrescriptions: () => ipcRenderer.invoke('count-prescriptions'),

  //bibliothèque d'ordonnances (suggestions + modèles)
  suggestMedicines: (query: string, limit?: number) => ipcRenderer.invoke('suggest-medicines', query, limit),
  getPrescriptionTemplates: (userId: number) => ipcRenderer.invoke('get-prescription-templates', userId),
  savePrescriptionTemplate: (userId: number, name: string, medicines: MedicineLine[], notes?: string) => ipcRenderer.invoke('save-prescription-template', userId, name, medicines, notes),
  deletePrescriptionTemplate: (id: number) => ipcRenderer.invoke('delete-prescription-template', id),

  //gestion des certificats médicaux
  createCertificate: (userId: number, draft: CertificateDraft) => ipcRenderer.invoke('create-certificate', userId, draft),
  getCertificatesByPatientId: (patientId: number) => ipcRenderer.invoke('get-certificates-by-patient-id', patientId),
  getCertificatesByConsultationId: (consultationId: number) => ipcRenderer.invoke('get-certificates-by-consultation-id', consultationId),
  reprintCertificate: (id: number) => ipcRenderer.invoke('reprint-certificate', id),
  deleteCertificate: (id: number) => ipcRenderer.invoke('delete-certificate', id),
  getCertificateStatistics: (userId: number, year: number) => ipcRenderer.invoke('get-certificate-statistics', userId, year),

  //gestion des paiements et des impayés
  recordPayment: (draft: PaymentDraft, userId?: number | null, defaultFee?: number) => ipcRenderer.invoke('record-payment', draft, userId, defaultFee),
  getPaymentsByConsultationId: (consultationId: number) => ipcRenderer.invoke('get-payments-by-consultation-id', consultationId),
  deletePayment: (id: number, defaultFee?: number) => ipcRenderer.invoke('delete-payment', id, defaultFee),
  getConsultationBalance: (consultationId: number, defaultFee?: number) => ipcRenderer.invoke('get-consultation-balance', consultationId, defaultFee),
  getOutstandingBalances: (defaultFee?: number) => ipcRenderer.invoke('get-outstanding-balances', defaultFee),
  generateReceiptPdf: (paymentId: number, language?: string, defaultFee?: number) => ipcRenderer.invoke('generate-receipt-pdf', paymentId, language, defaultFee),

  //journal d'activité (audit) — lecture seule
  getAuditLog: (query?: AuditQuery) => ipcRenderer.invoke('get-audit-log', query),
  getAuditLogForEntity: (entityType: string, entityId: number) => ipcRenderer.invoke('get-audit-log-for-entity', entityType, entityId),

  //gestion authentification
  createUser: (user: { fullName: string; password: string }) => ipcRenderer.invoke('create-user', user),
  login: (fullName: string, password: string, stayLogged: boolean) => ipcRenderer.invoke('login', fullName, password, stayLogged),
  checkAuth: () => ipcRenderer.invoke('check-auth'),
  logout: () => ipcRenderer.invoke('logout'),

  //Patient prescription
  generatePatientPrescriptionPDF: (patientId: number, prescriptions: Prescription[], doctor: DoctorProfile, weight?: string, language?: string, consultationId?: number) => ipcRenderer.invoke('generate-patient-prescription-pdf', patientId, prescriptions, doctor, weight, language, consultationId),

  //gestion des rendez-vous
  bookAppointment: (patientId: number, doctorId: number, datetime: string, duration?: number, reason?: string) => ipcRenderer.invoke('book-appointment', patientId, doctorId, datetime, duration, reason),
  cancelAppointment: (id: number) => ipcRenderer.invoke('cancel-appointment', id),
  deleteAppointment: (id: number) => ipcRenderer.invoke('delete-appointment', id),
  updateAppointment: (id: number, status: string) => ipcRenderer.invoke('update-appointment', id, status),
  getAppointmentsByDay: (doctorId: number, date: string) => ipcRenderer.invoke('get-appointments-by-day', doctorId, date),
  getAppointmentsByPatientId: (patientId: number) => ipcRenderer.invoke('get-appointments-by-patient-id', patientId),
  getAppointmentsByDateRange: (doctorId: number, startDate: string, endDate: string) => ipcRenderer.invoke('get-appointments-by-date-range', doctorId, startDate, endDate),

  //gestion des consultations
  startConsultation: (patientId: number, doctorId: number, appointmentId?: number) => ipcRenderer.invoke('start-consultation', patientId, doctorId, appointmentId),
  getConsultationById: (id: number) => ipcRenderer.invoke('get-consultation-by-id', id),
  getActiveConsultation: (doctorId: number) => ipcRenderer.invoke('get-active-consultation', doctorId),
  updateConsultation: (id: number, draft: ConsultationDraft) => ipcRenderer.invoke('update-consultation', id, draft),
  completeConsultation: (id: number, draft?: ConsultationDraft) => ipcRenderer.invoke('complete-consultation', id, draft),
  deleteConsultation: (id: number) => ipcRenderer.invoke('delete-consultation', id),
  getConsultationArtifacts: (consultationId: number) => ipcRenderer.invoke('get-consultation-artifacts', consultationId),
  getConsultationsByPatientId: (patientId: number) => ipcRenderer.invoke('get-consultations-by-patient-id', patientId),
  getConsultationsByDay: (doctorId: number, date: string) => ipcRenderer.invoke('get-consultations-by-day', doctorId, date),
  getConsultationsByDateRange: (doctorId: number, startDate: string, endDate: string) => ipcRenderer.invoke('get-consultations-by-date-range', doctorId, startDate, endDate),

  //gestion des statistiques
  getFinancialStatistics: (startDate: string, endDate: string, appointmentPrice: number) => ipcRenderer.invoke('get-financial-statistics', startDate, endDate, appointmentPrice),
  getConsultationStatistics: (startDate: string, endDate: string, defaultFee: number) => ipcRenderer.invoke('get-consultation-statistics', startDate, endDate, defaultFee),
  getAppointmentStatistics: (startDate: string, endDate: string, appointmentPrice: number) => ipcRenderer.invoke('get-appointment-statistics', startDate, endDate, appointmentPrice),
  getNoShowRate: (startDate: string, endDate: string) => ipcRenderer.invoke('get-noshow-rate', startDate, endDate),
  getConsultationVolume: (startDate: string, endDate: string) => ipcRenderer.invoke('get-consultation-volume', startDate, endDate),

  //gestion de la licence / période d'essai
  getTrialStatus: () => ipcRenderer.invoke('get-trial-status'),
  activateLicense: (key: string) => ipcRenderer.invoke('activate-license', key),

  //gestion des mises à jour
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
})
