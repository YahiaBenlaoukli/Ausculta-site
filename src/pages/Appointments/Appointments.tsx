import { useEffect, useState, useMemo, useCallback } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import type { Patient } from "../../../types/patient"
import type { DoctorProfile } from "../../../types/doctor"
import BookingModal from "../../components/Appointments/BookingModal"
import { TIME_SLOTS, dateKey } from "../../components/Appointments/schedule"

type Appointment = {
    id: number;
    patient_id: number;
    doctor_id: number;
    appointment_datetime: string;
    duration_minutes: number;
    reason: string | null;
    status: 'Scheduled' | 'Completed' | 'Cancelled' | 'No-Show';
    full_name: string;
    phone_number: string;
}

export default function Appointments() {
    const location = useLocation();
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();
    const locale = i18n.language || 'fr';

    const [currentUserId, setCurrentUserId] = useState<number | null>(null);
    const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [loading, setLoading] = useState(true);

    // Booking Modal State — the form itself lives in <BookingModal />.
    const [showModal, setShowModal] = useState(false);
    const [selectedTime, setSelectedTime] = useState("11:00");
    const [handoffPatient, setHandoffPatient] = useState<Patient | null>(null);
    const [successMessage, setSuccessMessage] = useState("");

    // Load auth and doctor info on mount
    useEffect(() => {
        (async () => {
            try {
                const auth = await window.ipcRenderer.checkAuth();
                if (auth?.status === 'success' && auth.user?.id) {
                    setCurrentUserId(auth.user.id);
                } else {
                    window.location.hash = '/';
                }
            } catch (error) {
                console.error("Auth check failed:", error);
                window.location.hash = '/';
            }
        })();
    }, []);

    // Load Doctor Profile
    useEffect(() => {
        if (currentUserId !== null) {
            (async () => {
                try {
                    const profileResult = await window.ipcRenderer.getPracticeDoctorProfile();
                    if (profileResult.status === 'success' && profileResult.data) {
                        setDoctorProfile(profileResult.data);
                    }
                } catch (error) {
                    console.error("Failed to load doctor profile:", error);
                }
            })();
        }
    }, [currentUserId]);

    // Format selected date for query YYYY-MM-DD
    const selectedDateQueryStr = useMemo(() => dateKey(selectedDate), [selectedDate]);

    // Load Appointments for selected day
    const loadAppointments = useCallback(async () => {
        if (!doctorProfile) return;
        setLoading(true);
        try {
            const data = await window.ipcRenderer.getAppointmentsByDay(doctorProfile.id, selectedDateQueryStr);
            if (Array.isArray(data)) {
                setAppointments(data as Appointment[]);
            } else {
                setAppointments([]);
            }
        } catch (error) {
            console.error("Failed to load appointments:", error);
            setAppointments([]);
        } finally {
            setLoading(false);
        }
    }, [doctorProfile, selectedDateQueryStr]);

    useEffect(() => {
        if (doctorProfile) {
            loadAppointments();
        }
    }, [doctorProfile, loadAppointments]);

    // Handle redirection parameter
    useEffect(() => {
        if (location.state && location.state.patient) {
            setHandoffPatient(location.state.patient);
            setShowModal(true);
            // Clear location state to avoid reopen on refresh
            window.history.replaceState({}, document.title);
        }
    }, [location]);

    // Get the Monday of the current week to show Mon-Sun weekly view
    const getMonday = (d: Date) => {
        const date = new Date(d);
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(date.setDate(diff));
    };

    const days = useMemo(() => {
        const startOfWeek = getMonday(selectedDate);
        const list = [];
        for (let i = 0; i < 7; i++) {
            const nextDay = new Date(startOfWeek);
            nextDay.setDate(startOfWeek.getDate() + i);
            list.push(nextDay);
        }
        return list;
    }, [selectedDate]);

    // Check match helper
    const getSlotAppointment = (slot: string) => {
        return appointments.find(app => {
            if (!app.appointment_datetime) return false;
            const parts = app.appointment_datetime.split('T');
            if (parts.length < 2) return false;
            const appTime = parts[1].substring(0, 5);
            return appTime === slot;
        });
    };

    // Open Modal
    const openBookingModal = (slot: string | null) => {
        if (slot) setSelectedTime(slot);
        setShowModal(true);
    };

    // Close Modal
    const closeBookingModal = () => {
        setShowModal(false);
        setHandoffPatient(null);
    };

    const handleBooked = () => {
        setSuccessMessage(t('appointments.success_message'));
        setTimeout(() => setSuccessMessage(""), 3000);
        loadAppointments();
    };

    // Update Status
    const handleUpdateStatus = async (id: number, status: string) => {
        try {
            const result = await window.ipcRenderer.updateAppointment(id, status);
            if (result.status === "success") {
                loadAppointments();
            }
        } catch (error) {
            console.error("Failed to update status:", error);
        }
    };

    // Hand the booking over to the consultation page, which opens the visit
    // record linked to it and completes the appointment when the doctor is done.
    const handleStartConsultation = async (appointment: Appointment) => {
        try {
            const patient = await window.ipcRenderer.getPatientById(appointment.patient_id);
            if (!patient) return;
            navigate('/consultation', { state: { patient, appointmentId: appointment.id } });
        } catch (error) {
            console.error("Failed to start consultation:", error);
        }
    };

    // Delete Appointment
    const handleDeleteAppointment = async (id: number) => {
        if (!confirm(t('appointments.confirm_delete'))) return;
        try {
            const result = await window.ipcRenderer.deleteAppointment(id);
            if (result.status === "success") {
                loadAppointments();
            }
        } catch (error) {
            console.error("Failed to delete appointment:", error);
        }
    };

    // Check if the selected date is in the past (before today, ignoring time)
    const isPastDay = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const checkDate = new Date(selectedDate);
        checkDate.setHours(0, 0, 0, 0);
        return checkDate < today;
    }, [selectedDate]);

    return (
        <div className="space-y-5 text-navy">
            {/* ── Page Header ── */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-navy">{t('appointments.title')}</h1>
                    <p className="text-sm text-navy/50 mt-0.5">
                        {t('appointments.subtitle')}
                    </p>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-4xl mx-auto space-y-5">

                {/* Day Navigator */}
                <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-white/40 shadow-sm mb-4">
                    <button
                        onClick={() => {
                            const prev = new Date(selectedDate);
                            prev.setDate(selectedDate.getDate() - 1);
                            setSelectedDate(prev);
                        }}
                        className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-50 border border-gray-100 hover:bg-gray-100 text-gray-600 hover:text-pink hover:border-pink cursor-pointer transition-all"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>
                    <h3 className="text-lg font-bold text-navy capitalize">
                        {selectedDate.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </h3>
                    <button
                        onClick={() => {
                            const next = new Date(selectedDate);
                            next.setDate(selectedDate.getDate() + 1);
                            setSelectedDate(next);
                        }}
                        className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-50 border border-gray-100 hover:bg-gray-100 text-gray-600 hover:text-pink hover:border-pink cursor-pointer transition-all"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <polyline points="9 6 15 12 9 18" />
                        </svg>
                    </button>
                </div>

                {/* Weekly Stripe Selector */}
                <div className="flex justify-between items-center bg-white p-4 md:p-6 rounded-3xl border border-white/40 shadow-sm mb-6">
                    {days.map((d, index) => {
                        const isSelected = d.toDateString() === selectedDate.toDateString();
                        const dayName = d.toLocaleDateString(locale, { weekday: 'short' });
                        const dateNum = d.getDate();
                        return (
                            <div key={index} className="flex flex-col items-center gap-1 flex-1">
                                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{dayName}</span>
                                <button
                                    onClick={() => setSelectedDate(d)}
                                    className={`w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full text-sm md:text-base font-bold transition-all duration-200 cursor-pointer ${
                                        isSelected
                                            ? 'bg-pink text-white shadow-md shadow-pink/20 scale-105'
                                            : 'border border-gray-100 text-navy hover:border-pink/50 hover:bg-gray-50'
                                    }`}
                                >
                                    {dateNum}
                                </button>
                            </div>
                        );
                    })}
                </div>

                {/* Notification toast if successful */}
                {successMessage && (
                    <div className="p-3 mb-4 text-center bg-green-50 text-green-700 font-semibold rounded-xl border border-green-200 animate-fade-in">
                        {successMessage}
                    </div>
                )}

                {/* Daily Slots List */}
                <div className="space-y-3 bg-white p-6 rounded-3xl border border-white/40 shadow-sm">
                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">{t('appointments.planning_day')}</h4>
                    
                    {loading ? (
                        <div className="text-center py-10 text-gray-400">{t('appointments.loading')}</div>
                    ) : (
                        <div className="space-y-2">
                            {TIME_SLOTS.map((slot) => {
                                const app = getSlotAppointment(slot);
                                if (!app) {
                                    if (isPastDay) {
                                        return (
                                            <div
                                                key={slot}
                                                className="w-full flex items-center justify-center py-3.5 px-6 rounded-2xl bg-gray-50 border border-gray-150 text-gray-400 text-sm font-bold tracking-wider cursor-not-allowed select-none"
                                            >
                                                {slot}
                                            </div>
                                        );
                                    }
                                    return (
                                        <button
                                            key={slot}
                                            onClick={() => openBookingModal(slot)}
                                            className="w-full flex items-center justify-center py-3.5 px-6 rounded-2xl bg-white border border-gray-100 text-pink hover:border-pink/50 hover:bg-pink/5 hover:scale-[1.005] transition-all cursor-pointer shadow-sm text-sm font-bold tracking-wider"
                                        >
                                            {slot}
                                        </button>
                                    );
                                }
                                return (
                                    <div
                                        key={slot}
                                        className="w-full flex flex-col md:flex-row md:items-center justify-between p-4 rounded-2xl bg-gray-50/70 border border-gray-150 text-gray-600 shadow-sm relative overflow-hidden transition-all duration-200"
                                    >
                                        {/* Status side indicator */}
                                        <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${
                                            app.status === 'Completed' ? 'bg-green-500' :
                                            app.status === 'Cancelled' ? 'bg-red-400' :
                                            app.status === 'No-Show' ? 'bg-amber-400' : 'bg-navy'
                                        }`} />

                                        {/* Meta */}
                                        <div className="pl-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-6">
                                            <span className="text-sm font-bold text-gray-400 w-12">{slot}</span>
                                            <div>
                                                <span className="font-bold text-navy block">{app.full_name}</span>
                                                {app.reason && (
                                                    <span className="text-xs text-gray-500 block truncate max-w-md">{app.reason}</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Status Badge & Controls */}
                                        <div className="mt-2 md:mt-0 flex items-center gap-3 self-end md:self-auto">
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                                                app.status === 'Completed' ? 'bg-green-50 text-green-700 border border-green-200' :
                                                app.status === 'Cancelled' ? 'bg-red-50 text-red-600 border border-red-200' :
                                                app.status === 'No-Show' ? 'bg-amber-50 text-amber-600 border border-amber-200' :
                                                'bg-pink/5 text-pink border border-pink/20'
                                            }`}>
                                                {app.status === 'Scheduled' ? t('appointments.status.scheduled') : app.status === 'Completed' ? t('appointments.status.completed') : app.status === 'Cancelled' ? t('appointments.status.cancelled') : t('appointments.status.no_show')}
                                            </span>

                                            {/* Opening the consultation records the visit itself and
                                                marks the appointment completed on finish. */}
                                            {!isPastDay && app.status === 'Scheduled' && (
                                                <button
                                                    onClick={() => handleStartConsultation(app)}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-pink/10 text-pink hover:bg-pink hover:text-white text-[11px] font-bold transition-colors cursor-pointer border-none"
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" />
                                                        <path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4" />
                                                        <circle cx="20" cy="10" r="2" />
                                                    </svg>
                                                    {t('appointments.start_consultation')}
                                                </button>
                                            )}

                                            {!isPastDay && (
                                                <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-full p-0.5">
                                                    {app.status === 'Scheduled' && (
                                                        <button
                                                            onClick={() => handleUpdateStatus(app.id, 'Completed')}
                                                            title={t('appointments.actions.complete')}
                                                            className="p-1.5 rounded-full hover:bg-green-50 text-green-600 cursor-pointer transition-all"
                                                        >
                                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                                                <polyline points="20 6 9 17 4 12" />
                                                            </svg>
                                                        </button>
                                                    )}
                                                    {app.status !== 'Cancelled' && (
                                                        <button
                                                            onClick={() => handleUpdateStatus(app.id, 'Cancelled')}
                                                            title={t('appointments.actions.cancel')}
                                                            className="p-1.5 rounded-full hover:bg-red-50 text-red-500 cursor-pointer transition-all"
                                                        >
                                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                                            </svg>
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleDeleteAppointment(app.id)}
                                                        title={t('appointments.actions.delete')}
                                                        className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-red-500 cursor-pointer transition-all"
                                                    >
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                                            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Book appointment CTA button */}
                    {!isPastDay && (
                        <div className="flex justify-center mt-6">
                            <button
                                onClick={() => openBookingModal(null)}
                                className="w-full max-w-md py-4 rounded-full bg-pink hover:bg-pink-dark text-white font-bold transition-all shadow-lg shadow-pink/20 flex items-center justify-center gap-2 cursor-pointer hover:scale-[1.02]"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                                </svg>
                                <span>{t('appointments.book_button')}</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <BookingModal
                open={showModal}
                date={selectedDate}
                doctorId={doctorProfile?.id ?? null}
                initialTime={selectedTime}
                initialPatient={handoffPatient}
                onClose={closeBookingModal}
                onBooked={handleBooked}
            />
        </div>
    )
}