/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// ── Typed renderer↔main bridge ─────────────────────────────────────────────
// One entry per wrapper exposed in `preload.ts`. Keep the three files in sync:
// electron/main.ts (handler), electron/preload.ts (wrapper), this interface.

type Patient = import('../types/patient').Patient
type Prescription = import('../types/doctor').Prescription
type DoctorProfile = import('../types/doctor').DoctorProfile
type PatientDocument = import('../types/documents').PatientDocument
type TrialStatus = import('../types/trial').TrialStatus

interface IpcResult<T = unknown> {
  status: 'success' | 'fail' | 'not_found'
  data?: T
  message?: string
}

interface AppointmentRow {
  id: number
  patient_id: number
  doctor_id: number
  appointment_datetime: string
  duration_minutes: number
  reason: string | null
  status: string
  created_at: string
  /** joined from patients */
  full_name: string | null
  phone_number: string | null
}

interface DocumentRow extends PatientDocument {
  patientName: string
  patientPhone: string | null
  fileSize: number
}

interface AppointmentStatistics {
  total_completed: number
  total_no_show: number
  total_cancelled: number
  total_scheduled: number
  total_appointments: number
  total_revenue: number
}

interface NoShowStatistics {
  total_no_show: number
  total_appointments: number
  no_show_rate: number
  top_no_show_patients: { id: number; full_name: string; phone_number: string | null; no_show_count: number }[]
}

interface ConsultationVolumeRow {
  month: string
  total_appointments: number
  completed_appointments: number
}

interface AuscultaIpc {
  on(channel: string, listener: (event: import('electron').IpcRendererEvent, ...args: unknown[]) => void): void
  off(channel: string, listener?: (...args: unknown[]) => void): void
  send(channel: string, ...args: unknown[]): void
  invoke(channel: string, ...args: unknown[]): Promise<unknown>

  // gestion patient
  getAllPatients(): Promise<Patient[]>
  addPatient(patient: Omit<Patient, 'id' | 'createdAt'>): Promise<Patient>
  updatePatient(patient: Patient): Promise<Patient>
  deletePatient(id: number): Promise<void>
  getPatientById(id: number): Promise<Patient | null>
  searchPatient(query: string): Promise<Patient[]>
  countPatients(): Promise<number>
  resetDatabase(): Promise<IpcResult>

  // gestion documents
  uploadDocument(document: Omit<PatientDocument, 'id' | 'uploadDate'>): Promise<PatientDocument>
  getDocumentsByPatientId(patientId: number): Promise<PatientDocument[]>
  getAllDocuments(): Promise<DocumentRow[]>
  deleteDocument(id: number): Promise<IpcResult>
  openDocument(path: string): Promise<string>

  // gestion profil médecin
  createDoctorProfile(userId: number, fullName: string, speciality: string, phoneNumber: string, address: string, email: string): Promise<IpcResult<DoctorProfile>>
  getDoctorProfile(userId: number): Promise<IpcResult<DoctorProfile>>
  updateDoctorProfile(userId: number, fullName: string, speciality: string, phoneNumber: string, address: string, email: string): Promise<IpcResult<DoctorProfile>>
  setPrescriptionPdf(doctorId: number): Promise<IpcResult<{ doctor: DoctorProfile; pdfPath: string }>>

  // gestion des prescriptions
  addPrescription(userId: number, patientId: number, medicines: { medicineName: string; dosage: string; frequency: string; quantity: string; duration: string }[], notes?: string): Promise<IpcResult<{ prescriptionId: number }>>
  getPrescriptionById(id: number, patientId: number): Promise<IpcResult<{ prescription: Prescription; documents: PatientDocument[] }>>
  getPatientPrescriptions(patientId: number): Promise<IpcResult<Prescription[]>>
  getAllPrescriptions(): Promise<IpcResult<Prescription[]>>
  updatePrescription(prescription: Prescription): Promise<IpcResult<{ prescriptionId: number }>>
  deletePrescription(id: number): Promise<IpcResult>
  searchPrescription(query: string): Promise<IpcResult<Prescription[]>>
  countPrescriptions(): Promise<IpcResult<number>>
  generatePatientPrescriptionPDF(patientId: number, prescriptions: Prescription[], doctor: DoctorProfile, weight?: string): Promise<IpcResult<string>>

  // gestion authentification
  createUser(user: { fullName: string; password: string }): Promise<IpcResult<{ id: number; fullName: string }>>
  login(fullName: string, password: string, stayLogged: boolean): Promise<{ status: 'success' | 'fail'; token?: string; user?: { id: number; fullName: string }; message?: string }>
  checkAuth(): Promise<{ status: 'success' | 'fail'; token?: string; user?: { id: number; fullName: string }; message?: string }>
  logout(): Promise<IpcResult>

  // gestion des rendez-vous
  bookAppointment(patientId: number, doctorId: number, datetime: string, duration?: number, reason?: string): Promise<IpcResult<{ appointmentId: number }>>
  cancelAppointment(id: number): Promise<IpcResult>
  deleteAppointment(id: number): Promise<IpcResult>
  updateAppointment(id: number, status: string): Promise<IpcResult>
  getAppointmentsByDay(doctorId: number, date: string): Promise<AppointmentRow[]>
  getAppointmentsByPatientId(patientId: number): Promise<AppointmentRow[]>
  getAppointmentsByDateRange(doctorId: number, startDate: string, endDate: string): Promise<AppointmentRow[]>

  // gestion des statistiques
  getFinancialStatistics(startDate: string, endDate: string, appointmentPrice: number): Promise<{ total_completed: number; total_revenue: number }>
  getAppointmentStatistics(startDate: string, endDate: string, appointmentPrice: number): Promise<AppointmentStatistics>
  getNoShowRate(startDate: string, endDate: string): Promise<NoShowStatistics>
  getConsultationVolume(startDate: string, endDate: string): Promise<ConsultationVolumeRow[]>

  // gestion de la licence / période d'essai
  getTrialStatus(): Promise<TrialStatus>
  activateLicense(key: string): Promise<{ status: 'success' | 'fail'; message?: string }>
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: AuscultaIpc
}
