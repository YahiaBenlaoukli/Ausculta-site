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
  countPatients: () => electron.ipcRenderer.invoke("count-patients")
  //gestion documents
});
