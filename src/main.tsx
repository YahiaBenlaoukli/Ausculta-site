import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'

import Layout from './components/Layout/Layout'
import Dashboard from './pages/Dashboard/Dashboard'
import Patients from './pages/Patients/Patients'
import PatientDetails from './pages/PatientDetails/PatientDetails'
import Prescriptions from './pages/Prescriptions/Prescriptions'
import Consultation from './pages/Consultation/Consultation'
import Appointments from './pages/Appointments/Appointments'
import Authentification from './pages/Authentification/Authentification'
import Documents from './pages/Documents/Documents'
import Statistics from './pages/Statistics/Statistics'
import Parameters from './pages/Parameters/Parameters'
import TrialGate from './components/TrialGate/TrialGate'
import UpdateNotice from './components/UpdateNotice/UpdateNotice'
import './services/i18n';
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TrialGate>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Authentification />} />

          <Route path="/dashboard" element={<Layout><Dashboard /></Layout>} />
          <Route path="/patients" element={<Layout><Patients /></Layout>} />
          <Route path="/patients/:id" element={<Layout><PatientDetails /></Layout>} />
          <Route path="/consultation" element={<Layout><Consultation /></Layout>} />
          {/* Same page, opened on a specific visit (resume a draft, review a past one). */}
          <Route path="/consultation/:id" element={<Layout><Consultation /></Layout>} />
          <Route path="/prescriptions" element={<Layout><Prescriptions /></Layout>} />
          <Route path="/documents" element={<Layout><Documents /></Layout>} />
          <Route path="/appointments" element={<Layout><Appointments /></Layout>} />
          <Route path="/statistics" element={<Layout><Statistics /></Layout>} />
          <Route path="/settings" element={<Layout><Parameters /></Layout>} />
        </Routes>
      </HashRouter>
      {/* App-wide, but inside TrialGate so it never covers the activation
          screen — an expired licence is the more urgent thing to deal with. */}
      <UpdateNotice />
    </TrialGate>
  </React.StrictMode>,
)

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message)
})
