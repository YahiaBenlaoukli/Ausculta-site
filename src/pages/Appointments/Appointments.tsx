import { useEffect, useState, useMemo } from "react"
import { useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next"
import type { Patient } from "../../../types/patient"
import type { DoctorProfile } from "../../../types/doctor"

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

const TIME_SLOTS = [
    "08:00", "08:30", "09:00", "09:30", "10:00", "10:30",
    "11:00", "11:30", "12:00", "12:30", "13:00", "13:30",
    "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30"
];

export default function Appointments() {
    const location = useLocation();
    const { t, i18n } = useTranslation();
    const locale = i18n.language || 'fr';

    const [currentUserId, setCurrentUserId] = useState<number | null>(null);
    const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [loading, setLoading] = useState(true);

    // Booking Modal State
    const [showModal, setShowModal] = useState(false);
    const [selectedTime, setSelectedTime] = useState("11:00");
    const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
    const [patientSearchQuery, setPatientSearchQuery] = useState("");
    const [patientSearchResults, setPatientSearchResults] = useState<Patient[]>([]);
    const [isSearchingPatient, setIsSearchingPatient] = useState(false);
    const [reason, setReason] = useState("");
    const [duration, setDuration] = useState(30);
    const [isSaving, setIsSaving] = useState(false);
    const [successMessage, setSuccessMessage] = useState("");
    const [errorMessage, setErrorMessage] = useState("");

    // Load auth and doctor info on mount
    useEffect(() => {
        (async () => {
            try {
                const auth = await (window as any).ipcRenderer.checkAuth();
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
                    const profileResult = await (window as any).ipcRenderer.invoke('get-doctor-profile', currentUserId);
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
    const selectedDateQueryStr = useMemo(() => {
        const yyyy = selectedDate.getFullYear();
        const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
        const dd = String(selectedDate.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }, [selectedDate]);

    // Load Appointments for selected day
    const loadAppointments = async () => {
        if (!doctorProfile) return;
        setLoading(true);
        try {
            const data = await (window as any).ipcRenderer.getAppointmentsByDay(doctorProfile.id, selectedDateQueryStr);
            if (Array.isArray(data)) {
                setAppointments(data);
            } else {
                setAppointments([]);
            }
        } catch (error) {
            console.error("Failed to load appointments:", error);
            setAppointments([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (doctorProfile) {
            loadAppointments();
        }
    }, [doctorProfile, selectedDateQueryStr]);

    // Handle redirection parameter
    useEffect(() => {
        if (location.state && location.state.patient) {
            setSelectedPatient(location.state.patient);
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

    // Patient Search (Debounced)
    useEffect(() => {
        if (!patientSearchQuery.trim() || selectedPatient) {
            if (!patientSearchQuery.trim()) {
                setPatientSearchResults([]);
            }
            return;
        }
        const timer = setTimeout(async () => {
            setIsSearchingPatient(true);
            try {
                const res = await (window as any).ipcRenderer.invoke('search-patients', patientSearchQuery);
                if (Array.isArray(res)) {
                    setPatientSearchResults(res);
                } else {
                    setPatientSearchResults([]);
                }
            } catch (error) {
                console.error("Patient search failed:", error);
                setPatientSearchResults([]);
            } finally {
                setIsSearchingPatient(false);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [patientSearchQuery, selectedPatient]);

    // Open Modal
    const openBookingModal = (slot: string | null) => {
        if (slot) setSelectedTime(slot);
        setShowModal(true);
    };

    // Close Modal
    const closeBookingModal = () => {
        setShowModal(false);
        setPatientSearchQuery("");
        setPatientSearchResults([]);
        setSelectedPatient(null);
        setReason("");
        setDuration(30);
        setErrorMessage("");
    };

    // Book Appointment handler
    const handleBookAppointment = async () => {
        if (!selectedPatient || !doctorProfile) return;
        setIsSaving(true);
        setErrorMessage("");
        try {
            const datetimeStr = `${selectedDateQueryStr}T${selectedTime}:00`;
            const result = await (window as any).ipcRenderer.bookAppointment(
                selectedPatient.id,
                doctorProfile.id,
                datetimeStr,
                duration,
                reason
            );

            if (result.status === "success") {
                setSuccessMessage(t('appointments.success_message'));
                setTimeout(() => setSuccessMessage(""), 3000);
                closeBookingModal();
                loadAppointments();
            } else {
                setErrorMessage(result.message || "Erreur de réservation");
            }
        } catch (error) {
            setErrorMessage((error as Error).message);
        } finally {
            setIsSaving(false);
        }
    };

    // Update Status
    const handleUpdateStatus = async (id: number, status: string) => {
        try {
            const result = await (window as any).ipcRenderer.updateAppointment(id, status);
            if (result.status === "success") {
                loadAppointments();
            }
        } catch (error) {
            console.error("Failed to update status:", error);
        }
    };

    // Delete Appointment
    const handleDeleteAppointment = async (id: number) => {
        if (!confirm(t('appointments.confirm_delete'))) return;
        try {
            const result = await (window as any).ipcRenderer.deleteAppointment(id);
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
        <div className="space-y-5 text-[#1E2A56]">
            {/* ── Page Header ── */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-[#1E2A56]">{t('appointments.title')}</h1>
                    <p className="text-sm text-[#1E2A56]/50 mt-0.5">
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
                        className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-50 border border-gray-100 hover:bg-gray-100 text-gray-600 hover:text-[#e91e8c] hover:border-[#e91e8c] cursor-pointer transition-all"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>
                    <h3 className="text-lg font-bold text-[#1E2A56] capitalize">
                        {selectedDate.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </h3>
                    <button
                        onClick={() => {
                            const next = new Date(selectedDate);
                            next.setDate(selectedDate.getDate() + 1);
                            setSelectedDate(next);
                        }}
                        className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-50 border border-gray-100 hover:bg-gray-100 text-gray-600 hover:text-[#e91e8c] hover:border-[#e91e8c] cursor-pointer transition-all"
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
                                            ? 'bg-[#e91e8c] text-white shadow-md shadow-[#e91e8c]/20 scale-105'
                                            : 'border border-gray-100 text-[#1E2A56] hover:border-[#e91e8c]/50 hover:bg-gray-50'
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
                                            className="w-full flex items-center justify-center py-3.5 px-6 rounded-2xl bg-white border border-gray-100 text-[#e91e8c] hover:border-[#e91e8c]/50 hover:bg-[#e91e8c]/5 hover:scale-[1.005] transition-all cursor-pointer shadow-sm text-sm font-bold tracking-wider"
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
                                            app.status === 'Cancelled' ? 'bg-red-450' :
                                            app.status === 'No-Show' ? 'bg-amber-400' : 'bg-[#1E2A56]'
                                        }`} />

                                        {/* Meta */}
                                        <div className="pl-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-6">
                                            <span className="text-sm font-bold text-gray-400 w-12">{slot}</span>
                                            <div>
                                                <span className="font-bold text-[#1E2A56] block">{app.full_name}</span>
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
                                                'bg-[#e91e8c]/5 text-[#e91e8c] border border-[#e91e8c]/20'
                                            }`}>
                                                {app.status === 'Scheduled' ? t('appointments.status.scheduled') : app.status === 'Completed' ? t('appointments.status.completed') : app.status === 'Cancelled' ? t('appointments.status.cancelled') : t('appointments.status.no_show')}
                                            </span>

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
                                className="w-full max-w-md py-4 rounded-full bg-[#e91e8c] hover:bg-[#be185d] text-white font-bold transition-all shadow-lg shadow-[#e91e8c]/20 flex items-center justify-center gap-2 cursor-pointer hover:scale-[1.02]"
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

            {/* Booking Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 bg-[#1E2A56]/40 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-lg overflow-hidden border border-white/20 animate-scale-in flex flex-col max-h-[90vh]">
                        {/* Modal Header */}
                        <div className="bg-white px-6 pt-6 pb-2 flex items-start justify-between">
                            <div>
                                <h3 className="font-bold text-[#1E2A56] text-xl md:text-2xl">{t('appointments.new_appointment')}</h3>
                                <p className="text-xs md:text-sm text-gray-400 mt-1">{t('appointments.new_appointment_subtitle')}</p>
                            </div>
                            <button onClick={closeBookingModal} className="text-gray-400 hover:text-gray-600 cursor-pointer p-1">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6 overflow-y-auto space-y-4 flex-1">
                            {errorMessage && (
                                <div className="p-3 text-sm bg-red-50 text-red-700 rounded-xl border border-red-150">
                                    {errorMessage}
                                </div>
                            )}

                            {/* Grid: Date & Time Slot */}
                            <div className="grid grid-cols-2 gap-4">
                                {/* Date info */}
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">{t('appointments.date_label')}</label>
                                    <input
                                        type="text"
                                        readOnly
                                        value={selectedDate.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                        className="w-full p-3.5 bg-gray-50 border border-gray-200/80 rounded-2xl font-medium text-gray-600 focus:outline-none"
                                    />
                                </div>

                                {/* Time Slot Picker */}
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">{t('appointments.slot_label')}</label>
                                    <select
                                        value={selectedTime}
                                        onChange={(e) => setSelectedTime(e.target.value)}
                                        className="w-full p-3.5 bg-gray-50/50 hover:bg-gray-50 border border-gray-200/80 rounded-2xl font-medium text-[#1E2A56] focus:border-[#e91e8c] focus:ring-1 focus:ring-[#e91e8c] focus:bg-white outline-none transition-all"
                                    >
                                        {TIME_SLOTS.map((t) => (
                                            <option key={t} value={t}>{t}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Patient Search & Autocomplete */}
                            <div className="relative">
                                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">{t('appointments.patient_label')}</label>
                                {selectedPatient ? (
                                    <div className="p-4 bg-[#e91e8c]/5 border border-[#e91e8c]/25 rounded-2xl flex items-center justify-between">
                                        <div>
                                            <span className="font-bold text-[#1E2A56] block">{selectedPatient.fullName}</span>
                                            <span className="text-xs text-gray-500 block">Né(e) le {selectedPatient.dateOfBirth} | Tél: {selectedPatient.phoneNumber || '—'}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedPatient(null);
                                                setPatientSearchQuery("");
                                            }}
                                            className="text-xs font-semibold text-[#e91e8c] hover:underline cursor-pointer"
                                        >
                                            {t('appointments.modifier')}
                                        </button>
                                    </div>
                                ) : (
                                    <div>
                                        <div className="relative">
                                            <input
                                                type="text"
                                                placeholder={t('appointments.patient_search_placeholder')}
                                                value={patientSearchQuery}
                                                onChange={(e) => setPatientSearchQuery(e.target.value)}
                                                className="w-full p-3.5 pl-10 bg-gray-50/50 hover:bg-gray-50 border border-gray-200/80 rounded-2xl font-medium text-[#1E2A56] focus:border-[#e91e8c] focus:ring-1 focus:ring-[#e91e8c] focus:bg-white outline-none transition-all"
                                            />
                                            <span className="absolute left-3 top-[17px] text-gray-400">
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                                                </svg>
                                            </span>
                                        </div>
                                        {/* Suggestions dropdown */}
                                        {patientSearchResults.length > 0 && (
                                            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200/80 rounded-2xl shadow-xl max-h-48 overflow-y-auto">
                                                {patientSearchResults.map((p) => (
                                                    <button
                                                        key={p.id}
                                                        type="button"
                                                        onClick={() => {
                                                            setSelectedPatient(p);
                                                            setPatientSearchResults([]);
                                                        }}
                                                        className="w-full text-left p-3.5 hover:bg-[#e91e8c]/5 border-b border-gray-100 last:border-0 flex flex-col cursor-pointer transition-all"
                                                    >
                                                        <span className="font-semibold text-sm text-[#1E2A56]">{p.fullName}</span>
                                                        <span className="text-xs text-gray-400">Né(e) le {p.dateOfBirth} | Tél: {p.phoneNumber || '—'}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        {patientSearchQuery.trim().length >= 2 && patientSearchResults.length === 0 && !isSearchingPatient && (
                                            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200/80 rounded-2xl shadow-xl p-3.5 text-center text-sm text-gray-400">
                                                {t('appointments.patient_not_found')}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Reason for Appointment */}
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">{t('appointments.reason_label')}</label>
                                <textarea
                                    placeholder={t('appointments.reason_placeholder')}
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    rows={3}
                                    className="w-full p-3.5 bg-gray-50/50 hover:bg-gray-50 border border-gray-200/80 rounded-2xl font-medium text-[#1E2A56] focus:border-[#e91e8c] focus:ring-1 focus:ring-[#e91e8c] focus:bg-white outline-none resize-none transition-all"
                                />
                            </div>

                            {/* Slot Duration */}
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">{t('appointments.duration_label')}</label>
                                <select
                                    value={duration}
                                    onChange={(e) => setDuration(Number(e.target.value))}
                                    className="w-full p-3.5 bg-gray-50/50 hover:bg-gray-50 border border-gray-200/80 rounded-2xl font-medium text-[#1E2A56] focus:border-[#e91e8c] focus:ring-1 focus:ring-[#e91e8c] focus:bg-white outline-none transition-all"
                                >
                                    <option value={15}>{t('appointments.duration_minutes', { count: 15 })}</option>
                                    <option value={30}>{t('appointments.duration_minutes', { count: 30 })}</option>
                                    <option value={45}>{t('appointments.duration_minutes', { count: 45 })}</option>
                                    <option value={60}>{t('appointments.duration_minutes', { count: 60 })}</option>
                                </select>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="bg-white px-6 py-5 flex items-center justify-end gap-4 border-t border-gray-100">
                            <button
                                type="button"
                                onClick={closeBookingModal}
                                className="px-5 py-3 text-gray-500 hover:text-[#1E2A56] font-semibold transition-all cursor-pointer"
                            >
                                {t('appointments.cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={handleBookAppointment}
                                disabled={isSaving || !selectedPatient}
                                className="px-8 py-3 bg-[#e91e8c] hover:bg-[#be185d] text-white font-bold rounded-2xl shadow-lg shadow-[#e91e8c]/25 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {t('appointments.save')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}