import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Patient } from '../../../types/patient';
import type { DoctorProfile, Prescription, PrescriptionLanguage } from '../../../types/doctor';
import type { PatientDocument } from '../../../types/documents';
import type { Consultation as ConsultationRecord, ConsultationDraft, ConsultationListItem } from '../../../types/consultation';
import MedicineNameInput from '../../components/Prescription/MedicineNameInput';
import TemplateBar from '../../components/Prescription/TemplateBar';
import CertificateForm from '../../components/Prescription/CertificateForm';
import PaymentPanel from '../../components/Billing/PaymentPanel';

/* ═══════════════════════════════════════════════════════════════════ */
/*                              ICONS                                  */
/* ═══════════════════════════════════════════════════════════════════ */
const icons = {
    stethoscope: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" />
            <path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4" />
            <circle cx="20" cy="10" r="2" />
        </svg>
    ),
    pulse: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
    ),
    clipboard: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            <rect x="8" y="2" width="8" height="4" rx="1" />
        </svg>
    ),
    pill: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m10.5 1.5 3 3L5 13 2 10l8.5-8.5z" />
            <path d="m13.5 4.5 3 3" />
        </svg>
    ),
    fileDoc: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
        </svg>
    ),
    calendar: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
    ),
    wallet: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
            <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
            <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
        </svg>
    ),
    plus: (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    ),
    trash: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
    ),
    open: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
        </svg>
    ),
    check: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    ),
    search: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
    ),
};

/* ═══════════════════════════════════════════════════════════════════ */
/*                             HELPERS                                 */
/* ═══════════════════════════════════════════════════════════════════ */

/** Local 'YYYY-MM-DD' — the format the appointment/consultation queries expect. */
function todayKey(date: Date = new Date()) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function calculateAge(dob?: string) {
    if (!dob) return null;
    const birth = new Date(dob);
    if (Number.isNaN(birth.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
}

function getInitials(name: string) {
    return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

/* patients.notes holds a JSON array of {date, text} entries (see PatientDetails).
   Returns the most recent note's text so the sidebar shows prose, not JSON —
   older plain-text notes are passed through unchanged. */
function latestPatientNote(raw: string | null | undefined): string | null {
    if (!raw?.trim()) return null;
    try {
        const parsed = JSON.parse(raw.trim());
        if (Array.isArray(parsed)) {
            const entries = parsed.filter((e) => e && typeof e.text === 'string');
            return entries.length ? entries[entries.length - 1].text : null;
        }
    } catch {
        // Not JSON — a legacy free-text note.
    }
    return raw.trim();
}

/** '' → null, so a cleared field is stored as absent rather than an empty string. */
function toText(value: string): string | null {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

/** Accepts both '36.6' and the comma decimals a French keyboard produces. */
function toNumber(value: string): number | null {
    const trimmed = value.trim().replace(',', '.');
    if (trimmed === '') return null;
    const parsed = parseFloat(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
}

function fromValue(value: string | number | null | undefined): string {
    return value === null || value === undefined ? '' : String(value);
}

type FormState = {
    reason: string;
    weight: string;
    height: string;
    temperature: string;
    bloodPressure: string;
    heartRate: string;
    examNotes: string;
    diagnosis: string;
    treatmentPlan: string;
    followUpNotes: string;
    fee: string;
    isPaid: boolean;
};

const EMPTY_FORM: FormState = {
    reason: '', weight: '', height: '', temperature: '', bloodPressure: '', heartRate: '',
    examNotes: '', diagnosis: '', treatmentPlan: '', followUpNotes: '', fee: '', isPaid: true,
};

function formFromConsultation(consultation: ConsultationRecord): FormState {
    return {
        reason: fromValue(consultation.reason),
        weight: fromValue(consultation.weight),
        height: fromValue(consultation.height),
        temperature: fromValue(consultation.temperature),
        bloodPressure: fromValue(consultation.bloodPressure),
        heartRate: fromValue(consultation.heartRate),
        examNotes: fromValue(consultation.examNotes),
        diagnosis: fromValue(consultation.diagnosis),
        treatmentPlan: fromValue(consultation.treatmentPlan),
        followUpNotes: fromValue(consultation.followUpNotes),
        fee: fromValue(consultation.fee),
        isPaid: consultation.isPaid,
    };
}

function draftFromForm(form: FormState): ConsultationDraft {
    return {
        reason: toText(form.reason),
        weight: toNumber(form.weight),
        height: toNumber(form.height),
        temperature: toNumber(form.temperature),
        bloodPressure: toText(form.bloodPressure),
        heartRate: toNumber(form.heartRate),
        examNotes: toText(form.examNotes),
        diagnosis: toText(form.diagnosis),
        treatmentPlan: toText(form.treatmentPlan),
        followUpNotes: toText(form.followUpNotes),
        fee: toNumber(form.fee),
        isPaid: form.isPaid,
    };
}

type MedicationEntry = { medicineName: string; dosage: string; frequency: string; duration: string; quantity: string };
const EMPTY_MEDICATION: MedicationEntry = { medicineName: '', dosage: '', frequency: '', duration: '', quantity: '' };

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/* ═══════════════════════════════════════════════════════════════════ */
/*                       SMALL PRESENTATIONAL BITS                     */
/* ═══════════════════════════════════════════════════════════════════ */

function SectionCard({ title, icon, action, children }: { title: string; icon: JSX.Element; action?: JSX.Element; children: React.ReactNode }) {
    return (
        <section className="bg-white rounded-2xl p-5 shadow-[0_2px_12px_rgba(30,42,86,0.06)] border border-navy/[0.04] space-y-4">
            <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2.5 text-sm font-bold text-navy">
                    <span className="p-2 bg-pink/5 rounded-xl text-pink">{icon}</span>
                    {title}
                </h3>
                {action}
            </div>
            {children}
        </section>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block space-y-1.5">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-navy/35">{label}</span>
            {children}
        </label>
    );
}

const inputClass = 'w-full px-3.5 py-2.5 text-sm bg-navy/[0.015] border border-navy/[0.08] rounded-xl text-navy placeholder:text-navy/25 focus:outline-none focus:ring-2 focus:ring-pink/20 focus:border-pink/30 transition-all';
const textareaClass = `${inputClass} resize-y min-h-[92px] leading-relaxed`;

/* ═══════════════════════════════════════════════════════════════════ */
/*                          CONSULTATION PAGE                          */
/* ═══════════════════════════════════════════════════════════════════ */
export default function Consultation() {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const { id: routeId } = useParams<{ id: string }>();
    const locale = i18n.language || 'fr';

    /* ── Session ── */
    const [currentUserId, setCurrentUserId] = useState<number | null>(null);
    const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
    const [step, setStep] = useState<'loading' | 'no-profile' | 'select' | 'workspace'>('loading');

    /* ── The visit ── */
    const [consultation, setConsultation] = useState<ConsultationRecord | null>(null);
    const [patient, setPatient] = useState<Patient | null>(null);
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [isFinishing, setIsFinishing] = useState(false);
    // The first render after loading a consultation must not trigger an
    // autosave — it would just write back what we have only read.
    const skipAutosave = useRef(true);

    /* ── Starting point ── */
    const [patientSearchQuery, setPatientSearchQuery] = useState('');
    const [patientSearchResults, setPatientSearchResults] = useState<Patient[]>([]);
    const [isSearchingPatient, setIsSearchingPatient] = useState(false);
    const [todayAppointments, setTodayAppointments] = useState<AppointmentRow[]>([]);
    const [isStarting, setIsStarting] = useState(false);
    const [showQuickAdd, setShowQuickAdd] = useState(false);
    const [quickAdd, setQuickAdd] = useState({ fullName: '', dateOfBirth: '', phoneNumber: '', ssn: '' });

    /* ── Artefacts produced during the visit ── */
    const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
    const [documents, setDocuments] = useState<PatientDocument[]>([]);
    const [pastConsultations, setPastConsultations] = useState<ConsultationListItem[]>([]);

    /* ── Billing ──
       Same source the statistics page reads, so a visit stored with a NULL fee
       resolves to the same amount in both places. */
    const defaultFee = useMemo(
        () => parseFloat(localStorage.getItem('default_consultation_price') || '2000') || 0,
        []
    );

    /* Keeps the "paid" checkbox in step with the payments actually recorded.
       Returning the previous state unchanged is what stops the round trip
       (checkbox -> autosave -> panel reload -> checkbox) from looping. */
    const handleSettledChange = useCallback((settled: boolean) => {
        setForm(prev => (prev.isPaid === settled ? prev : { ...prev, isPaid: settled }));
    }, []);

    /* ── Prescription builder ── */
    const [medications, setMedications] = useState<MedicationEntry[]>([]);
    const [medForm, setMedForm] = useState<MedicationEntry>(EMPTY_MEDICATION);
    const [prescriptionNotes, setPrescriptionNotes] = useState('');
    const [prescriptionLanguage, setPrescriptionLanguage] = useState<PrescriptionLanguage>('fr');
    const [isSavingPrescription, setIsSavingPrescription] = useState(false);

    /* ── Document upload ── */
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [uploadCategory, setUploadCategory] = useState('analysis');
    const [isUploading, setIsUploading] = useState(false);

    /* ── Follow-up appointment ── */
    const [followUp, setFollowUp] = useState({ date: '', time: '09:00', duration: '30', reason: '' });
    const [isBooking, setIsBooking] = useState(false);
    const [bookedFollowUp, setBookedFollowUp] = useState<string | null>(null);

    /* ── Feedback ── */
    const [successMessage, setSuccessMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    const showSuccess = useCallback((message: string) => {
        setSuccessMessage(message);
        setTimeout(() => setSuccessMessage(''), 3000);
    }, []);
    const showError = useCallback((message: string) => {
        setErrorMessage(message);
        setTimeout(() => setErrorMessage(''), 4500);
    }, []);

    const isCompleted = consultation?.status === 'Completed';

    /* ══════════════════════ Session bootstrap ══════════════════════ */

    useEffect(() => {
        (async () => {
            try {
                const auth = await window.ipcRenderer.checkAuth();
                if (auth?.status === 'success' && auth.user?.id) {
                    setCurrentUserId(auth.user.id);
                } else {
                    window.location.hash = '/';
                }
            } catch {
                window.location.hash = '/';
            }
        })();
    }, []);

    useEffect(() => {
        if (currentUserId === null) return;
        (async () => {
            try {
                const result = await window.ipcRenderer.getDoctorProfile(currentUserId);
                if (result.status === 'success' && result.data) {
                    setDoctorProfile(result.data);
                } else {
                    setStep('no-profile');
                }
            } catch (error) {
                console.error('Error loading doctor profile:', error);
                setStep('no-profile');
            }
        })();
    }, [currentUserId]);

    /** Loads the patient, past visits and this visit's artefacts into the workspace. */
    const openWorkspace = useCallback(async (record: ConsultationRecord) => {
        skipAutosave.current = true;
        setConsultation(record);
        setForm(formFromConsultation(record));
        setStep('workspace');

        const [loadedPatient, artifacts, history] = await Promise.all([
            window.ipcRenderer.getPatientById(record.patientId),
            window.ipcRenderer.getConsultationArtifacts(record.id),
            window.ipcRenderer.getConsultationsByPatientId(record.patientId),
        ]);
        setPatient(loadedPatient);
        if (artifacts.status === 'success' && artifacts.data) {
            setPrescriptions(artifacts.data.prescriptions);
            setDocuments(artifacts.data.documents);
        }
        // The visit being recorded is not part of its own history.
        setPastConsultations(history.filter(c => c.id !== record.id && c.status === 'Completed'));
    }, []);

    /* Resume an open draft, or open the one named in the URL. */
    useEffect(() => {
        if (!doctorProfile) return;
        (async () => {
            try {
                if (routeId) {
                    const result = await window.ipcRenderer.getConsultationById(Number(routeId));
                    if (result.status === 'success' && result.data) {
                        await openWorkspace(result.data);
                        return;
                    }
                }
                const active = await window.ipcRenderer.getActiveConsultation(doctorProfile.id);
                if (active.status === 'success' && active.data) {
                    await openWorkspace(active.data);
                    return;
                }
                setStep('select');
            } catch (error) {
                console.error('Error resuming consultation:', error);
                setStep('select');
            }
        })();
    }, [doctorProfile, routeId, openWorkspace]);

    /* Today's remaining bookings, offered as one-click starting points. */
    useEffect(() => {
        if (!doctorProfile || step !== 'select') return;
        (async () => {
            const rows = await window.ipcRenderer.getAppointmentsByDay(doctorProfile.id, todayKey());
            setTodayAppointments(Array.isArray(rows) ? rows.filter(a => a.status === 'Scheduled') : []);
        })();
    }, [doctorProfile, step]);

    /* Patient search (debounced), mirroring the Prescriptions page. */
    useEffect(() => {
        if (!patientSearchQuery.trim()) {
            setPatientSearchResults([]);
            return;
        }
        const timer = setTimeout(async () => {
            setIsSearchingPatient(true);
            try {
                const results = await window.ipcRenderer.searchPatient(patientSearchQuery);
                setPatientSearchResults(results || []);
            } catch (error) {
                console.error('Patient search error:', error);
                setPatientSearchResults([]);
            } finally {
                setIsSearchingPatient(false);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [patientSearchQuery]);

    /* ══════════════════════ Autosave ══════════════════════ */

    const consultationId = consultation?.id ?? null;

    useEffect(() => {
        if (!consultationId || isCompleted) return;
        if (skipAutosave.current) {
            skipAutosave.current = false;
            return;
        }
        setSaveState('saving');
        const timer = setTimeout(async () => {
            try {
                const result = await window.ipcRenderer.updateConsultation(consultationId, draftFromForm(form));
                setSaveState(result.status === 'success' ? 'saved' : 'error');
            } catch (error) {
                console.error('Autosave error:', error);
                setSaveState('error');
            }
        }, 900);
        return () => clearTimeout(timer);
    }, [form, consultationId, isCompleted]);

    /* ══════════════════════ Starting a visit ══════════════════════ */

    const startVisit = useCallback(async (selectedPatient: Patient, appointmentId?: number) => {
        if (!doctorProfile) return;
        setIsStarting(true);
        try {
            const result = await window.ipcRenderer.startConsultation(selectedPatient.id, doctorProfile.id, appointmentId);
            if (result.status === 'success' && result.data) {
                setPatientSearchQuery('');
                setPatientSearchResults([]);
                await openWorkspace(result.data);
            } else {
                showError(result.message || t('consultation.errors.start_failed'));
            }
        } catch (error) {
            console.error('Error starting consultation:', error);
            showError(t('consultation.errors.start_failed'));
        } finally {
            setIsStarting(false);
        }
    }, [doctorProfile, openWorkspace, showError, t]);

    /* A patient handed over from the patient file or the calendar. */
    const handoff = location.state as { patient?: Patient; appointmentId?: number } | null;
    const handoffHandled = useRef(false);
    useEffect(() => {
        if (handoffHandled.current || step !== 'select' || !handoff?.patient || !doctorProfile) return;
        handoffHandled.current = true;
        startVisit(handoff.patient, handoff.appointmentId);
    }, [handoff, step, doctorProfile, startVisit]);

    const handleQuickAddPatient = async () => {
        if (!quickAdd.fullName.trim() || !quickAdd.dateOfBirth) {
            showError(t('consultation.errors.quick_add_required'));
            return;
        }
        setIsStarting(true);
        try {
            const created = await window.ipcRenderer.addPatient({
                fullName: quickAdd.fullName.trim(),
                dateOfBirth: quickAdd.dateOfBirth,
                address: '',
                phoneNumber: quickAdd.phoneNumber.trim(),
                // Null rather than '': the column is UNIQUE, so a second
                // walk-in without an SSN would collide on an empty string.
                ssn: toText(quickAdd.ssn),
                bloodType: null,
            });
            setShowQuickAdd(false);
            setQuickAdd({ fullName: '', dateOfBirth: '', phoneNumber: '', ssn: '' });
            await startVisit(created);
        } catch (error) {
            console.error('Error creating walk-in patient:', error);
            showError(t('consultation.errors.quick_add_failed'));
        } finally {
            setIsStarting(false);
        }
    };

    /* ══════════════════════ Prescription ══════════════════════ */

    const addMedication = () => {
        if (!medForm.medicineName.trim()) return;
        setMedications(prev => [...prev, medForm]);
        setMedForm(EMPTY_MEDICATION);
    };

    /* Templates append rather than replace: the doctor may have already typed a
       line by hand, and silently discarding it would be worse than a duplicate
       they can delete. The template's own advice note only fills an empty box,
       for the same reason. */
    const applyTemplate = (lines: MedicationEntry[], templateNotes: string | null) => {
        if (lines.length) setMedications(prev => [...prev, ...lines]);
        if (templateNotes?.trim()) setPrescriptionNotes(prev => prev.trim() ? prev : templateNotes);
    };

    const refreshArtifacts = useCallback(async (id: number) => {
        const artifacts = await window.ipcRenderer.getConsultationArtifacts(id);
        if (artifacts.status === 'success' && artifacts.data) {
            setPrescriptions(artifacts.data.prescriptions);
            setDocuments(artifacts.data.documents);
        }
    }, []);

    const handleSavePrescription = async () => {
        if (!consultation || !patient || !currentUserId || !doctorProfile || medications.length === 0) return;
        if (!doctorProfile.pdfPath) {
            showError(t('consultation.errors.no_template'));
            return;
        }
        setIsSavingPrescription(true);
        try {
            const saved = await window.ipcRenderer.addPrescription(
                currentUserId,
                patient.id,
                medications,
                prescriptionNotes.trim() || undefined,
                consultation.id,
            );
            if (saved.status !== 'success' || !saved.data) {
                showError(saved.message || t('consultation.errors.prescription_failed'));
                return;
            }

            const hydrated = await window.ipcRenderer.getPrescriptionById(saved.data.prescriptionId, patient.id);
            if (hydrated.status === 'success' && hydrated.data) {
                const pdf = await window.ipcRenderer.generatePatientPrescriptionPDF(
                    patient.id,
                    [hydrated.data.prescription],
                    doctorProfile,
                    // The weight measured minutes ago is the one that belongs on
                    // the prescription — no need to retype it.
                    form.weight.trim() || undefined,
                    prescriptionLanguage,
                    consultation.id,
                );
                if (pdf.status === 'success' && pdf.data) {
                    await window.ipcRenderer.openDocument(pdf.data);
                } else {
                    showError(pdf.message || t('consultation.errors.pdf_failed'));
                }
            }

            setMedications([]);
            setPrescriptionNotes('');
            await refreshArtifacts(consultation.id);
            showSuccess(t('consultation.prescription.saved'));
        } catch (error) {
            console.error('Error saving prescription:', error);
            showError(t('consultation.errors.prescription_failed'));
        } finally {
            setIsSavingPrescription(false);
        }
    };

    /* ══════════════════════ Documents ══════════════════════ */

    const handleUpload = async () => {
        if (!consultation || !patient || !selectedFile) return;
        setIsUploading(true);
        try {
            const localPath = (selectedFile as File & { path: string }).path;
            if (!localPath) {
                showError(t('consultation.errors.upload_failed'));
                return;
            }
            await window.ipcRenderer.uploadDocument({
                patientId: patient.id,
                consultationId: consultation.id,
                fileName: selectedFile.name,
                fileCategory: uploadCategory,
                localPath,
            });
            setSelectedFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
            await refreshArtifacts(consultation.id);
            showSuccess(t('consultation.documents.uploaded'));
        } catch (error) {
            console.error('Error uploading document:', error);
            showError(t('consultation.errors.upload_failed'));
        } finally {
            setIsUploading(false);
        }
    };

    /* ══════════════════════ Follow-up ══════════════════════ */

    const handleBookFollowUp = async () => {
        if (!patient || !doctorProfile || !followUp.date) return;
        setIsBooking(true);
        try {
            const datetime = `${followUp.date}T${followUp.time || '09:00'}:00`;
            const result = await window.ipcRenderer.bookAppointment(
                patient.id,
                doctorProfile.id,
                datetime,
                parseInt(followUp.duration, 10) || 30,
                followUp.reason.trim() || t('consultation.follow_up.default_reason'),
            );
            if (result.status === 'success') {
                setBookedFollowUp(datetime);
                setFollowUp({ date: '', time: '09:00', duration: '30', reason: '' });
                showSuccess(t('consultation.follow_up.booked'));
            } else {
                showError(result.message || t('consultation.errors.booking_failed'));
            }
        } catch (error) {
            console.error('Error booking follow-up:', error);
            showError(t('consultation.errors.booking_failed'));
        } finally {
            setIsBooking(false);
        }
    };

    /* ══════════════════════ Finishing ══════════════════════ */

    const handleFinish = async () => {
        if (!consultation) return;
        if (!confirm(t('consultation.finish_confirm'))) return;
        setIsFinishing(true);
        try {
            const result = await window.ipcRenderer.completeConsultation(consultation.id, draftFromForm(form));
            if (result.status !== 'success') {
                showError(result.message || t('consultation.errors.finish_failed'));
                return;
            }
            const finishedPatientId = consultation.patientId;
            resetVisit();
            setStep('select');
            showSuccess(t('consultation.finished'));
            navigate('/consultation', { replace: true, state: { finishedPatientId } });
        } catch (error) {
            console.error('Error completing consultation:', error);
            showError(t('consultation.errors.finish_failed'));
        } finally {
            setIsFinishing(false);
        }
    };

    const handleDiscard = async () => {
        if (!consultation) return;
        if (!confirm(t('consultation.discard_confirm'))) return;
        try {
            await window.ipcRenderer.deleteConsultation(consultation.id);
            resetVisit();
            setStep('select');
            navigate('/consultation', { replace: true });
        } catch (error) {
            console.error('Error discarding consultation:', error);
            showError(t('consultation.errors.discard_failed'));
        }
    };

    function resetVisit() {
        setConsultation(null);
        setPatient(null);
        setForm(EMPTY_FORM);
        setPrescriptions([]);
        setDocuments([]);
        setPastConsultations([]);
        setMedications([]);
        setMedForm(EMPTY_MEDICATION);
        setPrescriptionNotes('');
        setSelectedFile(null);
        setBookedFollowUp(null);
        setFollowUp({ date: '', time: '09:00', duration: '30', reason: '' });
        setSaveState('idle');
        handoffHandled.current = false;
    }

    /* ══════════════════════ Derived ══════════════════════ */

    const patientAge = useMemo(() => calculateAge(patient?.dateOfBirth), [patient]);
    const patientNote = useMemo(() => latestPatientNote(patient?.notes), [patient]);

    // Body-mass index, shown only once both measurements are present.
    const bmi = useMemo(() => {
        const weight = toNumber(form.weight);
        const height = toNumber(form.height);
        if (!weight || !height) return null;
        const metres = height > 3 ? height / 100 : height;
        if (metres <= 0) return null;
        return (weight / (metres * metres)).toFixed(1);
    }, [form.weight, form.height]);

    const openDocument = async (path: string) => {
        const error = await window.ipcRenderer.openDocument(path);
        if (error) console.error('[open-document] error:', error);
    };

    /* ═══════════════════════════════════════════════════════════════ */
    /*                            RENDERING                            */
    /* ═══════════════════════════════════════════════════════════════ */

    if (step === 'loading') {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-pink" />
            </div>
        );
    }

    if (step === 'no-profile') {
        return (
            <div className="bg-white rounded-2xl p-8 text-center shadow-[0_2px_12px_rgba(30,42,86,0.06)] border border-navy/[0.04] space-y-3">
                <p className="text-sm font-bold text-navy">{t('consultation.no_profile_title')}</p>
                <p className="text-xs text-navy/45 max-w-sm mx-auto">{t('consultation.no_profile_body')}</p>
                <button
                    onClick={() => navigate('/settings')}
                    className="px-5 py-2.5 rounded-xl bg-pink hover:bg-pink-dark text-white text-xs font-bold transition-colors cursor-pointer"
                >
                    {t('consultation.no_profile_action')}
                </button>
            </div>
        );
    }

    const feedback = (
        <>
            {successMessage && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold">
                    {icons.check}{successMessage}
                </div>
            )}
            {errorMessage && (
                <div className="px-4 py-3 rounded-2xl bg-red-50 border border-red-200 text-red-600 text-sm font-semibold">
                    {errorMessage}
                </div>
            )}
        </>
    );

    /* ─────────────────────── STEP: pick a patient ─────────────────────── */
    if (step === 'select') {
        return (
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-bold text-navy">{t('consultation.title')}</h1>
                    <p className="text-sm text-navy/50 mt-1">{t('consultation.subtitle')}</p>
                </div>

                {feedback}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Walk-in: search or create */}
                    <SectionCard title={t('consultation.select.walk_in_title')} icon={icons.stethoscope}>
                        <p className="text-xs text-navy/45 -mt-1">{t('consultation.select.walk_in_hint')}</p>

                        <div className="relative">
                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy/25 pointer-events-none">{icons.search}</span>
                            <input
                                value={patientSearchQuery}
                                onChange={(e) => setPatientSearchQuery(e.target.value)}
                                placeholder={t('consultation.select.search_placeholder')}
                                className={`${inputClass} pl-10`}
                            />
                        </div>

                        {isSearchingPatient && (
                            <p className="text-xs text-navy/35 font-medium">{t('consultation.select.searching')}</p>
                        )}

                        {patientSearchResults.length > 0 && (
                            <div className="divide-y divide-navy/[0.04] max-h-64 overflow-y-auto rounded-xl border border-navy/[0.06]">
                                {patientSearchResults.map((result) => (
                                    <button
                                        key={result.id}
                                        onClick={() => startVisit(result)}
                                        disabled={isStarting}
                                        className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-pink/[0.03] transition-colors cursor-pointer bg-transparent border-none disabled:opacity-50"
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <span className="w-9 h-9 rounded-full bg-navy/5 text-navy text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                                                {getInitials(result.fullName)}
                                            </span>
                                            <div className="min-w-0">
                                                <span className="block text-sm font-semibold text-navy truncate">{result.fullName}</span>
                                                <span className="block text-[11px] text-navy/40">
                                                    {calculateAge(result.dateOfBirth) !== null
                                                        ? t('consultation.select.age_years', { age: calculateAge(result.dateOfBirth) })
                                                        : result.dateOfBirth}
                                                    {result.phoneNumber ? ` · ${result.phoneNumber}` : ''}
                                                </span>
                                            </div>
                                        </div>
                                        <span className="text-[11px] font-bold text-pink flex-shrink-0">{t('consultation.select.start')}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        {patientSearchQuery && !isSearchingPatient && patientSearchResults.length === 0 && (
                            <p className="text-xs text-navy/35 font-medium text-center py-2">{t('consultation.select.no_results')}</p>
                        )}

                        {showQuickAdd ? (
                            <div className="space-y-3 pt-3 border-t border-navy/[0.06]">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-navy/35">{t('consultation.select.quick_add_title')}</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <Field label={t('consultation.select.quick_add_name')}>
                                        <input
                                            value={quickAdd.fullName}
                                            onChange={(e) => setQuickAdd(p => ({ ...p, fullName: e.target.value }))}
                                            placeholder={t('patients.modal.full_name_placeholder')}
                                            className={inputClass}
                                        />
                                    </Field>
                                    <Field label={t('consultation.select.quick_add_dob')}>
                                        <input
                                            type="date"
                                            value={quickAdd.dateOfBirth}
                                            onChange={(e) => setQuickAdd(p => ({ ...p, dateOfBirth: e.target.value }))}
                                            className={inputClass}
                                        />
                                    </Field>
                                    <Field label={t('consultation.select.quick_add_phone')}>
                                        <input
                                            value={quickAdd.phoneNumber}
                                            onChange={(e) => setQuickAdd(p => ({ ...p, phoneNumber: e.target.value }))}
                                            placeholder={t('patients.modal.phone_placeholder')}
                                            className={inputClass}
                                        />
                                    </Field>
                                    <Field label={t('consultation.select.quick_add_ssn')}>
                                        <input
                                            value={quickAdd.ssn}
                                            onChange={(e) => setQuickAdd(p => ({ ...p, ssn: e.target.value }))}
                                            placeholder={t('patients.modal.ssn_placeholder')}
                                            className={inputClass}
                                        />
                                    </Field>
                                </div>
                                <div className="flex items-center justify-end gap-3">
                                    <button
                                        onClick={() => setShowQuickAdd(false)}
                                        className="text-xs font-semibold text-navy/50 hover:text-navy transition-colors cursor-pointer bg-transparent border-none"
                                    >
                                        {t('consultation.select.cancel')}
                                    </button>
                                    <button
                                        onClick={handleQuickAddPatient}
                                        disabled={isStarting}
                                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-pink hover:bg-pink-dark text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                                    >
                                        {icons.plus}{t('consultation.select.quick_add_action')}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => setShowQuickAdd(true)}
                                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-navy/15 text-navy/50 hover:text-pink hover:border-pink/40 text-xs font-semibold transition-colors cursor-pointer bg-transparent"
                            >
                                {icons.plus}{t('consultation.select.quick_add_open')}
                            </button>
                        )}
                    </SectionCard>

                    {/* Today's bookings */}
                    <SectionCard title={t('consultation.select.today_title')} icon={icons.calendar}>
                        {todayAppointments.length === 0 ? (
                            <p className="text-xs text-navy/35 font-medium text-center py-8">{t('consultation.select.today_empty')}</p>
                        ) : (
                            <div className="divide-y divide-navy/[0.04] max-h-[420px] overflow-y-auto">
                                {todayAppointments.map((appointment) => (
                                    <div key={appointment.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <span className="text-xs font-black text-navy/40 w-11 flex-shrink-0">
                                                {appointment.appointment_datetime.split('T')[1]?.slice(0, 5) || '--:--'}
                                            </span>
                                            <div className="min-w-0">
                                                <span className="block text-sm font-semibold text-navy truncate">{appointment.full_name}</span>
                                                {appointment.reason && (
                                                    <span className="block text-[11px] text-navy/40 truncate">{appointment.reason}</span>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                const selected = await window.ipcRenderer.getPatientById(appointment.patient_id);
                                                if (selected) startVisit(selected, appointment.id);
                                            }}
                                            disabled={isStarting}
                                            className="flex-shrink-0 px-3.5 py-1.5 rounded-xl bg-pink/10 text-pink hover:bg-pink hover:text-white text-[11px] font-bold transition-colors cursor-pointer border-none disabled:opacity-50"
                                        >
                                            {t('consultation.select.start')}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </SectionCard>
                </div>
            </div>
        );
    }

    /* ─────────────────────── STEP: the workspace ─────────────────────── */
    return (
        <div className="space-y-5">
            {/* Sticky visit header */}
            <div className="sticky top-0 z-30 -mx-1 px-1 py-1">
                <div className="bg-white rounded-2xl p-4 shadow-[0_4px_20px_rgba(30,42,86,0.08)] border border-navy/[0.04] flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5 min-w-0">
                        <span className="w-11 h-11 rounded-full bg-gradient-to-br from-pink to-pink-light text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
                            {patient ? getInitials(patient.fullName) : '—'}
                        </span>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h1 className="text-base font-bold text-navy truncate">{patient?.fullName || '—'}</h1>
                                {consultation?.isWalkIn && (
                                    <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
                                        {t('consultation.walk_in_badge')}
                                    </span>
                                )}
                                {isCompleted && (
                                    <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                        {t('consultation.completed_badge')}
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] text-navy/45 font-medium truncate">
                                {patientAge !== null && <>{t('consultation.header.age', { age: patientAge })} · </>}
                                {patient?.bloodType || t('consultation.header.no_blood_type')}
                                {consultation && <> · {new Date(consultation.consultationDatetime).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</>}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        {!isCompleted && (
                            <span className={`text-[11px] font-semibold ${saveState === 'error' ? 'text-red-500' : 'text-navy/35'}`}>
                                {saveState === 'saving' && t('consultation.autosave.saving')}
                                {saveState === 'saved' && t('consultation.autosave.saved')}
                                {saveState === 'error' && t('consultation.autosave.error')}
                            </span>
                        )}
                        {patient && (
                            <button
                                onClick={() => navigate(`/patients/${patient.id}`)}
                                className="px-3.5 py-2 rounded-xl border border-navy/10 bg-white text-navy/60 hover:text-navy hover:bg-navy/[0.03] text-xs font-semibold transition-colors cursor-pointer"
                            >
                                {t('consultation.header.open_file')}
                            </button>
                        )}
                        {!isCompleted && (
                            <>
                                <button
                                    onClick={handleDiscard}
                                    className="px-3.5 py-2 rounded-xl border border-navy/10 bg-white text-navy/50 hover:text-red-500 hover:border-red-200 text-xs font-semibold transition-colors cursor-pointer"
                                >
                                    {t('consultation.header.discard')}
                                </button>
                                <button
                                    onClick={handleFinish}
                                    disabled={isFinishing}
                                    className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-pink hover:bg-pink-dark text-white text-xs font-bold shadow-[0_2px_8px_rgba(233,30,140,0.25)] transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    {icons.check}
                                    {isFinishing ? t('consultation.header.finishing') : t('consultation.header.finish')}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {feedback}

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
                {/* ── Clinical column ── */}
                <div className="xl:col-span-2 space-y-5">
                    <SectionCard title={t('consultation.vitals.title')} icon={icons.pulse}>
                        <Field label={t('consultation.vitals.reason')}>
                            <input
                                value={form.reason}
                                onChange={(e) => setForm(p => ({ ...p, reason: e.target.value }))}
                                disabled={isCompleted}
                                placeholder={t('consultation.vitals.reason_placeholder')}
                                className={inputClass}
                            />
                        </Field>

                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                            <Field label={t('consultation.vitals.weight')}>
                                <input value={form.weight} onChange={(e) => setForm(p => ({ ...p, weight: e.target.value }))} disabled={isCompleted} inputMode="decimal" placeholder={t('consultation.vitals.weight_placeholder')} className={inputClass} />
                            </Field>
                            <Field label={t('consultation.vitals.height')}>
                                <input value={form.height} onChange={(e) => setForm(p => ({ ...p, height: e.target.value }))} disabled={isCompleted} inputMode="decimal" placeholder={t('consultation.vitals.height_placeholder')} className={inputClass} />
                            </Field>
                            <Field label={t('consultation.vitals.temperature')}>
                                <input value={form.temperature} onChange={(e) => setForm(p => ({ ...p, temperature: e.target.value }))} disabled={isCompleted} inputMode="decimal" placeholder={t('consultation.vitals.temperature_placeholder')} className={inputClass} />
                            </Field>
                            <Field label={t('consultation.vitals.blood_pressure')}>
                                <input value={form.bloodPressure} onChange={(e) => setForm(p => ({ ...p, bloodPressure: e.target.value }))} disabled={isCompleted} placeholder="120/80" className={inputClass} />
                            </Field>
                            <Field label={t('consultation.vitals.heart_rate')}>
                                <input value={form.heartRate} onChange={(e) => setForm(p => ({ ...p, heartRate: e.target.value }))} disabled={isCompleted} inputMode="numeric" placeholder={t('consultation.vitals.heart_rate_placeholder')} className={inputClass} />
                            </Field>
                        </div>

                        {bmi && (
                            <p className="text-[11px] font-semibold text-navy/40">{t('consultation.vitals.bmi', { value: bmi })}</p>
                        )}
                    </SectionCard>

                    <SectionCard title={t('consultation.clinical.title')} icon={icons.clipboard}>
                        <Field label={t('consultation.clinical.exam')}>
                            <textarea
                                value={form.examNotes}
                                onChange={(e) => setForm(p => ({ ...p, examNotes: e.target.value }))}
                                disabled={isCompleted}
                                placeholder={t('consultation.clinical.exam_placeholder')}
                                className={textareaClass}
                            />
                        </Field>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <Field label={t('consultation.clinical.diagnosis')}>
                                <textarea
                                    value={form.diagnosis}
                                    onChange={(e) => setForm(p => ({ ...p, diagnosis: e.target.value }))}
                                    disabled={isCompleted}
                                    placeholder={t('consultation.clinical.diagnosis_placeholder')}
                                    className={textareaClass}
                                />
                            </Field>
                            <Field label={t('consultation.clinical.plan')}>
                                <textarea
                                    value={form.treatmentPlan}
                                    onChange={(e) => setForm(p => ({ ...p, treatmentPlan: e.target.value }))}
                                    disabled={isCompleted}
                                    placeholder={t('consultation.clinical.plan_placeholder')}
                                    className={textareaClass}
                                />
                            </Field>
                        </div>
                        <Field label={t('consultation.clinical.follow_up_notes')}>
                            <textarea
                                value={form.followUpNotes}
                                onChange={(e) => setForm(p => ({ ...p, followUpNotes: e.target.value }))}
                                disabled={isCompleted}
                                placeholder={t('consultation.clinical.follow_up_placeholder')}
                                className={textareaClass}
                            />
                        </Field>
                    </SectionCard>

                    {/* Prescription */}
                    <SectionCard
                        title={t('consultation.prescription.title')}
                        icon={icons.pill}
                        action={
                            <div className="flex items-center gap-1 bg-navy/[0.04] p-1 rounded-xl">
                                {(['fr', 'en'] as PrescriptionLanguage[]).map((language) => (
                                    <button
                                        key={language}
                                        onClick={() => setPrescriptionLanguage(language)}
                                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase transition-colors cursor-pointer border-none ${prescriptionLanguage === language ? 'bg-white text-navy shadow-sm' : 'bg-transparent text-navy/40 hover:text-navy'}`}
                                    >
                                        {language}
                                    </button>
                                ))}
                            </div>
                        }
                    >
                        {!isCompleted && (
                            <>
                                <TemplateBar
                                    userId={currentUserId}
                                    currentMedicines={medications}
                                    onApply={applyTemplate}
                                />
                                <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
                                    <div className="col-span-2 lg:col-span-1">
                                        <MedicineNameInput
                                            value={medForm.medicineName}
                                            onChange={(v) => setMedForm(p => ({ ...p, medicineName: v }))}
                                            onPick={(line) => setMedForm(line)}
                                            onSubmit={addMedication}
                                            placeholder={t('consultation.prescription.medicine')}
                                            className={`${inputClass} w-full`}
                                        />
                                    </div>
                                    <input value={medForm.dosage} onChange={(e) => setMedForm(p => ({ ...p, dosage: e.target.value }))} placeholder={t('consultation.prescription.dosage')} className={inputClass} />
                                    <input value={medForm.frequency} onChange={(e) => setMedForm(p => ({ ...p, frequency: e.target.value }))} placeholder={t('consultation.prescription.frequency')} className={inputClass} />
                                    <input value={medForm.duration} onChange={(e) => setMedForm(p => ({ ...p, duration: e.target.value }))} placeholder={t('consultation.prescription.duration')} className={inputClass} />
                                    <input value={medForm.quantity} onChange={(e) => setMedForm(p => ({ ...p, quantity: e.target.value }))} placeholder={t('consultation.prescription.quantity')} className={inputClass} />
                                </div>
                                <button
                                    onClick={addMedication}
                                    disabled={!medForm.medicineName.trim()}
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-navy/5 text-navy hover:bg-navy/10 text-xs font-bold transition-colors cursor-pointer border-none disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {icons.plus}{t('consultation.prescription.add_medicine')}
                                </button>
                            </>
                        )}

                        {medications.length > 0 && (
                            <div className="space-y-2">
                                {medications.map((medication, index) => (
                                    <div key={index} className="flex items-start justify-between gap-3 p-3 rounded-xl bg-navy/[0.02] border border-navy/[0.05]">
                                        <div className="min-w-0">
                                            <span className="text-sm font-semibold text-navy">{medication.medicineName}</span>
                                            <span className="block text-[11px] text-navy/40">
                                                {[medication.dosage, medication.quantity, medication.frequency, medication.duration].filter(Boolean).join(' · ')}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => setMedications(prev => prev.filter((_, i) => i !== index))}
                                            className="p-1.5 text-navy/20 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors cursor-pointer bg-transparent border-none flex-shrink-0"
                                        >
                                            {icons.trash}
                                        </button>
                                    </div>
                                ))}

                                <Field label={t('consultation.prescription.notes')}>
                                    <textarea
                                        value={prescriptionNotes}
                                        onChange={(e) => setPrescriptionNotes(e.target.value)}
                                        placeholder={t('consultation.prescription.notes_placeholder')}
                                        className={`${inputClass} resize-y min-h-[64px]`}
                                    />
                                </Field>

                                <button
                                    onClick={handleSavePrescription}
                                    disabled={isSavingPrescription}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-pink hover:bg-pink-dark text-white text-xs font-bold shadow-[0_2px_8px_rgba(233,30,140,0.2)] transition-colors cursor-pointer border-none disabled:opacity-50"
                                >
                                    {isSavingPrescription
                                        ? t('consultation.prescription.generating')
                                        : t('consultation.prescription.save_and_print')}
                                </button>
                            </div>
                        )}

                        {prescriptions.length > 0 && (
                            <div className="space-y-2 pt-3 border-t border-navy/[0.06]">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-navy/35">{t('consultation.prescription.issued')}</p>
                                {prescriptions.map((prescription) => (
                                    <div key={prescription.id} className="p-3 rounded-xl bg-emerald-50/50 border border-emerald-100">
                                        <span className="text-xs font-bold text-navy">{t('consultation.prescription.item', { id: prescription.id })}</span>
                                        <span className="block text-[11px] text-navy/45 mt-0.5">
                                            {prescription.medicines.map(m => m.medicineName).join(', ')}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {medications.length === 0 && prescriptions.length === 0 && isCompleted && (
                            <p className="text-xs text-navy/35 font-medium text-center py-4">{t('consultation.prescription.none')}</p>
                        )}
                    </SectionCard>

                    {/* Certificats médicaux */}
                    <SectionCard title={t('certificates.title')} icon={icons.clipboard}>
                        <CertificateForm
                            userId={currentUserId}
                            patientId={patient?.id ?? null}
                            consultationId={consultation?.id ?? null}
                            language={prescriptionLanguage}
                            disabled={isCompleted}
                        />
                    </SectionCard>

                    {/* Documents */}
                    <SectionCard title={t('consultation.documents.title')} icon={icons.fileDoc}>
                        {!isCompleted && (
                            <div className="flex flex-wrap items-end gap-3">
                                <div className="flex-1 min-w-[180px]">
                                    <Field label={t('consultation.documents.category')}>
                                        <select
                                            value={uploadCategory}
                                            onChange={(e) => setUploadCategory(e.target.value)}
                                            className={`${inputClass} cursor-pointer`}
                                        >
                                            <option value="radiography">{t('documents.categories.radiography')}</option>
                                            <option value="analysis">{t('documents.categories.analysis')}</option>
                                            <option value="report">{t('consultation.documents.category_report')}</option>
                                            <option value="other">{t('documents.categories.other')}</option>
                                        </select>
                                    </Field>
                                </div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                    className="hidden"
                                    accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="px-4 py-2.5 rounded-xl border border-dashed border-navy/15 text-navy/55 hover:text-pink hover:border-pink/40 text-xs font-semibold transition-colors cursor-pointer bg-transparent max-w-[220px] truncate"
                                >
                                    {selectedFile ? selectedFile.name : t('consultation.documents.choose_file')}
                                </button>
                                <button
                                    onClick={handleUpload}
                                    disabled={!selectedFile || isUploading}
                                    className="px-4 py-2.5 rounded-xl bg-navy/5 text-navy hover:bg-navy/10 text-xs font-bold transition-colors cursor-pointer border-none disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {isUploading ? t('consultation.documents.uploading') : t('consultation.documents.attach')}
                                </button>
                            </div>
                        )}

                        {documents.length === 0 ? (
                            <p className="text-xs text-navy/35 font-medium text-center py-4">{t('consultation.documents.empty')}</p>
                        ) : (
                            <div className="divide-y divide-navy/[0.04]">
                                {documents.map((document) => (
                                    <div key={document.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <span className="w-8 h-8 rounded-lg bg-navy/5 text-navy/40 flex items-center justify-center flex-shrink-0">
                                                {icons.fileDoc}
                                            </span>
                                            <div className="min-w-0">
                                                <span className="block text-xs font-semibold text-navy truncate max-w-[260px]">{document.fileName}</span>
                                                <span className="text-[10px] text-navy/35 font-medium uppercase tracking-wider">{document.fileCategory}</span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => openDocument(document.localPath)}
                                            className="p-1.5 text-navy/25 hover:text-navy rounded-lg hover:bg-navy/5 transition-colors cursor-pointer bg-transparent border-none flex-shrink-0"
                                            title={t('consultation.documents.open')}
                                        >
                                            {icons.open}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </SectionCard>
                </div>

                {/* ── Context column ── */}
                <div className="space-y-5">
                    {/* Billing */}
                    <SectionCard title={t('consultation.billing.title')} icon={icons.wallet}>
                        <Field label={t('consultation.billing.fee')}>
                            <input
                                value={form.fee}
                                onChange={(e) => setForm(p => ({ ...p, fee: e.target.value }))}
                                disabled={isCompleted}
                                inputMode="decimal"
                                placeholder={t('consultation.billing.fee_placeholder')}
                                className={inputClass}
                            />
                        </Field>
                        <label className="flex items-center gap-2.5 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={form.isPaid}
                                onChange={(e) => setForm(p => ({ ...p, isPaid: e.target.checked }))}
                                disabled={isCompleted}
                                className="w-4 h-4 accent-pink cursor-pointer"
                            />
                            <span className="text-xs font-semibold text-navy/70">{t('consultation.billing.paid')}</span>
                        </label>
                        <p className="text-[10px] text-navy/35 leading-relaxed">{t('consultation.billing.hint')}</p>

                        {/* Part-payments, balance and receipts. The checkbox above
                            stays the settled flag; recording a payment drives it. */}
                        <div className="pt-3 mt-1 border-t border-navy/[0.06]">
                            <PaymentPanel
                                consultationId={consultation?.id ?? null}
                                userId={currentUserId}
                                defaultFee={defaultFee}
                                language={prescriptionLanguage}
                                // Both come from the form, not the database: the
                                // fields autosave on a debounce, and reading the
                                // database back on every keystroke re-ticked the
                                // box the user had just cleared.
                                settled={form.isPaid}
                                fee={toNumber(form.fee)}
                                onSettledChange={handleSettledChange}
                            />
                        </div>
                    </SectionCard>

                    {/* Follow-up appointment */}
                    <SectionCard title={t('consultation.follow_up.title')} icon={icons.calendar}>
                        {bookedFollowUp ? (
                            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700">
                                <span className="text-xs font-bold block">{t('consultation.follow_up.confirmed')}</span>
                                <span className="text-[11px]">
                                    {new Date(bookedFollowUp).toLocaleString(locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label={t('consultation.follow_up.date')}>
                                        <input
                                            type="date"
                                            value={followUp.date}
                                            min={todayKey()}
                                            onChange={(e) => setFollowUp(p => ({ ...p, date: e.target.value }))}
                                            className={inputClass}
                                        />
                                    </Field>
                                    <Field label={t('consultation.follow_up.time')}>
                                        <input
                                            type="time"
                                            value={followUp.time}
                                            onChange={(e) => setFollowUp(p => ({ ...p, time: e.target.value }))}
                                            className={inputClass}
                                        />
                                    </Field>
                                </div>
                                <Field label={t('consultation.follow_up.duration')}>
                                    <select
                                        value={followUp.duration}
                                        onChange={(e) => setFollowUp(p => ({ ...p, duration: e.target.value }))}
                                        className={`${inputClass} cursor-pointer`}
                                    >
                                        {['15', '30', '45', '60'].map(minutes => (
                                            <option key={minutes} value={minutes}>{t('consultation.follow_up.minutes', { value: minutes })}</option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label={t('consultation.follow_up.reason')}>
                                    <input
                                        value={followUp.reason}
                                        onChange={(e) => setFollowUp(p => ({ ...p, reason: e.target.value }))}
                                        placeholder={t('consultation.follow_up.default_reason')}
                                        className={inputClass}
                                    />
                                </Field>
                                <button
                                    onClick={handleBookFollowUp}
                                    disabled={!followUp.date || isBooking}
                                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-navy/5 text-navy hover:bg-navy/10 text-xs font-bold transition-colors cursor-pointer border-none disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {icons.plus}
                                    {isBooking ? t('consultation.follow_up.booking') : t('consultation.follow_up.book')}
                                </button>
                            </>
                        )}
                    </SectionCard>

                    {/* Patient history */}
                    <SectionCard title={t('consultation.history.title')} icon={icons.clipboard}>
                        {patientNote && (
                            <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-100">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700/70 block mb-1">
                                    {t('consultation.history.patient_notes')}
                                </span>
                                <p className="text-[11px] text-navy/60 line-clamp-4 whitespace-pre-wrap">{patientNote}</p>
                            </div>
                        )}

                        {pastConsultations.length === 0 ? (
                            <p className="text-xs text-navy/35 font-medium text-center py-4">{t('consultation.history.empty')}</p>
                        ) : (
                            <div className="space-y-2.5 max-h-[320px] overflow-y-auto">
                                {pastConsultations.slice(0, 8).map((past) => (
                                    <button
                                        key={past.id}
                                        onClick={() => navigate(`/consultation/${past.id}`)}
                                        className="w-full text-left p-3 rounded-xl bg-navy/[0.02] border border-navy/[0.05] hover:border-pink/20 transition-colors cursor-pointer"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-navy/35">
                                                {new Date(past.consultationDatetime).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })}
                                            </span>
                                            {past.isWalkIn && (
                                                <span className="text-[9px] font-bold text-amber-600">{t('consultation.walk_in_badge')}</span>
                                            )}
                                        </div>
                                        <p className="text-xs font-semibold text-navy mt-1 line-clamp-2">
                                            {past.diagnosis || past.reason || t('consultation.history.no_diagnosis')}
                                        </p>
                                        {(past.prescriptionCount > 0 || past.documentCount > 0) && (
                                            <p className="text-[10px] text-navy/35 mt-1">
                                                {t('consultation.history.artifacts', { prescriptions: past.prescriptionCount, documents: past.documentCount })}
                                            </p>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </SectionCard>
                </div>
            </div>
        </div>
    );
}
