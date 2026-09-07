import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Patient } from "../../../types/patient";
import { TIME_SLOTS, dateKey } from "./schedule";

type Props = {
    open: boolean;
    /** The day being booked. The modal shows it read-only and books against it. */
    date: Date;
    doctorId: number | null;
    /** Slot to pre-select, e.g. the empty row the doctor clicked. */
    initialTime?: string;
    /** Pre-selected patient, for a handoff from the patient file. */
    initialPatient?: Patient | null;
    onClose: () => void;
    /** Fired after a successful booking, so the caller can reload its day. */
    onBooked: () => void;
};

/* The one booking form in the app. Both the calendar and the dashboard planner
   mount it, so a change to what a booking asks for happens in one place. */
export default function BookingModal({ open, date, doctorId, initialTime, initialPatient, onClose, onBooked }: Props) {
    const { t, i18n } = useTranslation();
    const locale = i18n.language || 'fr';

    const [selectedTime, setSelectedTime] = useState(initialTime || "11:00");
    const [selectedPatient, setSelectedPatient] = useState<Patient | null>(initialPatient || null);
    const [patientSearchQuery, setPatientSearchQuery] = useState("");
    const [patientSearchResults, setPatientSearchResults] = useState<Patient[]>([]);
    const [isSearchingPatient, setIsSearchingPatient] = useState(false);
    const [reason, setReason] = useState("");
    const [duration, setDuration] = useState(30);
    const [isSaving, setIsSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");

    /* Each opening is a fresh booking — otherwise the previous patient, reason
       and slot are still sitting in the form the next time it is opened. */
    useEffect(() => {
        if (!open) return;
        setSelectedTime(initialTime || "11:00");
        setSelectedPatient(initialPatient || null);
        setPatientSearchQuery("");
        setPatientSearchResults([]);
        setReason("");
        setDuration(30);
        setErrorMessage("");
    }, [open, initialTime, initialPatient]);

    // Patient search (debounced).
    useEffect(() => {
        if (!open || selectedPatient || !patientSearchQuery.trim()) {
            if (!patientSearchQuery.trim()) setPatientSearchResults([]);
            return;
        }
        const timer = setTimeout(async () => {
            setIsSearchingPatient(true);
            try {
                const res = await window.ipcRenderer.searchPatient(patientSearchQuery);
                setPatientSearchResults(Array.isArray(res) ? res : []);
            } catch (error) {
                console.error("Patient search failed:", error);
                setPatientSearchResults([]);
            } finally {
                setIsSearchingPatient(false);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [patientSearchQuery, selectedPatient, open]);

    const handleBook = async () => {
        if (!selectedPatient || doctorId === null) return;
        setIsSaving(true);
        setErrorMessage("");
        try {
            const result = await window.ipcRenderer.bookAppointment(
                selectedPatient.id,
                doctorId,
                `${dateKey(date)}T${selectedTime}:00`,
                duration,
                reason
            );
            if (result.status === "success") {
                onBooked();
                onClose();
            } else {
                setErrorMessage(result.message || t('appointments.booking_error'));
            }
        } catch (error) {
            setErrorMessage((error as Error).message);
        } finally {
            setIsSaving(false);
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 bg-navy/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-lg overflow-hidden border border-white/20 animate-scale-in flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="bg-white px-6 pt-6 pb-2 flex items-start justify-between">
                    <div>
                        <h3 className="font-bold text-navy text-xl md:text-2xl">{t('appointments.new_appointment')}</h3>
                        <p className="text-xs md:text-sm text-gray-400 mt-1">{t('appointments.new_appointment_subtitle')}</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer p-1 bg-transparent border-none">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto space-y-4 flex-1">
                    {errorMessage && (
                        <div className="p-3 text-sm bg-red-50 text-red-700 rounded-xl border border-red-200">
                            {errorMessage}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">{t('appointments.date_label')}</label>
                            <input
                                type="text"
                                readOnly
                                value={date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                className="w-full p-3.5 bg-gray-50 border border-gray-200/80 rounded-2xl font-medium text-gray-600 focus:outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">{t('appointments.slot_label')}</label>
                            <select
                                value={selectedTime}
                                onChange={(e) => setSelectedTime(e.target.value)}
                                className="w-full p-3.5 bg-gray-50/50 hover:bg-gray-50 border border-gray-200/80 rounded-2xl font-medium text-navy focus:border-pink focus:ring-1 focus:ring-pink focus:bg-white outline-none transition-all"
                            >
                                {/* A slot handed in from a row outside consulting hours still
                                    has to be selectable, or the picker would silently move it. */}
                                {(TIME_SLOTS.includes(selectedTime) ? TIME_SLOTS : [...TIME_SLOTS, selectedTime].sort()).map((slot) => (
                                    <option key={slot} value={slot}>{slot}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Patient search & autocomplete */}
                    <div className="relative">
                        <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">{t('appointments.patient_label')}</label>
                        {selectedPatient ? (
                            <div className="p-4 bg-pink/5 border border-pink/25 rounded-2xl flex items-center justify-between">
                                <div>
                                    <span className="font-bold text-navy block">{selectedPatient.fullName}</span>
                                    <span className="text-xs text-gray-500 block">
                                        {t('appointments.patient_meta', {
                                            dob: selectedPatient.dateOfBirth,
                                            phone: selectedPatient.phoneNumber || '—',
                                        })}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectedPatient(null);
                                        setPatientSearchQuery("");
                                    }}
                                    className="text-xs font-semibold text-pink hover:underline cursor-pointer bg-transparent border-none"
                                >
                                    {t('appointments.modifier')}
                                </button>
                            </div>
                        ) : (
                            <div>
                                <div className="relative">
                                    <input
                                        type="text"
                                        autoFocus
                                        placeholder={t('appointments.patient_search_placeholder')}
                                        value={patientSearchQuery}
                                        onChange={(e) => setPatientSearchQuery(e.target.value)}
                                        className="w-full p-3.5 pl-10 bg-gray-50/50 hover:bg-gray-50 border border-gray-200/80 rounded-2xl font-medium text-navy focus:border-pink focus:ring-1 focus:ring-pink focus:bg-white outline-none transition-all"
                                    />
                                    <span className="absolute left-3 top-[17px] text-gray-400">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                                        </svg>
                                    </span>
                                </div>
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
                                                className="w-full text-left p-3.5 hover:bg-pink/5 border-x-0 border-t-0 border-b border-gray-100 last:border-0 flex flex-col cursor-pointer transition-all bg-transparent"
                                            >
                                                <span className="font-semibold text-sm text-navy">{p.fullName}</span>
                                                <span className="text-xs text-gray-400">
                                                    {t('appointments.patient_meta', { dob: p.dateOfBirth, phone: p.phoneNumber || '—' })}
                                                </span>
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

                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">{t('appointments.reason_label')}</label>
                        <textarea
                            placeholder={t('appointments.reason_placeholder')}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            className="w-full p-3.5 bg-gray-50/50 hover:bg-gray-50 border border-gray-200/80 rounded-2xl font-medium text-navy focus:border-pink focus:ring-1 focus:ring-pink focus:bg-white outline-none resize-none transition-all"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">{t('appointments.duration_label')}</label>
                        <select
                            value={duration}
                            onChange={(e) => setDuration(Number(e.target.value))}
                            className="w-full p-3.5 bg-gray-50/50 hover:bg-gray-50 border border-gray-200/80 rounded-2xl font-medium text-navy focus:border-pink focus:ring-1 focus:ring-pink focus:bg-white outline-none transition-all"
                        >
                            {[15, 30, 45, 60].map((minutes) => (
                                <option key={minutes} value={minutes}>{t('appointments.duration_minutes', { count: minutes })}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Footer */}
                <div className="bg-white px-6 py-5 flex items-center justify-end gap-4 border-t border-gray-100">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-5 py-3 text-gray-500 hover:text-navy font-semibold transition-all cursor-pointer bg-transparent border-none"
                    >
                        {t('appointments.cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={handleBook}
                        disabled={isSaving || !selectedPatient}
                        className="px-8 py-3 bg-pink hover:bg-pink-dark text-white font-bold rounded-2xl shadow-lg shadow-pink/25 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border-none"
                    >
                        {t('appointments.save')}
                    </button>
                </div>
            </div>
        </div>
    );
}
