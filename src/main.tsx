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
import WaitingRoom from './pages/WaitingRoom/WaitingRoom'
import QueueDisplay from './pages/QueueDisplay/QueueDisplay'
import Authentification from './pages/Authentification/Authentification'
import Documents from './pages/Documents/Documents'
import Medications from './pages/Medications/Medications'
import Statistics from './pages/Statistics/Statistics'
import Parameters from './pages/Parameters/Parameters'
import TrialGate from './components/TrialGate/TrialGate'
import DoctorOnly from './components/Auth/DoctorOnly'
import HostBanner from './components/HostBanner/HostBanner'
import UpdateNotice from './components/UpdateNotice/UpdateNotice'
import './services/i18n';
import './index.css'

/**
 * The waiting-room TV runs the same bundle at '#/display', in its own window.
 *
 * Branching here rather than adding a route, because everything a route would
 * inherit is wrong for a screen facing a room of patients: UpdateNotice and
 * HostBanner are mounted OUTSIDE the router and so cannot hide themselves
 * per-route, and TrialGate would put a licence-activation page on the TV. The
 * board window is opened at this hash and never navigates, so this is decided
 * once at mount.
 *
 * Bypassing TrialGate is not a licensing hole: the board renders a queue that
 * cannot be filled without the application, which is still gated.
 */
const isQueueDisplay = window.location.hash.startsWith('#/display')

ReactDOM.createRoot(document.getElementById('root')!).render(
  isQueueDisplay ? (
    <QueueDisplay />
  ) : (
  <React.StrictMode>
    <TrialGate>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Authentification />} />

          <Route path="/dashboard" element={<Layout><Dashboard /></Layout>} />
          <Route path="/patients" element={<Layout><Patients /></Layout>} />
          <Route path="/patients/:id" element={<Layout><PatientDetails /></Layout>} />
          {/* Not doctor-only: the front desk is who fills this queue. */}
          <Route path="/waiting-room" element={<Layout><WaitingRoom /></Layout>} />
          <Route path="/consultation" element={<Layout><Consultation /></Layout>} />
          {/* Same page, opened on a specific visit (resume a draft, review a past one). */}
          <Route path="/consultation/:id" element={<Layout><Consultation /></Layout>} />
          {/* Doctor-only, mirroring the entries the sidebar hides from an
              assistant. The main process refuses the channels regardless; this
              is so the pages are not reachable by editing the hash. */}
          <Route path="/prescriptions" element={<DoctorOnly><Layout><Prescriptions /></Layout></DoctorOnly>} />
          <Route path="/medications" element={<Layout><Medications /></Layout>} />
          <Route path="/documents" element={<Layout><Documents /></Layout>} />
          <Route path="/appointments" element={<Layout><Appointments /></Layout>} />
          <Route path="/statistics" element={<DoctorOnly><Layout><Statistics /></Layout></DoctorOnly>} />
          <Route path="/settings" element={<DoctorOnly><Layout><Parameters /></Layout></DoctorOnly>} />
        </Routes>
      </HashRouter>
      {/* App-wide, but inside TrialGate so it never covers the activation
          screen — an expired licence is the more urgent thing to deal with. */}
      <UpdateNotice />
      {/* Outside the router too: losing the host breaks every route at once,
          including the login screen, so it cannot live in Layout. */}
      <HostBanner />
    </TrialGate>
  </React.StrictMode>
  ),
)

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message)
})
