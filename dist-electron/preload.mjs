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
  searchPatient: (query) => electron.ipcRenderer.invoke("search-patient", query),
  countPatients: () => electron.ipcRenderer.invoke("count-patients"),
  //gestion documents
  uploadDocument: (document) => electron.ipcRenderer.invoke("upload-document", document),
  getDocumentsByPatientId: (patientId) => electron.ipcRenderer.invoke("get-documents-by-patient-id", patientId),
  deleteDocument: (id) => electron.ipcRenderer.invoke("delete-document", id),
  openDocument: (path) => electron.ipcRenderer.invoke("open-document", path),
  //gestion profil médecin
  createDoctorProfile: (userId, fullName, speciality, phoneNumber, address) => electron.ipcRenderer.invoke("create-doctor-profile", userId, fullName, speciality, phoneNumber, address),
  getDoctorProfile: (userId) => electron.ipcRenderer.invoke("get-doctor-profile", userId),
  setPrescriptionPdf: (doctorId, pdfPath) => electron.ipcRenderer.invoke("set-prescription-pdf", doctorId, pdfPath),
  //gestion des prescriptions
  addPrescription: (prescription) => electron.ipcRenderer.invoke("add-prescription", prescription),
  getPrescriptionById: (id) => electron.ipcRenderer.invoke("get-prescription-by-id", id),
  getAllPrescriptions: () => electron.ipcRenderer.invoke("get-all-prescriptions"),
  updatePrescription: (prescription) => electron.ipcRenderer.invoke("update-prescription", prescription),
  deletePrescription: (id) => electron.ipcRenderer.invoke("delete-prescription", id),
  searchPrescription: (query) => electron.ipcRenderer.invoke("search-prescription", query),
  countPrescriptions: () => electron.ipcRenderer.invoke("count-prescriptions")
});
