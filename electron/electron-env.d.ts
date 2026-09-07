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
type DoctorProfileInput = import('../types/doctor').DoctorProfileInput
type PatientDocument = import('../types/documents').PatientDocument
type TrialStatus = import('../types/trial').TrialStatus
type ActivationResult = import('../types/trial').ActivationResult
type UpdateStatus = import('../types/update').UpdateStatus
type UpdateActionResult = import('../types/update').UpdateActionResult
type Consultation = import('../types/consultation').Consultation
type ConsultationDraft = import('../types/consultation').ConsultationDraft
type ConsultationListItem = import('../types/consultation').ConsultationListItem
type WaitingRoom = import('../types/waitingRoom').WaitingRoom
type WaitingRoomEntry = import('../types/waitingRoom').WaitingRoomEntry
type GlobalSearchResults = import('../types/search').GlobalSearchResults
type ReminderList = import('../types/reminder').ReminderList
type ReminderOutcome = import('../types/reminder').ReminderOutcome
type ReminderErrorCode = import('../types/reminder').ReminderErrorCode
type BackupResult = import('../types/backup').BackupResult
type RestoreResult = import('../types/backup').RestoreResult
type BackupErrorCode = import('../types/backup').BackupErrorCode
type BackupScope = import('../types/backup').BackupScope

/**
 * Result of an operation the user can abandon in an OS dialog. 'cancelled' is
 * separated from 'fail' so the UI can stay silent instead of reporting an error
 * the user caused on purpose.
 */
interface CancellableResult<T> {
  status: 'success' | 'fail' | 'cancelled'
  data?: T
  code?: BackupErrorCode
  message?: string
}
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
type MedicationFilters = import('../types/medication').MedicationFilters
type MedicationPage = import('../types/medication').MedicationPage
type MedicationFacets = import('../types/medication').MedicationFacets
type MedicationDetail = import('../types/medication').MedicationDetail
type UserRole = import('../types/user').UserRole
type UserSummary = import('../types/user').UserSummary
type NetworkConfig = import('../types/network').NetworkConfig
type NetworkMode = import('../types/network').NetworkMode
type HostInfo = import('../types/network').HostInfo
type DisplayOption = import('../types/network').DisplayOption
type QueueDisplayNameMode = import('../types/network').QueueDisplayNameMode
type ConnectionTest = import('../types/network').ConnectionTest
type HostStatus = import('../types/network').HostStatus
type FirewallResult = import('./services/firewall').FirewallResult
type PrintJob = import('../types/print').PrintJob
type PrinterOption = import('../types/print').PrinterOption

/** The signed-in identity the renderer sees. `role` decides what the UI offers. */
interface AuthUser {
  id: number
  fullName: string
  role: UserRole
}

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
  /** "My profile" — Settings only. An assistant has none, and gets `not_found`. */
  getDoctorProfile(userId: number): Promise<IpcResult<DoctorProfile>>
  /**
   * The practice's doctor profile, whoever is signed in. Every screen that
   * needs a `doctorId` for appointments or consultations wants this one —
   * those tables key off doctor_profile, not off the signed-in user.
   */
  getPracticeDoctorProfile(): Promise<IpcResult<DoctorProfile>>
  updateDoctorProfile(userId: number, input: DoctorProfileInput): Promise<IpcResult<DoctorProfile>>
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

  // catalogue national des médicaments — référence en lecture seule, aucune table
  browseMedications(filters?: MedicationFilters, page?: number, pageSize?: number): Promise<IpcResult<MedicationPage>>
  getMedicationDetail(key: string): Promise<IpcResult<MedicationDetail>>
  getMedicationFacets(): Promise<IpcResult<MedicationFacets>>

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
  /** First launch only — creates the practice's doctor. Refused once any account exists. */
  createUser(user: { fullName: string; password: string }): Promise<IpcResult<AuthUser>>
  /** True while no account exists, i.e. the login screen should offer to register. */
  needsRegistration(): Promise<IpcResult<boolean>>
  login(fullName: string, password: string, stayLogged: boolean): Promise<{ status: 'success' | 'fail'; token?: string; user?: AuthUser; message?: string }>
  checkAuth(): Promise<{ status: 'success' | 'fail'; token?: string; user?: AuthUser; message?: string }>
  logout(): Promise<IpcResult>

  // file d'impression — salle de consultation → accueil
  /** Queues a filed document for the front desk. Doctor only. */
  enqueuePrintJob(documentPath: string): Promise<IpcResult<{ jobId: number; alreadyQueued: boolean }>>
  getPrintQueue(): Promise<IpcResult<{ pending: PrintJob[]; recent: PrintJob[] }>>
  markPrintJobPrinted(id: number): Promise<IpcResult<{ alreadyDone: boolean }>>
  cancelPrintJob(id: number): Promise<IpcResult>
  /** Prints at THIS seat; fetches the document from the host first if needed. */
  printDocument(filePath: string): Promise<{ status: 'success' | 'fail'; opened?: boolean; message?: string }>
  listPrinters(): Promise<IpcResult<PrinterOption[]>>

  // réseau local — poste autonome / hôte / client
  getNetworkConfig(): Promise<NetworkConfig>
  /** Persisted immediately; takes effect on the next launch. */
  setNetworkConfig(patch: Partial<NetworkConfig>): Promise<IpcResult<NetworkConfig>>
  /** Host only: the addresses and fingerprint to read off when pairing. */
  getHostInfo(): Promise<HostInfo>
  /** Client only: reaches the host and pairs with it on first success. */
  testHostConnection(): Promise<ConnectionTest>
  getPinnedFingerprint(): Promise<string | null>
  unpairHost(): Promise<IpcResult>
  /** Host only: whether inbound TCP on the configured port is already allowed. */
  checkFirewallRule(): Promise<FirewallResult>
  /** Prompts for elevation (UAC). 'cancelled' means the user declined. */
  addFirewallRule(): Promise<FirewallResult>

  // gestion des comptes — médecin uniquement
  listUsers(): Promise<IpcResult<UserSummary[]>>
  createAssistant(fullName: string, password: string): Promise<IpcResult<AuthUser>>
  deleteUser(id: number): Promise<IpcResult>
  resetUserPassword(id: number, newPassword: string): Promise<IpcResult>

  // gestion des rendez-vous
  bookAppointment(patientId: number, doctorId: number, datetime: string, duration?: number, reason?: string): Promise<IpcResult<{ appointmentId: number }>>
  cancelAppointment(id: number): Promise<IpcResult>
  deleteAppointment(id: number): Promise<IpcResult>
  updateAppointment(id: number, status: string): Promise<IpcResult>
  getAppointmentsByDay(doctorId: number, date: string): Promise<AppointmentRow[]>
  getAppointmentsByPatientId(patientId: number): Promise<AppointmentRow[]>
  getAppointmentsByDateRange(doctorId: number, startDate: string, endDate: string): Promise<AppointmentRow[]>

  // rappels de rendez-vous (WhatsApp)
  getTomorrowReminders(doctorId: number): Promise<IpcResult<ReminderList> & { data: ReminderList }>
  /**
   * Opens WhatsApp with `message` loaded. Success means WhatsApp was LAUNCHED —
   * not that the patient received anything; the channel cannot report that.
   */
  openWhatsAppReminder(appointmentId: number, message: string): Promise<IpcResult<{ phoneDisplay: string }> & { code?: ReminderErrorCode }>
  setReminderOutcome(appointmentId: number, outcome: ReminderOutcome): Promise<IpcResult & { code?: ReminderErrorCode }>

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

  // salle d'attente — accueil → salle de consultation
  /**
   * The queue and the room in one call. Takes no doctor id: a practice has one
   * doctor_profile, and the main process resolves it rather than making a poll
   * fetch the profile first.
   *
   * Resolves to an empty waiting room — never a failure object — when a client
   * cannot reach the host, so a poll can render the result unconditionally.
   */
  getWaitingRoom(): Promise<WaitingRoom>
  /** The desk: this patient is here. Opens the visit draft, leaves them waiting. */
  checkInPatient(patientId: number, appointmentId?: number): Promise<IpcResult<Consultation>>
  /** The doctor: come through. Doctor only. `alreadyCalled` when another seat beat you to it. */
  callPatientIn(consultationId: number): Promise<IpcResult<{ alreadyCalled: boolean }>>
  setQueuePriority(consultationId: number, priority: boolean): Promise<IpcResult<{ changes: number }>>
  /** Refused with `code: 'has_content'` once anything has been recorded on the visit. */
  removeFromQueue(consultationId: number): Promise<IpcResult<{ changes: number }> & { code?: 'has_content' }>

  // écran d'affichage de la salle d'attente — local to this machine
  listDisplays(): Promise<IpcResult<DisplayOption[]>>
  /** Omit `displayId` to use the one stored in network.json, or auto-resolve. */
  openQueueDisplay(displayId?: number | null): Promise<IpcResult<{ displayId: number }>>
  closeQueueDisplay(): Promise<IpcResult>
  getQueueDisplayStatus(): Promise<IpcResult<{ open: boolean; displayId: number | null }>>

  // gestion des statistiques
  getFinancialStatistics(startDate: string, endDate: string, appointmentPrice: number): Promise<{ total_completed: number; total_revenue: number }>
  getConsultationStatistics(startDate: string, endDate: string, defaultFee: number): Promise<ConsultationStatistics>
  getAppointmentStatistics(startDate: string, endDate: string, appointmentPrice: number): Promise<AppointmentStatistics>
  getNoShowRate(startDate: string, endDate: string): Promise<NoShowStatistics>
  getConsultationVolume(startDate: string, endDate: string): Promise<ConsultationVolumeRow[]>

  // gestion de la licence / période d'essai
  getTrialStatus(): Promise<TrialStatus>
  activateLicense(key: string): Promise<ActivationResult>

  // sauvegarde / restauration de la base (licence requise)
  /**
   * Writes a snapshot the user picks a location for. 'database' saves one .db
   * file; 'full' saves a folder holding that file plus the documents tree.
   */
  backupDatabase(scope: BackupScope): Promise<CancellableResult<BackupResult>>
  /**
   * Replaces the live data with a chosen backup of the same scope. On success
   * the app MUST be relaunched via relaunchApp() — until then it is running
   * against a database its open connection no longer describes.
   */
  restoreDatabase(scope: BackupScope): Promise<CancellableResult<RestoreResult>>
  relaunchApp(): Promise<void>

  // gestion des mises à jour
  getUpdateStatus(): Promise<UpdateStatus>
  checkForUpdates(): Promise<UpdateStatus>
  downloadUpdate(): Promise<UpdateActionResult>
  quitAndInstall(): Promise<UpdateActionResult>
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: AuscultaIpc
}
