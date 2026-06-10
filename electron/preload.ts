import { ipcRenderer, contextBridge } from 'electron'
import type { Patient } from '../types/patient'
import type { Prescription } from '../types/doctor'

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
  searchPatient: (query: string) => ipcRenderer.invoke('search-patient', query),
  countPatients: () => ipcRenderer.invoke('count-patients'),


  //gestion documents
  uploadDocument: (document: Omit<PatientDocument, 'id' | 'uploadDate'>) => ipcRenderer.invoke('upload-document', document),
  getDocumentsByPatientId: (patientId: number) => ipcRenderer.invoke('get-documents-by-patient-id', patientId),
  deleteDocument: (id: number) => ipcRenderer.invoke('delete-document', id),
  openDocument: (path: string) => ipcRenderer.invoke('open-document', path),
  //gestion profil médecin
  createDoctorProfile: (userId: number, fullName: string, speciality: string, phoneNumber: string, address: string) => ipcRenderer.invoke('create-doctor-profile', userId, fullName, speciality, phoneNumber, address),
  getDoctorProfile: (userId: number) => ipcRenderer.invoke('get-doctor-profile', userId),
  setPrescriptionPdf: (doctorId: number, pdfPath: string) => ipcRenderer.invoke('set-prescription-pdf', doctorId, pdfPath),
  //gestion des prescriptions
  addPrescription: (prescription: Prescription) => ipcRenderer.invoke('add-prescription', prescription),
  getPrescriptionById: (id: number) => ipcRenderer.invoke('get-prescription-by-id', id),
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


})
