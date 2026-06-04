import { ipcRenderer, contextBridge } from 'electron'
import type { Patient } from '../types/patient'

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


})
