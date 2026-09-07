import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import type { Patient } from "../../../types/patient"
import type { DoctorProfile } from "../../../types/doctor"
import type { WaitingRoom as WaitingRoomState, WaitingRoomEntry } from "../../../types/waitingRoom"
import { useCurrentUser } from "../../hooks/useCurrentUser"
import { dateKey } from "../../components/Appointments/schedule"

/**
 * Who is in the practice right now.
 *
 * The desk checks people in; the doctor calls them through. Both seats poll the
 * same queue, so the doctor never has to ask who is outside and the desk never
 * has to interrupt to say.
 */

/** Same cadence as the print queue — fast enough to feel live, cheap enough to leave running. */
const POLL_MS = 5_000

type Appointment = {
    id: number
    patient_id: number
    appointment_datetime: string
    reason: string | null
    status: 'Scheduled' | 'Completed' | 'Cancelled' | 'No-Show'
    full_name: string
    phone_number: string
}

const EMPTY: WaitingRoomState = { waiting: [], inRoom: null, typicalMinutes: 20 }

/* ─── Icons, hand-drawn to match the sidebar's set ─── */
const IconFlag = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" />
    </svg>
)
const IconStethoscope = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" />
        <path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4" /><circle cx="20" cy="10" r="2" />
    </svg>
)
const IconX = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
)

export default function WaitingRoom() {
    const { t, i18n } = useTranslation()
    const navigate = useNavigate()
    const { isAssistant } = useCurrentUser()

    const [room, setRoom] = useState<WaitingRoomState>(EMPTY)
    const [loading, setLoading] = useState(true)
    const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null)
    const [todayAppointments, setTodayAppointments] = useState<Appointment[]>([])
    const [errorMessage, setErrorMessage] = useState("")
    const [busyId, setBusyId] = useState<number | null>(null)

    const [patientQuery, setPatientQuery] = useState("")
    const [patientResults, setPatientResults] = useState<Patient[]>([])

    // A ref, not state, so a landing poll never restarts the interval.
    const polling = useRef(false)

    const showError = useCallback((message: string) => {
        setErrorMessage(message)
        setTimeout(() => setErrorMessage(""), 4000)
    }, [])

    /* ══════════════════════ The poll ══════════════════════ */

    const refresh = useCallback(async () => {
        if (polling.current) return
        polling.current = true
        try {
            const data = await window.ipcRenderer.getWaitingRoom()
            // A client whose host is asleep resolves to the registry fallback,
            // so this is a shape check rather than an error path.
            setRoom(data && Array.isArray(data.waiting) ? data : EMPTY)
        } catch (error) {
            console.error("Failed to load the waiting room:", error)
        } finally {
            polling.current = false
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void refresh()
        const timer = setInterval(() => void refresh(), POLL_MS)
        return () => clearInterval(timer)
    }, [refresh])

    /* ══════════════════════ Today's calendar, for check-in ══════════════════════ */

    const loadToday = useCallback(async () => {
        if (!doctorProfile) return
        try {
            const rows = await window.ipcRenderer.getAppointmentsByDay(doctorProfile.id, dateKey(new Date()))
            setTodayAppointments(Array.isArray(rows) ? (rows as Appointment[]).filter(a => a.status === 'Scheduled') : [])
        } catch (error) {
            console.error("Failed to load today's appointments:", error)
            setTodayAppointments([])
        }
    }, [doctorProfile])

    useEffect(() => {
        let alive = true
        void (async () => {
            try {
                // The practice profile, not "my profile" — an assistant has no
                // doctor_profile row, and the calendar is keyed on this one.
                const result = await window.ipcRenderer.getPracticeDoctorProfile()
                if (alive && result.status === 'success' && result.data) setDoctorProfile(result.data)
            } catch (error) {
                console.error("Failed to load the practice profile:", error)
            }
        })()
        return () => { alive = false }
    }, [])

    useEffect(() => { void loadToday() }, [loadToday])

    /* Patient search for walk-ins, debounced like the consultation picker. */
    useEffect(() => {
        if (!patientQuery.trim()) {
            setPatientResults([])
            return
        }
        const timer = setTimeout(async () => {
            try {
                const results = await window.ipcRenderer.searchPatient(patientQuery)
                setPatientResults(results || [])
            } catch (error) {
                console.error("Patient search error:", error)
                setPatientResults([])
            }
        }, 300)
        return () => clearTimeout(timer)
    }, [patientQuery])

    /* Patients already in the queue must not be offered for check-in twice. */
    const queuedPatientIds = useMemo(() => {
        const ids = new Set(room.waiting.map(entry => entry.patientId))
        if (room.inRoom) ids.add(room.inRoom.patientId)
        return ids
    }, [room])

    const pendingArrivals = useMemo(
        () => todayAppointments.filter(a => !queuedPatientIds.has(a.patient_id)),
        [todayAppointments, queuedPatientIds]
    )

    /* ══════════════════════ Actions ══════════════════════ */

    const handleCheckIn = async (patientId: number, appointmentId?: number) => {
        setBusyId(patientId)
        try {
            const result = await window.ipcRenderer.checkInPatient(patientId, appointmentId)
            if (result.status === 'success') {
                setPatientQuery("")
                setPatientResults([])
                await refresh()
            } else {
                showError(result.message || t('waiting_room.errors.check_in_failed'))
            }
        } catch (error) {
            console.error("Check-in failed:", error)
            showError(t('waiting_room.errors.check_in_failed'))
        } finally {
            setBusyId(null)
        }
    }

    /* The doctor calls the patient through, then walks into their visit. The
       handoff is the same one the calendar uses, so the consultation page needs
       to know nothing about the waiting room. */
    const handleCallIn = async (entry: WaitingRoomEntry) => {
        setBusyId(entry.id)
        try {
            const result = await window.ipcRenderer.callPatientIn(entry.id)
            if (result.status !== 'success') {
                showError(result.message || t('waiting_room.errors.call_failed'))
                return
            }
            const patient = await window.ipcRenderer.getPatientById(entry.patientId)
            if (!patient) {
                showError(t('waiting_room.errors.call_failed'))
                return
            }
            navigate('/consultation', { state: { patient, appointmentId: entry.appointmentId ?? undefined } })
        } catch (error) {
            console.error("Failed to call the patient in:", error)
            showError(t('waiting_room.errors.call_failed'))
        } finally {
            setBusyId(null)
        }
    }

    const handlePriority = async (entry: WaitingRoomEntry) => {
        try {
            await window.ipcRenderer.setQueuePriority(entry.id, !entry.isPriority)
            await refresh()
        } catch (error) {
            console.error("Failed to set queue priority:", error)
        }
    }

    const handleRemove = async (entry: WaitingRoomEntry) => {
        if (!confirm(t('waiting_room.confirm_remove', { name: entry.patientName }))) return
        try {
            const result = await window.ipcRenderer.removeFromQueue(entry.id)
            if (result.status !== 'success') {
                // The usual reason is that the desk already recorded vitals, at
                // which point the visit is a record and only the doctor may undo it.
                showError(result.code === 'has_content'
                    ? t('waiting_room.errors.remove_has_content')
                    : result.message || t('waiting_room.errors.remove_failed'))
                return
            }
            await refresh()
        } catch (error) {
            console.error("Failed to remove from the queue:", error)
            showError(t('waiting_room.errors.remove_failed'))
        }
    }

    const openVitals = (entry: WaitingRoomEntry) => navigate(`/consultation/${entry.id}`)

    /* ══════════════════════ Rendering ══════════════════════ */

    const locale = i18n.language || 'fr'

    const vitalsSummary = (entry: WaitingRoomEntry) => {
        const parts: string[] = []
        if (entry.bloodPressure) parts.push(`TA ${entry.bloodPressure}`)
        if (entry.weight != null) parts.push(`${entry.weight} kg`)
        if (entry.temperature != null) parts.push(`${entry.temperature} °C`)
        return parts.join(' · ')
    }

    const waitTone = (minutes: number) =>
        minutes >= 45 ? 'bg-red-50 text-red-600 border-red-200'
            : minutes >= 20 ? 'bg-amber-50 text-amber-600 border-amber-200'
                : 'bg-gray-50 text-gray-500 border-gray-200'

    return (
        <div className="space-y-5 text-navy">
            {/* ── Page header ── */}
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-navy">{t('waiting_room.title')}</h1>
                    <p className="text-sm text-navy/50 mt-0.5">{t('waiting_room.subtitle')}</p>
                </div>
                <span className="text-sm font-bold text-navy/40">
                    {t('waiting_room.count', { count: room.waiting.length })}
                </span>
            </div>

            <div className="max-w-4xl mx-auto space-y-5">

                {errorMessage && (
                    <div className="p-3 text-center bg-red-50 text-red-600 font-semibold rounded-xl border border-red-200">
                        {errorMessage}
                    </div>
                )}

                {/* ── In the room ── */}
                {room.inRoom && (
                    <div className="bg-white p-6 rounded-3xl border border-white/40 shadow-sm">
                        <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">
                            {t('waiting_room.in_room')}
                        </h4>
                        <div className="flex items-center justify-between p-4 rounded-2xl bg-pink/5 border border-pink/20 relative overflow-hidden">
                            <div className="absolute start-0 top-0 bottom-0 w-1.5 bg-pink" />
                            <div className="ps-3">
                                <span className="font-bold text-navy block">{room.inRoom.patientName}</span>
                                <span className="text-xs text-gray-500">
                                    {room.inRoom.calledAt && (
                                        <>
                                            {t('waiting_room.started_at', {
                                                time: new Date(room.inRoom.calledAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
                                            })}
                                            {' · '}
                                            {t('waiting_room.minutes', { count: room.inRoom.inRoomMinutes })}
                                            {' · '}
                                        </>
                                    )}
                                    {/* The wait BEFORE they were seen — a different figure, and
                                        the one that answers "were they kept long?" */}
                                    <span className="text-gray-400">
                                        {t('waiting_room.waited_before', { count: room.inRoom.waitedMinutes })}
                                    </span>
                                </span>
                            </div>
                            <button
                                onClick={() => openVitals(room.inRoom!)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-pink/10 text-pink hover:bg-pink hover:text-white text-[11px] font-bold transition-colors cursor-pointer border-none"
                            >
                                <IconStethoscope />
                                {t('waiting_room.actions.open_visit')}
                            </button>
                        </div>
                    </div>
                )}

                {/* ── The queue ── */}
                <div className="space-y-3 bg-white p-6 rounded-3xl border border-white/40 shadow-sm">
                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">
                        {t('waiting_room.queue')}
                    </h4>

                    {loading ? (
                        <div className="text-center py-10 text-gray-400">{t('waiting_room.loading')}</div>
                    ) : room.waiting.length === 0 ? (
                        <div className="text-center py-10 text-gray-400 text-sm">{t('waiting_room.empty')}</div>
                    ) : (
                        <div className="space-y-2">
                            {room.waiting.map((entry, index) => {
                                const vitals = vitalsSummary(entry)
                                return (
                                    <div
                                        key={entry.id}
                                        className="w-full flex flex-col md:flex-row md:items-center justify-between p-4 rounded-2xl bg-gray-50/70 border border-gray-150 text-gray-600 shadow-sm relative overflow-hidden transition-all duration-200"
                                    >
                                        <div className={`absolute start-0 top-0 bottom-0 w-1.5 ${entry.isPriority ? 'bg-pink' : 'bg-navy'}`} />

                                        <div className="ps-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-6">
                                            <span className="text-sm font-bold text-gray-400 w-8 flex items-center">
                                                {entry.isPriority ? <IconFlag className="w-4 h-4 text-pink" /> : index + 1}
                                            </span>
                                            <div>
                                                <span className="font-bold text-navy block">{entry.patientName}</span>
                                                <span className="text-xs text-gray-500 block">
                                                    {entry.appointmentTime
                                                        ? t('waiting_room.scheduled_at', { time: entry.appointmentTime })
                                                        : t('waiting_room.walk_in')}
                                                    {' · '}
                                                    {t('waiting_room.arrived_at', {
                                                        time: new Date(entry.arrivedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
                                                    })}
                                                </span>
                                                {vitals && <span className="text-xs text-gray-400 block">{vitals}</span>}
                                            </div>
                                        </div>

                                        <div className="mt-2 md:mt-0 flex items-center gap-3 self-end md:self-auto">
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${waitTone(entry.waitedMinutes)}`}>
                                                {t('waiting_room.waited', { count: entry.waitedMinutes })}
                                            </span>
                                            {/* The same estimate the waiting-room TV shows, so the
                                                desk answers "how long?" with the number the patient
                                                has already read off the screen. */}
                                            <span className="text-[10px] font-bold text-gray-400 tabular-nums" title={t('waiting_room.eta_hint')}>
                                                {entry.etaMinutes > 0
                                                    ? t('waiting_room.eta', { count: entry.etaMinutes })
                                                    : t('waiting_room.eta_next')}
                                            </span>

                                            {isAssistant ? (
                                                <button
                                                    onClick={() => openVitals(entry)}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-navy/5 text-navy hover:bg-navy hover:text-white text-[11px] font-bold transition-colors cursor-pointer border-none"
                                                >
                                                    {t('waiting_room.actions.vitals')}
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => handleCallIn(entry)}
                                                    disabled={busyId === entry.id}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-pink/10 text-pink hover:bg-pink hover:text-white text-[11px] font-bold transition-colors cursor-pointer border-none disabled:opacity-50"
                                                >
                                                    <IconStethoscope />
                                                    {t('waiting_room.actions.call_in')}
                                                </button>
                                            )}

                                            <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-full p-0.5">
                                                <button
                                                    onClick={() => handlePriority(entry)}
                                                    title={entry.isPriority ? t('waiting_room.actions.unprioritise') : t('waiting_room.actions.prioritise')}
                                                    className={`p-1.5 rounded-full cursor-pointer transition-all ${entry.isPriority ? 'text-pink bg-pink/10' : 'text-gray-400 hover:bg-pink/5 hover:text-pink'}`}
                                                >
                                                    <IconFlag />
                                                </button>
                                                <button
                                                    onClick={() => handleRemove(entry)}
                                                    title={t('waiting_room.actions.remove')}
                                                    className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-red-500 cursor-pointer transition-all"
                                                >
                                                    <IconX />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* ── Check someone in ── */}
                <div className="space-y-3 bg-white p-6 rounded-3xl border border-white/40 shadow-sm">
                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">
                        {t('waiting_room.check_in')}
                    </h4>

                    {pendingArrivals.length > 0 && (
                        <div className="space-y-2 mb-4">
                            {pendingArrivals.map(appointment => (
                                <button
                                    key={appointment.id}
                                    onClick={() => handleCheckIn(appointment.patient_id, appointment.id)}
                                    disabled={busyId === appointment.patient_id}
                                    className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-white border border-gray-100 hover:border-pink/50 hover:bg-pink/5 transition-all cursor-pointer text-start disabled:opacity-50"
                                >
                                    <span className="flex items-center gap-4">
                                        <span className="text-sm font-bold text-gray-400 w-12">
                                            {appointment.appointment_datetime.split('T')[1]?.substring(0, 5)}
                                        </span>
                                        <span className="font-bold text-navy">{appointment.full_name}</span>
                                    </span>
                                    <span className="text-[11px] font-bold text-pink">{t('waiting_room.actions.arrived')}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Walk-in: anyone not on today's calendar. */}
                    <input
                        type="text"
                        value={patientQuery}
                        onChange={event => setPatientQuery(event.target.value)}
                        placeholder={t('waiting_room.search_placeholder')}
                        className="w-full px-4 py-3 rounded-2xl bg-gray-50 border border-gray-100 text-sm text-navy outline-none focus:border-pink/50 focus:bg-white transition-all"
                    />

                    {patientResults.length > 0 && (
                        <div className="space-y-2 mt-2">
                            {patientResults.map(patient => {
                                const alreadyHere = queuedPatientIds.has(patient.id)
                                return (
                                    <button
                                        key={patient.id}
                                        onClick={() => handleCheckIn(patient.id)}
                                        disabled={alreadyHere || busyId === patient.id}
                                        className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-white border border-gray-100 hover:border-pink/50 hover:bg-pink/5 transition-all cursor-pointer text-start disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-gray-100 disabled:hover:bg-white"
                                    >
                                        <span className="font-bold text-navy">{patient.fullName}</span>
                                        <span className="text-[11px] font-bold text-pink">
                                            {alreadyHere ? t('waiting_room.already_here') : t('waiting_room.actions.arrived')}
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
