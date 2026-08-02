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
type Consultation = import('../types/consultation').Consultation
type ConsultationDraft = import('../types/consultation').ConsultationDraft
type ConsultationListItem = import('../types/consultation').ConsultationListItem
type GlobalSearchResults = import('../types/search').GlobalSearchResults
type MedicineLine = import('../types/doctor').MedicineLine
type MedicineSuggestion = import('../types/doctor').MedicineSuggestion
type PrescriptionTemplate = import('../types/doctor').PrescriptionTemplate
type Certificate = import('../types/certificate').Certificate
type CertificateDraft = import('../types/certificate').CertificateDraft
type Payment = import('../types/payment').Payment
type PaymentDraft = import('../types/payment').PaymentDraft
type ConsultationBalance = import('../types/payment').ConsultationBalance
type PatientBalance = import('../types/payment').PatientBalance
type AuditEntry = import('../types/audit').AuditEntry
type AuditQuery = import('../types/audit').AuditQuery
type AuditPage = import('../types/audit').AuditPage

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

interface ConsultationStatistics {
  total_consultations: number
  total_walk_ins: number
  total_scheduled_visits: number
  total_revenue: number
  total_unpaid: number
}

interface ConsultationVolumeRow {
  month: string
  total_consultations: number
  walk_in_consultations: number
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

  // recherche globale
  globalSearch(query: string): Promise<GlobalSearchResults>

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
  setPrescriptionPdf(doctorId: number): Promise<IpcResult<{ doctor: DoctorProfile; pdfPath: string; pdfPathEn: string }>>

  // gestion des prescriptions
  addPrescription(userId: number, patientId: number, medicines: { medicineName: string; dosage: string; frequency: string; quantity: string; duration: string }[], notes?: string, consultationId?: number): Promise<IpcResult<{ prescriptionId: number }>>
  getPrescriptionById(id: number, patientId: number): Promise<IpcResult<{ prescription: Prescription; documents: PatientDocument[] }>>
  getPatientPrescriptions(patientId: number): Promise<IpcResult<Prescription[]>>
  getAllPrescriptions(): Promise<IpcResult<Prescription[]>>
  updatePrescription(prescription: Prescription): Promise<IpcResult<{ prescriptionId: number }>>
  deletePrescription(id: number): Promise<IpcResult>
  searchPrescription(query: string): Promise<IpcResult<Prescription[]>>
  countPrescriptions(): Promise<IpcResult<number>>

  // bibliothèque d'ordonnances (suggestions + modèles)
  suggestMedicines(query: string, limit?: number): Promise<IpcResult<MedicineSuggestion[]>>
  getPrescriptionTemplates(userId: number): Promise<IpcResult<PrescriptionTemplate[]>>
  savePrescriptionTemplate(userId: number, name: string, medicines: MedicineLine[], notes?: string): Promise<IpcResult<{ templateId: number; replaced: boolean }>>
  deletePrescriptionTemplate(id: number): Promise<IpcResult>

  // gestion des certificats médicaux
  /** On `unsupported_characters`, `characters` lists the glyphs the PDF font cannot draw. */
  createCertificate(userId: number, draft: CertificateDraft): Promise<IpcResult<{ certificate: Certificate; documentPath: string }> & { characters?: string[] }>
  getCertificatesByPatientId(patientId: number): Promise<IpcResult<Certificate[]>>
  getCertificatesByConsultationId(consultationId: number): Promise<IpcResult<Certificate[]>>
  reprintCertificate(id: number): Promise<IpcResult<{ documentPath: string }>>
  deleteCertificate(id: number): Promise<IpcResult>
  getCertificateStatistics(userId: number, year: number): Promise<IpcResult<{ total: number; work_leave_count: number; total_leave_days: number }>>

  // gestion des paiements et des impayés
  recordPayment(draft: PaymentDraft, userId?: number | null, defaultFee?: number): Promise<IpcResult<Payment>>
  getPaymentsByConsultationId(consultationId: number): Promise<IpcResult<Payment[]>>
  deletePayment(id: number, defaultFee?: number): Promise<IpcResult>
  getConsultationBalance(consultationId: number, defaultFee?: number): Promise<IpcResult<ConsultationBalance>>
  getOutstandingBalances(defaultFee?: number): Promise<IpcResult<{ patients: PatientBalance[]; totalOutstanding: number; patientCount: number }>>
  /** On `unsupported_characters`, `characters` lists the glyphs the PDF font cannot draw. */
  generateReceiptPdf(paymentId: number, language?: string, defaultFee?: number): Promise<IpcResult<{ documentPath: string; receiptNumber: string }> & { characters?: string[] }>

  // journal d'activité (audit) — read-only by design
  getAuditLog(query?: AuditQuery): Promise<IpcResult<AuditPage>>
  getAuditLogForEntity(entityType: string, entityId: number): Promise<IpcResult<AuditEntry[]>>
  generatePatientPrescriptionPDF(patientId: number, prescriptions: Prescription[], doctor: DoctorProfile, weight?: string, language?: string, consultationId?: number): Promise<IpcResult<string>>

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

  // gestion des consultations
  startConsultation(patientId: number, doctorId: number, appointmentId?: number): Promise<IpcResult<Consultation>>
  getConsultationById(id: number): Promise<IpcResult<Consultation>>
  getActiveConsultation(doctorId: number): Promise<IpcResult<Consultation>>
  updateConsultation(id: number, draft: ConsultationDraft): Promise<IpcResult<{ consultationId: number }>>
  completeConsultation(id: number, draft?: ConsultationDraft): Promise<IpcResult<Consultation>>
  deleteConsultation(id: number): Promise<IpcResult<{ changes: number }>>
  getConsultationArtifacts(consultationId: number): Promise<IpcResult<{ prescriptions: Prescription[]; documents: PatientDocument[] }>>
  getConsultationsByPatientId(patientId: number): Promise<ConsultationListItem[]>
  getConsultationsByDay(doctorId: number, date: string): Promise<ConsultationListItem[]>
  getConsultationsByDateRange(doctorId: number, startDate: string, endDate: string): Promise<ConsultationListItem[]>

  // gestion des statistiques
  getFinancialStatistics(startDate: string, endDate: string, appointmentPrice: number): Promise<{ total_completed: number; total_revenue: number }>
  getConsultationStatistics(startDate: string, endDate: string, defaultFee: number): Promise<ConsultationStatistics>
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
