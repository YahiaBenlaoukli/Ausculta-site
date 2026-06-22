"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args) {
    const [channel, listener] = args;
    return electron.ipcRenderer.on(channel, (event, ...args2) => listener(event, ...args2));
  },
  off(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.off(channel, ...omit);
  },
  send(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.send(channel, ...omit);
  },
  invoke(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.invoke(channel, ...omit);
  },
  //gestion patient
  getAllPatients: () => electron.ipcRenderer.invoke("get-all-patients"),
  addPatient: (patient) => electron.ipcRenderer.invoke("add-patient", patient),
  updatePatient: (patient) => electron.ipcRenderer.invoke("update-patient", patient),
  deletePatient: (id) => electron.ipcRenderer.invoke("delete-patient", id),
  getPatientById: (id) => electron.ipcRenderer.invoke("get-patient-by-id", id),
  searchPatient: (query) => electron.ipcRenderer.invoke("search-patients", query),
  countPatients: () => electron.ipcRenderer.invoke("count-patients"),
  //gestion documents
  uploadDocument: (document) => electron.ipcRenderer.invoke("upload-document", document),
  getDocumentsByPatientId: (patientId) => electron.ipcRenderer.invoke("get-documents-by-patient-id", patientId),
  getAllDocuments: () => electron.ipcRenderer.invoke("get-all-documents"),
  deleteDocument: (id) => electron.ipcRenderer.invoke("delete-document", id),
  openDocument: (path) => electron.ipcRenderer.invoke("open-document", path),
  //gestion profil médecin
  createDoctorProfile: (userId, fullName, speciality, phoneNumber, address, email) => electron.ipcRenderer.invoke("create-doctor-profile", userId, fullName, speciality, phoneNumber, address, email),
  getDoctorProfile: (userId) => electron.ipcRenderer.invoke("get-doctor-profile", userId),
  setPrescriptionPdf: (doctorId) => electron.ipcRenderer.invoke("set-prescription-pdf", doctorId),
  //gestion des prescriptions
  addPrescription: (userId, patientId, medicines, notes) => electron.ipcRenderer.invoke("add-prescription", userId, patientId, medicines, notes),
  getPrescriptionById: (id, patientId) => electron.ipcRenderer.invoke("get-prescription-by-id", id, patientId),
  getPatientPrescriptions: (patientId) => electron.ipcRenderer.invoke("get-patient-prescriptions", patientId),
  getAllPrescriptions: () => electron.ipcRenderer.invoke("get-all-prescriptions"),
  updatePrescription: (prescription) => electron.ipcRenderer.invoke("update-prescription", prescription),
  deletePrescription: (id) => electron.ipcRenderer.invoke("delete-prescription", id),
  searchPrescription: (query) => electron.ipcRenderer.invoke("search-prescription", query),
  countPrescriptions: () => electron.ipcRenderer.invoke("count-prescriptions"),
  //gestion authentification
  createUser: (user) => electron.ipcRenderer.invoke("create-user", user),
  login: (phoneNumber, password, stayLogged) => electron.ipcRenderer.invoke("login", phoneNumber, password, stayLogged),
  checkAuth: () => electron.ipcRenderer.invoke("check-auth"),
  logout: () => electron.ipcRenderer.invoke("logout"),
  //Patient prescription
  generatePatientPrescriptionPDF: (patientId, prescriptions, doctor, weight) => electron.ipcRenderer.invoke("generate-patient-prescription-pdf", patientId, prescriptions, doctor, weight),
  //gestion des rendez-vous
  getAllAppointments: (doctorId, date) => electron.ipcRenderer.invoke("get-all-appointments", doctorId, date),
  bookAppointment: (patientId, doctorId, datetime, duration, reason) => electron.ipcRenderer.invoke("book-appointment", patientId, doctorId, datetime, duration, reason),
  cancelAppointment: (id) => electron.ipcRenderer.invoke("cancel-appointment", id),
  deleteAppointment: (id) => electron.ipcRenderer.invoke("delete-appointment", id),
  updateAppointment: (id, status) => electron.ipcRenderer.invoke("update-appointment", id, status),
  getAppointmentsByDay: (doctorId, date) => electron.ipcRenderer.invoke("get-appointments-by-day", doctorId, date),
  getAppointmentsByPatientId: (patientId) => electron.ipcRenderer.invoke("get-appointments-by-patient-id", patientId),
  getAppointmentsByDateRange: (doctorId, startDate, endDate) => electron.ipcRenderer.invoke("get-appointments-by-date-range", doctorId, startDate, endDate),
  //gestion des statistiques
  getFinancialStatistics: (startDate, endDate, appointmentPrice) => electron.ipcRenderer.invoke("get-financial-statistics", startDate, endDate, appointmentPrice),
  getAppointmentStatistics: (startDate, endDate, appointmentPrice) => electron.ipcRenderer.invoke("get-appointment-statistics", startDate, endDate, appointmentPrice),
  getNoShowRate: (startDate, endDate) => electron.ipcRenderer.invoke("get-noshow-rate", startDate, endDate),
  getConsultationVolume: (startDate, endDate) => electron.ipcRenderer.invoke("get-consultation-volume", startDate, endDate)
});
