/**
 * Every renderer↔main channel, as data.
 *
 * This used to be ninety `ipcMain.handle(channel, (_e, a, b) => fn(a, b))`
 * lines in main.ts. They were all the same shape — forward the arguments
 * positionally — so the arrow functions carried no information beyond the
 * arity, which they could also get wrong silently.
 *
 * As a table it can be walked by more than one thing. main.ts walks it to
 * register IPC handlers; when the LAN server lands it walks the same table to
 * mount HTTP routes, so a channel exists in one place rather than two
 * transports that drift.
 *
 * Adding a channel means adding an entry here, a wrapper in preload.ts, a
 * signature on AuscultaIpc in electron-env.d.ts — and deciding in
 * permissions.ts whether an assistant may reach it. That last one is not
 * optional: the allowlist there refuses anything it has not been told about,
 * and assertPolicyMatchesRegistry() fails loudly at startup if this table and
 * that policy disagree about which channels exist.
 */

import { addPatient, getPatient, getAllPatients, updatePatient, deletePatient, searchPatients, countPatients, resetMedicalDatabase } from '../services/patient'
import { uploadDocument, getDocumentsByPatientId, getAllDocuments, deleteDocument, openDocument } from '../services/documents'
import { addPrescription, getPrescriptionById, getPatientPrescriptions, getAllPrescriptions, updatePrescription, deletePrescription, searchPrescription, countPrescriptions, createDoctorProfile, getDoctorProfileByUserId, getPracticeDoctorProfile, updateDoctorProfile, setPrescriptionPdf, generatePatientPrescriptionPDF } from '../services/prescription'
import { createUser, login, checkAuth, logout, needsRegistration, createAssistant, listUsers, deleteUser, resetUserPassword } from '../services/auth'
import { bookAppointment, cancelAppointment, deleteAppointment, updateAppointment, getAppointmentsByDay, getAppointmentsByPatientId, getAppointmentsByDateRange } from '../services/appointments'
import { getFinancialStatistics, getAppointmentStatistics, getConsultationStatistics, getNoShowRate, getConsultationVolume } from '../services/statistics'
import { startConsultation, getConsultationById, getActiveConsultation, updateConsultation, completeConsultation, deleteConsultation, getConsultationArtifacts, getConsultationsByPatientId, getConsultationsByDay, getConsultationsByDateRange, getWaitingRoom, checkInPatient, callPatientIn, setQueuePriority, removeFromQueue } from '../services/consultations'
import { getTrialStatus, activateLicense } from '../services/trial'
import { getUpdateStatus, checkForUpdates, downloadUpdate, quitAndInstall } from '../services/updater'
import { globalSearch } from '../services/search'
import { suggestMedicines, getPrescriptionTemplates, savePrescriptionTemplate, deletePrescriptionTemplate } from '../services/prescriptionLibrary'
import { browseMedications, getMedicationDetail, getMedicationFacets } from '../services/medicationCatalog'
import { createCertificate, getCertificatesByPatientId, getCertificatesByConsultationId, reprintCertificate, deleteCertificate, getCertificateStatistics } from '../services/certificates'
import { recordPayment, getPaymentsByConsultationId, deletePayment, getConsultationBalance, getOutstandingBalances, generateReceiptPdf } from '../services/payments'
import { getAuditLog, getAuditLogForEntity } from '../services/audit'
import { getTomorrowReminders, openWhatsAppReminder, setReminderOutcome } from '../services/reminders'
import { backupDatabase, restoreDatabase, relaunchApp } from '../services/backup'
import { getNetworkConfig, setNetworkConfig, pinnedFingerprint } from '../services/networkConfig'
import { hostInfo } from '../server/server'
import { testHostConnection, unpairHost } from './remote'
import { enqueuePrintJob, getPrintQueue, markPrintJobPrinted, cancelPrintJob } from '../services/printQueue'
import { printLocalFile, listPrinters } from '../services/printing'
import { checkFirewallRule, addFirewallRule } from '../services/firewall'
import { listDisplays, openQueueDisplay, closeQueueDisplay, getQueueDisplayStatus } from '../services/queueDisplay'

export interface ChannelEntry {
  /**
   * The service function. Arguments arrive positionally, exactly as the
   * preload wrapper sent them.
   *
   * Typed `(...args: never[])` so any concrete signature is assignable while
   * still requiring a function — the wire is untyped by nature, and the one
   * cast that admits that lives at the single call site in main.ts rather than
   * ninety times over.
   */
  fn: (...args: never[]) => unknown

  /**
   * Runs against the machine it was called on and must never be proxied to a
   * host: OS dialogs, opening a file in the desktop shell, restarting this
   * app, this installation's licence and update state.
   */
  local?: boolean

  /**
   * Append the main BrowserWindow as a trailing argument. Only the backup and
   * restore dialogs need it, so their OS sheets are modal to the window rather
   * than free-floating where they can be lost behind the app.
   */
  withWindow?: boolean

  /**
   * What a client resolves to when the host cannot be reached.
   *
   * Nothing reads this yet — it is for the remote transport. It exists here
   * because the answer depends on what the channel returns, which is knowable
   * only while reading the channel. Most services return the
   * `{ status: 'fail' }` convention and the transport can synthesise that; the
   * entries below are the ones that resolve to a bare array, number or null,
   * whose callers guard with `Array.isArray(...)` and would otherwise render a
   * failure object as data. Channels whose failure should be loud rather than
   * empty — every write — deliberately have none.
   */
  fallback?: unknown
}

export const CHANNELS = {
  // ── Patients ────────────────────────────────────────────────────────────
  'add-patient': { fn: addPatient },
  'get-patient-by-id': { fn: getPatient, fallback: null },
  'get-all-patients': { fn: getAllPatients, fallback: [] },
  'update-patient': { fn: updatePatient },
  'delete-patient': { fn: deletePatient },
  'search-patients': { fn: searchPatients, fallback: [] },
  'count-patients': { fn: countPatients, fallback: 0 },
  'reset-database': { fn: resetMedicalDatabase },

  // ── Recherche globale ───────────────────────────────────────────────────
  'global-search': { fn: globalSearch },

  // ── Documents ───────────────────────────────────────────────────────────
  'get-documents-by-patient-id': { fn: getDocumentsByPatientId, fallback: [] },
  'get-all-documents': { fn: getAllDocuments, fallback: [] },
  'upload-document': { fn: uploadDocument },
  'delete-document': { fn: deleteDocument },
  // Hands a path to the desktop shell. On a client that path is on the host's
  // disk, so the remote transport replaces this rather than proxying it.
  'open-document': { fn: openDocument, local: true },

  // ── Profil médecin ──────────────────────────────────────────────────────
  'create-doctor-profile': { fn: createDoctorProfile },
  // "My profile" — Settings only, and only the doctor has one. Every other
  // screen wants the practice profile below, because that is what the
  // appointment and consultation tables are keyed on.
  'get-doctor-profile': { fn: getDoctorProfileByUserId },
  'get-practice-doctor-profile': { fn: getPracticeDoctorProfile },
  'update-doctor-profile': { fn: updateDoctorProfile },
  'set-prescription-pdf': { fn: setPrescriptionPdf },

  // ── Ordonnances ─────────────────────────────────────────────────────────
  'add-prescription': { fn: addPrescription },
  'get-prescription-by-id': { fn: getPrescriptionById },
  'get-patient-prescriptions': { fn: getPatientPrescriptions },
  'get-all-prescriptions': { fn: getAllPrescriptions },
  'update-prescription': { fn: updatePrescription },
  'delete-prescription': { fn: deletePrescription },
  'search-prescriptions': { fn: searchPrescription },
  'count-prescriptions': { fn: countPrescriptions },
  'generate-patient-prescription-pdf': { fn: generatePatientPrescriptionPDF },

  // ── Bibliothèque d'ordonnances (suggestions + modèles) ──────────────────
  'suggest-medicines': { fn: suggestMedicines },
  'get-prescription-templates': { fn: getPrescriptionTemplates },
  'save-prescription-template': { fn: savePrescriptionTemplate },
  'delete-prescription-template': { fn: deletePrescriptionTemplate },

  // ── Catalogue national des médicaments (lecture seule, hors base) ───────
  'browse-medications': { fn: browseMedications },
  'get-medication-detail': { fn: getMedicationDetail },
  'get-medication-facets': { fn: getMedicationFacets },

  // ── Certificats médicaux ────────────────────────────────────────────────
  'create-certificate': { fn: createCertificate },
  'get-certificates-by-patient-id': { fn: getCertificatesByPatientId },
  'get-certificates-by-consultation-id': { fn: getCertificatesByConsultationId },
  'reprint-certificate': { fn: reprintCertificate },
  'delete-certificate': { fn: deleteCertificate },
  'get-certificate-statistics': { fn: getCertificateStatistics },

  // ── Paiements et impayés ────────────────────────────────────────────────
  'record-payment': { fn: recordPayment },
  'get-payments-by-consultation-id': { fn: getPaymentsByConsultationId },
  'delete-payment': { fn: deletePayment },
  'get-consultation-balance': { fn: getConsultationBalance },
  'get-outstanding-balances': { fn: getOutstandingBalances },
  'generate-receipt-pdf': { fn: generateReceiptPdf },

  // ── Journal d'activité ──────────────────────────────────────────────────
  // Read-only on purpose: there is no delete-audit-entry channel, and adding
  // one would defeat the point of the table.
  'get-audit-log': { fn: getAuditLog },
  'get-audit-log-for-entity': { fn: getAuditLogForEntity },

  // ── Authentification ────────────────────────────────────────────────────
  // These three manage THIS seat's session — the token on this disk, the
  // signed-in user of this process — so they always run here. On a client the
  // local login implementation checks the password against the host over
  // /auth/login and then remembers the result exactly as it would locally;
  // proxying the channel itself would move the HOST's session instead.
  'login': { fn: login, local: true },
  'check-auth': { fn: checkAuth, local: true },
  'logout': { fn: logout, local: true },
  // These two read the users table, so a client must ask the host.
  'create-user': { fn: createUser },
  'needs-registration': { fn: needsRegistration },

  // ── Comptes (médecin uniquement) ────────────────────────────────────────
  'list-users': { fn: listUsers },
  'create-assistant': { fn: createAssistant },
  'delete-user': { fn: deleteUser },
  'reset-user-password': { fn: resetUserPassword },

  // ── Rendez-vous ─────────────────────────────────────────────────────────
  'book-appointment': { fn: bookAppointment },
  'cancel-appointment': { fn: cancelAppointment },
  'delete-appointment': { fn: deleteAppointment },
  'update-appointment': { fn: updateAppointment },
  'get-appointments-by-day': { fn: getAppointmentsByDay, fallback: [] },
  'get-appointments-by-patient-id': { fn: getAppointmentsByPatientId, fallback: [] },
  'get-appointments-by-date-range': { fn: getAppointmentsByDateRange, fallback: [] },

  // ── Rappels de rendez-vous (WhatsApp) ───────────────────────────────────
  // openWhatsAppReminder takes the message body from the renderer: the wording
  // is patient-facing prose that lives in the locale files, in three languages.
  'get-tomorrow-reminders': { fn: getTomorrowReminders },
  // Launches WhatsApp on the machine the desk is sitting at, not the host's.
  'open-whatsapp-reminder': { fn: openWhatsAppReminder, local: true },
  'set-reminder-outcome': { fn: setReminderOutcome },

  // ── Consultations ───────────────────────────────────────────────────────
  'start-consultation': { fn: startConsultation },
  'get-consultation-by-id': { fn: getConsultationById },
  'get-active-consultation': { fn: getActiveConsultation },
  'update-consultation': { fn: updateConsultation },
  'complete-consultation': { fn: completeConsultation },
  'delete-consultation': { fn: deleteConsultation },
  'get-consultation-artifacts': { fn: getConsultationArtifacts },
  'get-consultations-by-patient-id': { fn: getConsultationsByPatientId, fallback: [] },
  'get-consultations-by-day': { fn: getConsultationsByDay, fallback: [] },
  'get-consultations-by-date-range': { fn: getConsultationsByDateRange, fallback: [] },

  // ── Salle d'attente (accueil → salle de consultation) ───────────────────
  // The queue is derived from the consultation rows, so these live in the same
  // service. None are local: the whole point is that both seats see one queue.
  //
  // The fallback matters more here than elsewhere — this channel is polled every
  // few seconds, so a client whose host is asleep would otherwise render a
  // {status:'fail'} object where the waiting list should be, once per poll.
  'get-waiting-room': { fn: getWaitingRoom, fallback: { waiting: [], inRoom: null } },
  'check-in-patient': { fn: checkInPatient },
  // Doctor only, in permissions.ts: calling the next patient is the doctor
  // saying the room is free, and that is not the desk's call to make.
  'call-patient-in': { fn: callPatientIn },
  'set-queue-priority': { fn: setQueuePriority },
  'remove-from-queue': { fn: removeFromQueue },

  // ── Écran d'affichage de la salle d'attente ─────────────────────────────
  // Local by definition: these drive a monitor physically plugged into the
  // machine the call came from, exactly like list-printers and print-document.
  // Proxying "open a window on screen 2" to the host would open it in the
  // wrong room.
  'list-displays': { fn: listDisplays, local: true },
  'open-queue-display': { fn: openQueueDisplay, local: true },
  'close-queue-display': { fn: closeQueueDisplay, local: true },
  'get-queue-display-status': { fn: getQueueDisplayStatus, local: true },

  // ── Statistiques ────────────────────────────────────────────────────────
  'get-financial-statistics': { fn: getFinancialStatistics },
  'get-consultation-statistics': { fn: getConsultationStatistics },
  'get-appointment-statistics': { fn: getAppointmentStatistics },
  'get-noshow-rate': { fn: getNoShowRate },
  'get-consultation-volume': { fn: getConsultationVolume, fallback: [] },

  // ── Licence / période d'essai ───────────────────────────────────────────
  // Both bind to THIS machine's fingerprint, so they are answered here even on
  // a client — a seat's licence is its own, not the host's.
  'get-trial-status': { fn: getTrialStatus, local: true },
  'activate-license': { fn: activateLicense, local: true },

  // ── Sauvegarde / restauration ───────────────────────────────────────────
  // Local because they open OS dialogs and swap the database file underneath
  // the running process: both only ever make sense where the data actually is.
  'backup-database': { fn: backupDatabase, local: true, withWindow: true },
  'restore-database': { fn: restoreDatabase, local: true, withWindow: true },
  // Separate channel on purpose: the renderer gets the restore result, shows
  // the user what happened, and only then asks for the restart.
  'relaunch-app': { fn: relaunchApp, local: true },

  // ── Mises à jour ────────────────────────────────────────────────────────
  // Each installation updates itself; nothing here is the host's business.
  'get-update-status': { fn: getUpdateStatus, local: true },
  'check-for-updates': { fn: checkForUpdates, local: true },
  'download-update': { fn: downloadUpdate, local: true },
  'quit-and-install': { fn: quitAndInstall, local: true },

  // ── File d'impression (salle de consultation → accueil) ─────────────────
  'enqueue-print-job': { fn: enqueuePrintJob },
  'get-print-queue': { fn: getPrintQueue },
  'mark-print-job-printed': { fn: markPrintJobPrinted },
  'cancel-print-job': { fn: cancelPrintJob },
  // Local: the printer is the one next to whoever pressed the button. On a
  // client this is overridden to fetch the document from the host first.
  'print-document': { fn: printLocalFile, local: true },
  'list-printers': { fn: listPrinters, local: true, withWindow: true },

  // ── Réseau local (poste autonome / hôte / client) ───────────────────────
  // Local by definition: this is the setting that decides where everything
  // else goes, so it can never be answered by asking somewhere else.
  'get-network-config': { fn: getNetworkConfig, local: true },
  'set-network-config': { fn: setNetworkConfig, local: true },
  'get-host-info': { fn: hostInfo, local: true },
  // Reaching the host is the one thing a client must be able to do before it
  // trusts the host for anything, so it cannot be routed through the host.
  'test-host-connection': { fn: testHostConnection, local: true },
  'get-pinned-fingerprint': { fn: pinnedFingerprint, local: true },
  'unpair-host': { fn: unpairHost, local: true },
  // This machine's own firewall. Elevating on the host's behalf from a client
  // would be both impossible and wrong.
  'check-firewall-rule': { fn: checkFirewallRule, local: true },
  'add-firewall-rule': { fn: addFirewallRule, local: true },
} satisfies Record<string, ChannelEntry>

/** Every channel name, as a type — so policy and transport cannot invent one. */
export type ChannelName = keyof typeof CHANNELS

/**
 * The same table, widened.
 *
 * `satisfies` above checks each entry against ChannelEntry while keeping each
 * one's precise inferred type, which is what makes ChannelName exact. The cost
 * is that indexing CHANNELS yields a union of ninety-odd object types, and
 * reading `.local` off an entry that does not happen to declare it is an
 * error. Transports want the uniform view; the exactness was only ever for the
 * key type.
 */
export const CHANNEL_TABLE: Record<ChannelName, ChannelEntry> = CHANNELS

export function isChannel(name: string): name is ChannelName {
  return Object.prototype.hasOwnProperty.call(CHANNELS, name)
}
