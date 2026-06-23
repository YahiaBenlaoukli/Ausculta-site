import { ipcRenderer, contextBridge } from 'electron'
import type { Patient } from '../types/patient'
import type { Prescription } from '../types/doctor'
import type { DoctorProfile } from '../types/doctor'
import { PatientDocument } from '../types/documents'

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


  //gestion documents
  uploadDocument: (document: Omit<PatientDocument, 'id' | 'uploadDate'>) => ipcRenderer.invoke('upload-document', document),
  getDocumentsByPatientId: (patientId: number) => ipcRenderer.invoke('get-documents-by-patient-id', patientId),
  getAllDocuments: () => ipcRenderer.invoke('get-all-documents'),
  deleteDocument: (id: number) => ipcRenderer.invoke('delete-document', id),
  openDocument: (path: string) => ipcRenderer.invoke('open-document', path),
  //gestion profil médecin
  createDoctorProfile: (userId: number, fullName: string, speciality: string, phoneNumber: string, address: string, email: string) => ipcRenderer.invoke('create-doctor-profile', userId, fullName, speciality, phoneNumber, address, email),
  getDoctorProfile: (userId: number) => ipcRenderer.invoke('get-doctor-profile', userId),
  updateDoctorProfile: (userId: number, fullName: string, speciality: string, phoneNumber: string, address: string, email: string) => ipcRenderer.invoke('update-doctor-profile', userId, fullName, speciality, phoneNumber, address, email),
  setPrescriptionPdf: (doctorId: number) => ipcRenderer.invoke('set-prescription-pdf', doctorId),
  //gestion des prescriptions
  addPrescription: (userId: number, patientId: number, medicines: { medicineName: string; dosage: string; frequency: string; quantity: string; duration: string }[], notes?: string) => ipcRenderer.invoke('add-prescription', userId, patientId, medicines, notes),
  getPrescriptionById: (id: number, patientId: number) => ipcRenderer.invoke('get-prescription-by-id', id, patientId),
  getPatientPrescriptions: (patientId: number) => ipcRenderer.invoke('get-patient-prescriptions', patientId),
  getAllPrescriptions: () => ipcRenderer.invoke('get-all-prescriptions'),
  updatePrescription: (prescription: Prescription) => ipcRenderer.invoke('update-prescription', prescription),
  deletePrescription: (id: number) => ipcRenderer.invoke('delete-prescription', id),
  searchPrescription: (query: string) => ipcRenderer.invoke('search-prescription', query),
  countPrescriptions: () => ipcRenderer.invoke('count-prescriptions'),

  //gestion authentification
  createUser: (user: { fullName: string; password: string; role: string }) => ipcRenderer.invoke('create-user', user),
  login: (phoneNumber: string, password: string, stayLogged: boolean) => ipcRenderer.invoke('login', phoneNumber, password, stayLogged),
  checkAuth: () => ipcRenderer.invoke('check-auth'),
  logout: () => ipcRenderer.invoke('logout'),

  //Patient prescription
  generatePatientPrescriptionPDF: (patientId: number, prescriptions: Prescription[], doctor: DoctorProfile, weight?: string) => ipcRenderer.invoke('generate-patient-prescription-pdf', patientId, prescriptions, doctor, weight),

  //gestion des rendez-vous
  getAllAppointments: (doctorId: number, date: string) => ipcRenderer.invoke('get-all-appointments', doctorId, date),
  bookAppointment: (patientId: number, doctorId: number, datetime: string, duration?: number, reason?: string) => ipcRenderer.invoke('book-appointment', patientId, doctorId, datetime, duration, reason),
  cancelAppointment: (id: number) => ipcRenderer.invoke('cancel-appointment', id),
  deleteAppointment: (id: number) => ipcRenderer.invoke('delete-appointment', id),
  updateAppointment: (id: number, status: string) => ipcRenderer.invoke('update-appointment', id, status),
  getAppointmentsByDay: (doctorId: number, date: string) => ipcRenderer.invoke('get-appointments-by-day', doctorId, date),
  getAppointmentsByPatientId: (patientId: number) => ipcRenderer.invoke('get-appointments-by-patient-id', patientId),
  getAppointmentsByDateRange: (doctorId: number, startDate: string, endDate: string) => ipcRenderer.invoke('get-appointments-by-date-range', doctorId, startDate, endDate),

  //gestion des statistiques
  getFinancialStatistics: (startDate: string, endDate: string, appointmentPrice: number) => ipcRenderer.invoke('get-financial-statistics', startDate, endDate, appointmentPrice),
  getAppointmentStatistics: (startDate: string, endDate: string, appointmentPrice: number) => ipcRenderer.invoke('get-appointment-statistics', startDate, endDate, appointmentPrice),
  getNoShowRate: (startDate: string, endDate: string) => ipcRenderer.invoke('get-noshow-rate', startDate, endDate),
  getConsultationVolume: (startDate: string, endDate: string) => ipcRenderer.invoke('get-consultation-volume', startDate, endDate),
})
