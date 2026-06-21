import { useEffect, useState } from 'react';
import type { DoctorProfile, Prescription } from '../../../types/doctor';
import type { Patient } from '../../../types/patient';
import type { PatientDocument } from '../../../types/documents';

/* ─── Types ─── */
type Step = 'loading' | 'create-profile' | 'generate-pdf' | 'prescriptions';

type MedicationEntry = {
    medicineName: string;
    dosage: string;
    frequency: string;
    duration: string;
    quantity: string;
};

/* ─── Shared input class ─── */
const inputClass =
    'w-full px-4 py-2.5 text-sm bg-navy/[0.02] border border-navy/[0.08] rounded-xl text-navy placeholder:text-navy/25 focus:outline-none focus:ring-2 focus:ring-pink/20 focus:border-pink/30 transition-all duration-200';

/* ─── Inline SVG Icons ─── */
const icons = {
    stethoscope: (
        <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" />
            <path d="M8 15v1a6 6 0 0 0 6 6h.5" />
            <path d="M19 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
        </svg>
    ),
    fileText: (
        <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
        </svg>
    ),
    plus: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    ),
    close: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    ),
    trash: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
    ),
    pill: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m10.5 1.5 3 3L5 13 2 10l8.5-8.5z" /><path d="m13.5 4.5 3 3" /><path d="m2 13 6 6" /><path d="M16.5 7.5 22 2" />
        </svg>
    ),
    check: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    ),
    sparkles: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
        </svg>
    ),
};


function formatDateGroup(dateStr: string) {
    if (!dateStr) return '—';
    try {
        const d = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
        if (d.toDateString() === yesterday.toDateString()) return 'Hier';
        return d.toLocaleDateString('fr', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    } catch { return dateStr; }
}

/* ═══════════════════════════════════════════════════════════════════ */
/*                       PRESCRIPTIONS PAGE                           */
/* ═══════════════════════════════════════════════════════════════════ */
export default function Prescriptions() {
    /* ── Auth & wizard state ── */
    const [currentUserId, setCurrentUserId] = useState<number | null>(null);
    const [step, setStep] = useState<Step>('loading');
    const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');

    /* ── Patient selection ── */
    const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
    const [patientSearchQuery, setPatientSearchQuery] = useState('');
    const [patientSearchResults, setPatientSearchResults] = useState<Patient[]>([]);
    const [isSearchingPatient, setIsSearchingPatient] = useState(false);
    const [showPatientDropdown, setShowPatientDropdown] = useState(false);

    /* ── New ordonnance builder ── */
    const [newMedications, setNewMedications] = useState<MedicationEntry[]>([]);
    const [medForm, setMedForm] = useState<MedicationEntry>({
        medicineName: '', dosage: '', frequency: '', duration: '', quantity: '',
    });
    const [isSaving, setIsSaving] = useState(false);
    const [weight, setWeight] = useState('');

    /* ── Patient's existing prescriptions ── */
    const [patientPrescriptions, setPatientPrescriptions] = useState<Prescription[]>([]);
    const [patientDocuments, setPatientDocuments] = useState<PatientDocument[]>([]);
    const [prescriptionPage, setPrescriptionPage] = useState(0);
    const ROWS_PER_PAGE = 5;

    /* ── PDF generation ── */
    const [isGeneratingPatientPdf, setIsGeneratingPatientPdf] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    /* ══════════════════════ Effects ══════════════════════ */

    /* ── Load auth ── */
    useEffect(() => {
        (async () => {
            try {
                const auth = await (window as any).ipcRenderer.checkAuth();
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
        if (currentUserId !== null) loadData(currentUserId);
    }, [currentUserId]);

    const loadData = async (userId: number) => {
        try {
            const profileResult = await (window as any).ipcRenderer.invoke('get-doctor-profile', userId);
            if (profileResult.status === 'success' && profileResult.data) {
                setDoctorProfile(profileResult.data);
                setStep(profileResult.data.pdfPath ? 'prescriptions' : 'generate-pdf');
            } else {
                setStep('create-profile');
            }
        } catch (error) {
            console.error('Error loading data:', error);
            setStep('create-profile');
        }
    };

    /* ── Patient search (debounced) ── */
    useEffect(() => {
        if (!patientSearchQuery.trim() || selectedPatient) {
            if (!patientSearchQuery.trim()) {
                setPatientSearchResults([]);
                setShowPatientDropdown(false);
            }
            return;
        }
        const timer = setTimeout(async () => {
            setIsSearchingPatient(true);
            try {
                const results = await (window as any).ipcRenderer.searchPatient(patientSearchQuery);
                setPatientSearchResults(results || []);
                setShowPatientDropdown(true);
            } catch (e) {
                console.error('Search error:', e);
                setPatientSearchResults([]);
            } finally {
                setIsSearchingPatient(false);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [patientSearchQuery, selectedPatient]);

    /* ══════════════════════ Handlers ══════════════════════ */

    /* ── Create doctor profile ── */
    const handleCreateProfile = async (form: { fullName: string; speciality: string; phoneNumber: string; address: string; email: string }) => {
        try {
            const result = await (window as any).ipcRenderer.invoke(
                'create-doctor-profile',
                currentUserId, form.fullName, form.speciality, form.phoneNumber, form.address, form.email
            );
            if (result.status === 'success') {
                setDoctorProfile(result.data);
                setStep('generate-pdf');
                setShowProfileModal(false);
                showSuccess('Profil médecin créé avec succès !');
            } else {
                console.error('Create profile failed:', result.message);
                showError(result.message || 'Erreur lors de la création du profil');
            }
        } catch (error) {
            console.error('Error creating profile:', error);
            showError('Erreur lors de la création du profil');
        }
    };

    /* ── Generate PDF ── */
    const handleGeneratePdf = async () => {
        if (!doctorProfile) return;
        try {
            setIsGeneratingPdf(true);
            const result = await (window as any).ipcRenderer.invoke('set-prescription-pdf', doctorProfile.id);
            if (result.status === 'success') {
                setDoctorProfile(prev => prev ? { ...prev, pdfPath: result.data.pdfPath } : null);
                setStep('prescriptions');
                showSuccess('Modèle PDF généré avec succès !');
            }
        } catch (error) {
            console.error('Error generating PDF:', error);
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    /* ── Patient selection ── */
    const loadPatientPrescriptions = async (patientId: number) => {
        try {
            const [prescResult, docsResult] = await Promise.all([
                (window as any).ipcRenderer.getPatientPrescriptions(patientId),
                (window as any).ipcRenderer.invoke('get-documents-by-patient-id', patientId),
            ]);
            if (prescResult.status === 'success') {
                setPatientPrescriptions(prescResult.data || []);
                setPrescriptionPage(0);
            }
            setPatientDocuments(Array.isArray(docsResult) ? docsResult : []);
        } catch (e) {
            console.error('Error loading prescriptions:', e);
        }
    };

    const handleSelectPatient = async (patient: Patient) => {
        setSelectedPatient(patient);
        setPatientSearchQuery('');
        setShowPatientDropdown(false);
        setNewMedications([]);
        setMedForm({ medicineName: '', dosage: '', frequency: '', duration: '', quantity: '' });
        setWeight('');
        await loadPatientPrescriptions(patient.id);
    };

    const handleChangePatient = () => {
        setSelectedPatient(null);
        setPatientSearchQuery('');
        setPatientSearchResults([]);
        setShowPatientDropdown(false);
        setNewMedications([]);
        setPatientPrescriptions([]);
        setPatientDocuments([]);
        setPrescriptionPage(0);
        setWeight('');
    };

    /* ── Medication management ── */
    const handleAddMedication = () => {
        if (!medForm.medicineName.trim()) return;
        setNewMedications(prev => [...prev, { ...medForm }]);
        setMedForm({ medicineName: '', dosage: '', frequency: '', duration: '', quantity: '' });
    };

    const handleRemoveMedication = (index: number) => {
        setNewMedications(prev => prev.filter((_, i) => i !== index));
    };

    /* ── Save ordonnance ── */
    const handleSaveOrdonnance = async () => {
        if (!selectedPatient || !currentUserId || newMedications.length === 0) return;
        setIsSaving(true);
        try {
            // Create a single prescription with all medicines
            const result = await (window as any).ipcRenderer.invoke(
                'add-prescription',
                currentUserId,
                selectedPatient.id,
                newMedications,
            );

            if (result.status === 'success') {
                // Load the full prescription (with medicines) for PDF generation
                const prescriptionResult = await (window as any).ipcRenderer.invoke(
                    'get-prescription-by-id',
                    result.data.prescriptionId,
                    selectedPatient.id
                );

                // Generate PDF automatically after saving
                if (doctorProfile && prescriptionResult.status === 'success') {
                    await handleGeneratePatientPdf([prescriptionResult.data.prescription]);
                }

                setNewMedications([]);
                showSuccess('Ordonnance enregistrée et PDF généré avec succès !');
                await loadPatientPrescriptions(selectedPatient.id);
            } else {
                showError(result.message || 'Erreur lors de l\'enregistrement');
            }
        } catch (e) {
            console.error('Error saving ordonnance:', e);
            showError('Erreur lors de l\'enregistrement de l\'ordonnance');
        } finally {
            setIsSaving(false);
        }
    };

    /* ── Generate patient prescription PDF ── */
    const handleGeneratePatientPdf = async (prescriptions?: Prescription[]) => {
        if (!selectedPatient || !doctorProfile) return;
        const medsToUse = prescriptions || patientPrescriptions;
        if (medsToUse.length === 0) {
            showError('Aucun médicament à inclure dans le PDF');
            return;
        }
        setIsGeneratingPatientPdf(true);
        try {
            const result = await (window as any).ipcRenderer.generatePatientPrescriptionPDF(
                selectedPatient.id,
                medsToUse,
                doctorProfile,
                weight || undefined
            );
            if (result.status === 'success') {
                showSuccess('PDF de l\'ordonnance généré avec succès !');
                // Auto-open the generated PDF
                await (window as any).ipcRenderer.openDocument(result.data);
            } else {
                showError(result.message || 'Erreur lors de la génération du PDF');
            }
        } catch (e) {
            console.error('Error generating patient PDF:', e);
            showError('Erreur lors de la génération du PDF');
        } finally {
            setIsGeneratingPatientPdf(false);
        }
    };

    /* ── Delete prescription ── */
    const handleDeletePrescription = async (id: number) => {
        try {
            await (window as any).ipcRenderer.invoke('delete-prescription', id);
            setPatientPrescriptions(prev => prev.filter(p => p.id !== id));
            showSuccess('Médicament supprimé');
        } catch (e) {
            console.error('Error deleting prescription:', e);
        }
    };

    const showSuccess = (msg: string) => {
        setSuccessMessage(msg);
        setTimeout(() => setSuccessMessage(''), 3000);
    };

    const showError = (msg: string) => {
        setErrorMessage(msg);
        setTimeout(() => setErrorMessage(''), 4000);
    };

    const getInitials = (name: string) =>
        name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

    /* ══════════════════════ Loading ══════════════════════ */
    if (step === 'loading') {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-pink"></div>
            </div>
        );
    }

    /* ═══════════════════════════════ RENDER ═══════════════════════════════ */
    return (
        <div className="space-y-6">
            {/* ── Page Header ── */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-navy">Ordonnances</h1>
                    <p className="text-sm text-navy/50 mt-0.5">
                        Gérez vos ordonnances et votre profil médecin
                    </p>
                </div>
            </div>

            {/* ═══════ Step 1: Create Profile ═══════ */}
            {step === 'create-profile' && (
                <div className="flex items-center justify-center min-h-[450px]">
                    <div className="bg-white rounded-2xl p-10 shadow-[0_2px_12px_rgba(30,42,86,0.06)] border border-navy/[0.04] max-w-md w-full text-center animate-[scaleIn_0.3s_ease-out]">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-pink/10 to-pink/5 text-pink mb-5">
                            {icons.stethoscope}
                        </div>
                        <h2 className="text-xl font-bold text-navy mb-2">Bienvenue, Docteur ! 👋</h2>
                        <p className="text-sm text-navy/45 leading-relaxed mb-6">
                            Pour commencer à créer des ordonnances, veuillez d'abord configurer votre profil médecin.
                            Vos informations apparaîtront sur chaque ordonnance.
                        </p>
                        <div className="flex items-center justify-center gap-1.5 mb-6">
                            <span className="w-2 h-2 rounded-full bg-pink" />
                            <span className="w-2 h-2 rounded-full bg-navy/10" />
                            <span className="w-2 h-2 rounded-full bg-navy/10" />
                        </div>
                        <button
                            onClick={() => setShowProfileModal(true)}
                            className="inline-flex items-center gap-2 bg-gradient-to-r from-pink to-pink-light text-white text-sm font-semibold px-7 py-3 rounded-xl shadow-[0_4px_14px_rgba(233,30,140,0.25)] hover:shadow-[0_6px_20px_rgba(233,30,140,0.35)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 cursor-pointer"
                        >
                            {icons.plus}
                            Créer mon profil
                        </button>
                    </div>
                </div>
            )}

            {/* ═══════ Step 2: Generate PDF ═══════ */}
            {step === 'generate-pdf' && doctorProfile && (
                <div className="flex items-center justify-center min-h-[450px]">
                    <div className="bg-white rounded-2xl p-10 shadow-[0_2px_12px_rgba(30,42,86,0.06)] border border-navy/[0.04] max-w-lg w-full text-center animate-[scaleIn_0.3s_ease-out]">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-navy/10 to-navy/5 text-navy mb-5">
                            {icons.fileText}
                        </div>
                        <h2 className="text-xl font-bold text-navy mb-2">Générer votre modèle PDF ✨</h2>
                        <p className="text-sm text-navy/45 leading-relaxed mb-6">
                            Votre profil est prêt ! Générez maintenant votre modèle d'ordonnance personnalisé avec vos informations.
                        </p>
                        <div className="bg-navy/[0.02] border border-navy/[0.06] rounded-xl p-4 mb-6 text-left space-y-2">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink to-pink-light flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                                    {getInitials(doctorProfile.fullName)}
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-navy">Dr. {doctorProfile.fullName}</p>
                                    <p className="text-xs text-navy/40">{doctorProfile.speciality}</p>
                                </div>
                            </div>
                            <div className="border-t border-navy/[0.06] pt-2 grid grid-cols-3 gap-2">
                                <div>
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-navy/30">Email</span>
                                    <p className="text-xs text-navy/60">{doctorProfile.email}</p>
                                </div>
                                <div>
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-navy/30">Téléphone</span>
                                    <p className="text-xs text-navy/60">{doctorProfile.phoneNumber}</p>
                                </div>
                                <div>
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-navy/30">Adresse</span>
                                    <p className="text-xs text-navy/60">{doctorProfile.address}</p>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center justify-center gap-1.5 mb-6">
                            <span className="w-2 h-2 rounded-full bg-pink/30" />
                            <span className="w-2 h-2 rounded-full bg-pink" />
                            <span className="w-2 h-2 rounded-full bg-navy/10" />
                        </div>
                        <button
                            onClick={handleGeneratePdf}
                            disabled={isGeneratingPdf}
                            className="inline-flex items-center gap-2 bg-gradient-to-r from-navy to-navy-light text-white text-sm font-semibold px-7 py-3 rounded-xl shadow-[0_4px_14px_rgba(30,42,86,0.25)] hover:shadow-[0_6px_20px_rgba(30,42,86,0.35)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isGeneratingPdf ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Génération en cours...
                                </>
                            ) : (
                                <>
                                    {icons.sparkles}
                                    Générer le modèle PDF
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* ═══════ Step 3: Prescriptions Workspace ═══════ */}
            {step === 'prescriptions' && (
                <>
                    {/* ── Doctor profile summary card ── */}
                    {doctorProfile && (
                        <div className="bg-white rounded-2xl p-5 shadow-[0_2px_12px_rgba(30,42,86,0.06)] border border-navy/[0.04] flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink to-pink-light flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                                {getInitials(doctorProfile.fullName)}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-navy">Dr. {doctorProfile.fullName}</p>
                                <p className="text-xs text-navy/40">{doctorProfile.speciality} • {doctorProfile.email} • {doctorProfile.phoneNumber}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                {doctorProfile.pdfPath && (
                                    <button
                                        onClick={() => (window as any).ipcRenderer.openDocument(doctorProfile.pdfPath)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-navy/[0.04] text-navy/60 text-xs font-semibold hover:bg-navy/[0.08] hover:text-navy transition-all duration-200 cursor-pointer"
                                    >
                                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                                        </svg>
                                        <span>Voir l'ordonnance</span>
                                    </button>
                                )}
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-600 text-xs font-semibold">
                                    {icons.check}
                                    <span>PDF configuré</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── Patient Selection or Workspace ── */}
                    {!selectedPatient ? (
                        /* ═══════ Patient Search Card ═══════ */
                        <div className="bg-white rounded-2xl p-8 shadow-[0_2px_12px_rgba(30,42,86,0.06)] border border-navy/[0.04]">
                            <div className="max-w-md mx-auto text-center">
                                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-pink/10 to-pink/5 text-pink mb-4">
                                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                                    </svg>
                                </div>
                                <h2 className="text-lg font-bold text-navy mb-1">Sélectionner un patient</h2>
                                <p className="text-xs text-navy/40 mb-5">Recherchez un patient pour créer ou consulter ses ordonnances</p>

                                <div className="relative text-left">
                                    <div className="relative">
                                        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-navy/25 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                                        </svg>
                                        <input
                                            value={patientSearchQuery}
                                            onChange={e => setPatientSearchQuery(e.target.value)}
                                            onFocus={() => { if (patientSearchResults.length > 0) setShowPatientDropdown(true); }}
                                            placeholder="Rechercher par nom..."
                                            className={`${inputClass} pl-10`}
                                            autoComplete="off"
                                        />
                                        {isSearchingPatient && (
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                <div className="w-4 h-4 border-2 border-navy/10 border-t-pink rounded-full animate-spin" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Search results dropdown */}
                                    {showPatientDropdown && (
                                        <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-navy/[0.08] rounded-xl shadow-[0_8px_30px_rgba(30,42,86,0.12)] max-h-48 overflow-y-auto">
                                            {patientSearchResults.length === 0 ? (
                                                <div className="px-4 py-3 text-xs text-navy/35 text-center">Aucun patient trouvé</div>
                                            ) : (
                                                patientSearchResults.map(patient => (
                                                    <button
                                                        key={patient.id}
                                                        onClick={() => handleSelectPatient(patient)}
                                                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-navy/[0.03] transition-colors cursor-pointer text-left"
                                                    >
                                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink/20 to-pink-light/20 flex items-center justify-center text-pink text-xs font-bold flex-shrink-0">
                                                            {getInitials(patient.fullName)}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm font-medium text-navy truncate">{patient.fullName}</p>
                                                            {patient.phoneNumber && <p className="text-[11px] text-navy/35">{patient.phoneNumber}</p>}
                                                        </div>
                                                    </button>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* ═══════ Selected Patient Card ═══════ */}
                            <div className="bg-white rounded-2xl p-4 shadow-[0_2px_12px_rgba(30,42,86,0.06)] border border-navy/[0.04] flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink/20 to-pink-light/20 flex items-center justify-center text-pink text-sm font-bold flex-shrink-0">
                                    {getInitials(selectedPatient.fullName)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-navy">{selectedPatient.fullName}</p>
                                    <p className="text-xs text-navy/40">
                                        {[selectedPatient.phoneNumber].filter(Boolean).join(' • ')}
                                    </p>
                                </div>
                                <button
                                    onClick={handleChangePatient}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-navy/[0.04] text-navy/50 text-xs font-medium hover:bg-navy/[0.08] hover:text-navy transition-all duration-200 cursor-pointer"
                                >
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" />
                                    </svg>
                                    <span>Changer</span>
                                </button>
                            </div>

                            {/* ═══════ New Ordonnance Builder ═══════ */}
                            <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(30,42,86,0.06)] border border-navy/[0.04] overflow-hidden">
                                <div className="px-5 py-3.5 border-b border-navy/[0.06] flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-pink to-pink-light flex items-center justify-center">
                                        {icons.plus}
                                    </div>
                                    <h3 className="text-sm font-bold text-navy">Nouvelle Ordonnance</h3>
                                </div>

                                <div className="p-5 space-y-4">
                                    {/* Weight input (optional) */}
                                    <div>
                                        <label className="block text-xs font-semibold text-navy/50 mb-1.5">Poids du patient <span className="text-navy/25 font-normal">(optionnel)</span></label>
                                        <input
                                            value={weight}
                                            onChange={e => setWeight(e.target.value)}
                                            placeholder="ex: 70 kg"
                                            className={`${inputClass} max-w-[200px]`}
                                        />
                                    </div>
                                    {/* Medication input form */}
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-xs font-semibold text-navy/50 mb-1.5">Médicament</label>
                                            <input
                                                value={medForm.medicineName}
                                                onChange={e => setMedForm(f => ({ ...f, medicineName: e.target.value }))}
                                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddMedication(); } }}
                                                placeholder="Nom du médicament"
                                                className={inputClass}
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-xs font-semibold text-navy/50 mb-1.5">Dosage</label>
                                                <input
                                                    value={medForm.dosage}
                                                    onChange={e => setMedForm(f => ({ ...f, dosage: e.target.value }))}
                                                    placeholder="ex: 500mg"
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-navy/50 mb-1.5">Quantité</label>
                                                <input
                                                    value={medForm.quantity}
                                                    onChange={e => setMedForm(f => ({ ...f, quantity: e.target.value }))}
                                                    placeholder="ex: 2 boîtes"
                                                    className={inputClass}
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-xs font-semibold text-navy/50 mb-1.5">Fréquence</label>
                                                <input
                                                    value={medForm.frequency}
                                                    onChange={e => setMedForm(f => ({ ...f, frequency: e.target.value }))}
                                                    placeholder="ex: 3x/jour"
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-navy/50 mb-1.5">Durée</label>
                                                <input
                                                    value={medForm.duration}
                                                    onChange={e => setMedForm(f => ({ ...f, duration: e.target.value }))}
                                                    placeholder="ex: 7 jours"
                                                    className={inputClass}
                                                />
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={handleAddMedication}
                                            disabled={!medForm.medicineName.trim()}
                                            className="flex items-center gap-1.5 text-xs font-semibold text-pink hover:text-pink-light transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                        >
                                            {icons.plus}
                                            Ajouter le médicament
                                        </button>
                                    </div>

                                    {/* Added medications list */}
                                    {newMedications.length > 0 && (
                                        <div className="border-t border-navy/[0.06] pt-4 space-y-2">
                                            <p className="text-[11px] font-semibold uppercase tracking-wider text-navy/30 mb-2">
                                                Médicaments ajoutés ({newMedications.length})
                                            </p>
                                            {newMedications.map((med, index) => (
                                                <div key={index} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-navy/[0.02] border border-navy/[0.04] group">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-pink flex-shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium text-navy">{med.medicineName}</p>
                                                        <p className="text-[11px] text-navy/40">
                                                            {[med.dosage, med.quantity, med.frequency, med.duration].filter(Boolean).join(' • ')}
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={() => handleRemoveMedication(index)}
                                                        className="p-1 rounded-lg text-navy/20 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                                                    >
                                                        {icons.trash}
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Save ordonnance button */}
                                {newMedications.length > 0 && (
                                    <div className="px-5 py-3.5 border-t border-navy/[0.06] flex justify-end">
                                        <button
                                            onClick={handleSaveOrdonnance}
                                            disabled={isSaving || isGeneratingPatientPdf}
                                            className="flex items-center gap-2 bg-gradient-to-r from-pink to-pink-light text-white text-sm font-semibold px-6 py-2.5 rounded-xl shadow-[0_4px_14px_rgba(233,30,140,0.25)] hover:shadow-[0_6px_20px_rgba(233,30,140,0.35)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isSaving || isGeneratingPatientPdf ? (
                                                <>
                                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                    {isGeneratingPatientPdf ? 'Génération PDF...' : 'Enregistrement...'}
                                                </>
                                            ) : (
                                                <>
                                                    {icons.check}
                                                    Enregistrer & Générer PDF
                                                </>
                                            )}
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* ═══════ Past Ordonnances ═══════ */}
                            <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(30,42,86,0.06)] border border-navy/[0.04] overflow-hidden">
                                <div className="px-5 py-3.5 border-b border-navy/[0.06] flex items-center justify-between">
                                    <h3 className="text-sm font-bold text-navy">Ordonnances précédentes</h3>
                                    <div className="flex items-center gap-2">
                                        {patientPrescriptions.length > 0 && (
                                            <>
                                                <button
                                                    onClick={() => handleGeneratePatientPdf()}
                                                    disabled={isGeneratingPatientPdf}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-pink/10 to-pink-light/10 text-pink text-xs font-semibold hover:from-pink/20 hover:to-pink-light/20 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {isGeneratingPatientPdf ? (
                                                        <div className="w-3.5 h-3.5 border-2 border-pink/30 border-t-pink rounded-full animate-spin" />
                                                    ) : (
                                                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                                                            <polyline points="14 2 14 8 20 8" />
                                                        </svg>
                                                    )}
                                                    Générer PDF
                                                </button>
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-navy to-navy-light flex items-center justify-center">
                                                        <span className="text-[9px] font-bold text-white">{patientPrescriptions.length}</span>
                                                    </div>
                                                    <span className="text-xs text-navy/35">{patientPrescriptions.length} ordonnance{patientPrescriptions.length > 1 ? 's' : ''}</span>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {patientPrescriptions.length === 0 ? (
                                    <div className="text-center py-12">
                                        <div className="text-navy/15 text-4xl mb-3">📋</div>
                                        <p className="text-sm text-navy/35 font-medium mb-1">Aucune ordonnance précédente</p>
                                        <p className="text-xs text-navy/25">Les ordonnances enregistrées pour ce patient apparaîtront ici</p>
                                    </div>
                                ) : (() => {
                                    const paginatedPrescs = patientPrescriptions.slice(prescriptionPage * ROWS_PER_PAGE, (prescriptionPage + 1) * ROWS_PER_PAGE);

                                    // Group paginated prescriptions by date
                                    const grouped: { dateLabel: string; items: Prescription[] }[] = [];
                                    let lastDateKey = '';
                                    for (const presc of paginatedPrescs) {
                                        const dateKey = new Date(presc.createdAt).toDateString();
                                        if (dateKey !== lastDateKey) {
                                            grouped.push({ dateLabel: formatDateGroup(presc.createdAt), items: [presc] });
                                            lastDateKey = dateKey;
                                        } else {
                                            grouped[grouped.length - 1].items.push(presc);
                                        }
                                    }

                                    // Find linked PDF document for a prescription
                                    const findPdfDoc = (presc: Prescription) => {
                                        // 1. Try exact match by prescriptionId
                                        const exact = patientDocuments.find(d => 
                                            d.fileCategory === 'prescription' && 
                                            d.prescriptionId != null && 
                                            String(d.prescriptionId) === String(presc.id)
                                        );
                                        if (exact) return exact;

                                        // 2. Try fallback match by timestamp proximity (within 60 seconds)
                                        return patientDocuments.find(d => {
                                            if (d.fileCategory !== 'prescription') return false;
                                            if (d.prescriptionId !== null && d.prescriptionId !== undefined) return false;
                                            try {
                                                const pTime = new Date(presc.createdAt.replace(' ', 'T')).getTime();
                                                const dTime = new Date(d.uploadDate.replace(' ', 'T')).getTime();
                                                return Math.abs(pTime - dTime) < 60000;
                                            } catch {
                                                return false;
                                            }
                                        });
                                    };

                                    const handleViewPdf = async (localPath: string) => {
                                        try {
                                            await (window as any).ipcRenderer.invoke('open-document', localPath);
                                        } catch (e) {
                                            console.error('Error opening PDF:', e);
                                        }
                                    };

                                    return (
                                        <>
                                            <div>
                                                {grouped.map((group, gi) => (
                                                    <div key={gi}>
                                                        {/* Date header */}
                                                        <div className="px-5 py-2 bg-navy/[0.02] border-b border-navy/[0.04] sticky top-0">
                                                            <span className="text-[11px] font-semibold uppercase tracking-wider text-navy/35">
                                                                📅 {group.dateLabel}
                                                            </span>
                                                        </div>
                                                        {/* Prescriptions in this date group */}
                                                        <div className="divide-y divide-navy/[0.04]">
                                                            {group.items.map(presc => {
                                                                const pdfDoc = findPdfDoc(presc);
                                                                return (
                                                                    <div key={presc.id} className="px-5 py-3.5 group hover:bg-navy/[0.015] transition-colors">
                                                                        <div className="flex items-start gap-3">
                                                                            <div className="flex-1 min-w-0">
                                                                                <div className="flex items-center gap-2 mb-1">
                                                                                    <p className="text-xs font-semibold text-navy/40">
                                                                                        Ordonnance #{presc.id} — {presc.medicines.length} médicament{presc.medicines.length > 1 ? 's' : ''}
                                                                                    </p>
                                                                                    <span className="text-[10px] text-navy/20">
                                                                                        {new Date(presc.createdAt).toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' })}
                                                                                    </span>
                                                                                </div>
                                                                                {presc.medicines.map((med) => (
                                                                                    <div key={med.id} className="flex items-center gap-2 ml-2 mb-0.5">
                                                                                        <span className="w-1.5 h-1.5 rounded-full bg-pink/60 flex-shrink-0" />
                                                                                        <div className="flex-1 min-w-0">
                                                                                            <span className="text-sm font-medium text-navy">{med.medicineName}</span>
                                                                                            <span className="text-[11px] text-navy/40 ml-2">
                                                                                                {[med.dosage, med.quantity, med.frequency, med.duration].filter(Boolean).join(' • ')}
                                                                                            </span>
                                                                                        </div>
                                                                                    </div>
                                                                                ))}
                                                                                {presc.notes && (
                                                                                    <p className="text-[11px] text-navy/35 italic mt-1 ml-2">📝 {presc.notes}</p>
                                                                                )}
                                                                            </div>
                                                                            {/* Actions */}
                                                                            <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                                {pdfDoc ? (
                                                                                    <button
                                                                                        onClick={() => handleViewPdf(pdfDoc.localPath)}
                                                                                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition-colors cursor-pointer"
                                                                                        title="Voir le PDF"
                                                                                    >
                                                                                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                                            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                                                                                            <polyline points="14 2 14 8 20 8" />
                                                                                        </svg>
                                                                                        PDF
                                                                                    </button>
                                                                                ) : (
                                                                                    <span className="text-[10px] text-navy/20 italic">Aucun PDF</span>
                                                                                )}
                                                                                <button
                                                                                    onClick={() => handleDeletePrescription(presc.id)}
                                                                                    className="p-1.5 rounded-lg text-navy/20 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                                                                                    title="Supprimer"
                                                                                >
                                                                                    {icons.trash}
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            {/* Pagination */}
                                            {patientPrescriptions.length > ROWS_PER_PAGE && (
                                                <div className="px-5 py-3 border-t border-navy/[0.06] flex items-center justify-between">
                                                    <span className="text-xs text-navy/35">
                                                        {prescriptionPage * ROWS_PER_PAGE + 1}–{Math.min((prescriptionPage + 1) * ROWS_PER_PAGE, patientPrescriptions.length)} sur {patientPrescriptions.length}
                                                    </span>
                                                    <div className="flex items-center gap-1.5">
                                                        <button
                                                            onClick={() => setPrescriptionPage(p => p - 1)}
                                                            disabled={prescriptionPage === 0}
                                                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-navy/50 hover:bg-navy/[0.04] hover:text-navy transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                                        >
                                                            ← Précédent
                                                        </button>
                                                        <button
                                                            onClick={() => setPrescriptionPage(p => p + 1)}
                                                            disabled={(prescriptionPage + 1) * ROWS_PER_PAGE >= patientPrescriptions.length}
                                                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-navy/50 hover:bg-navy/[0.04] hover:text-navy transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                                        >
                                                            Suivant →
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                        </>
                    )}
                </>
            )}

            {/* ═══════ Success Toast ═══════ */}
            {successMessage && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-navy text-white px-6 py-3 rounded-2xl shadow-[0_8px_30px_rgba(30,42,86,0.25)] animate-[slideUp_0.25s_ease-out]">
                    <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                        {icons.check}
                    </span>
                    <span className="text-sm font-medium">{successMessage}</span>
                </div>
            )}

            {/* ═══════ Error Toast ═══════ */}
            {errorMessage && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-red-600 text-white px-6 py-3 rounded-2xl shadow-[0_8px_30px_rgba(220,38,38,0.25)] animate-[slideUp_0.25s_ease-out]">
                    <span className="w-6 h-6 rounded-full bg-white/20 text-white flex items-center justify-center">
                        {icons.close}
                    </span>
                    <span className="text-sm font-medium">{errorMessage}</span>
                </div>
            )}

            {/* ═══════ Create Profile Modal ═══════ */}
            {showProfileModal && (
                <CreateProfileModal
                    onClose={() => setShowProfileModal(false)}
                    onSave={handleCreateProfile}
                />
            )}
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────────── */
/*                 Create Doctor Profile Modal                         */
/* ─────────────────────────────────────────────────────────────────── */
function CreateProfileModal({
    onClose,
    onSave,
}: {
    onClose: () => void;
    onSave: (form: { fullName: string; speciality: string; phoneNumber: string; address: string; email: string }) => void;
}) {
    const [form, setForm] = useState({
        fullName: '',
        speciality: '',
        phoneNumber: '',
        address: '',
        email: '',
    });
    const [phoneError, setPhoneError] = useState('');

    const validatePhone = (value: string) => {
        if (value.length > 0 && value.length < 10) {
            setPhoneError('Le numéro doit contenir 10 chiffres');
        } else if (value.length === 10 && !/^(05|06|07)/.test(value)) {
            setPhoneError('Le numéro doit commencer par 05, 06 ou 07');
        } else {
            setPhoneError('');
        }
    };

    const isPhoneValid = form.phoneNumber.length === 10 && /^(05|06|07)/.test(form.phoneNumber);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!isPhoneValid) {
            setPhoneError('Le numéro doit contenir 10 chiffres et commencer par 05, 06 ou 07');
            return;
        }
        onSave(form);
    };

    const specialities = [
        'Médecine Générale',
        'Cardiologie',
        'Dermatologie',
        'Pédiatrie',
        'Ophtalmologie',
        'ORL',
        'Gynécologie',
        'Neurologie',
        'Orthopédie',
        'Psychiatrie',
        'Radiologie',
        'Chirurgie',
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-navy/30 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]" onClick={onClose} />

            <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-[0_24px_80px_rgba(30,42,86,0.18)] p-7 animate-[scaleIn_0.25s_ease-out]">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-lg font-bold text-navy">Profil Médecin</h2>
                        <p className="text-xs text-navy/40 mt-0.5">Ces informations figureront sur vos ordonnances</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl text-navy/30 hover:text-navy hover:bg-navy/[0.04] transition-colors cursor-pointer">
                        {icons.close}
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-navy/50 mb-1.5">Nom complet</label>
                        <input
                            required
                            value={form.fullName}
                            onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                            placeholder="Dr. Mohammed Benali"
                            className={inputClass}
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-navy/50 mb-1.5">Email</label>
                        <input
                            type="email"
                            value={form.email}
                            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                            placeholder="dr.benali@example.com"
                            className={inputClass}
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-navy/50 mb-1.5">Spécialité</label>
                        <select
                            required
                            value={form.speciality}
                            onChange={e => setForm(f => ({ ...f, speciality: e.target.value }))}
                            className={inputClass}
                        >
                            <option value="">Sélectionner une spécialité</option>
                            {specialities.map(s => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-semibold text-navy/50 mb-1.5">Téléphone</label>
                            <input
                                required
                                maxLength={10}
                                value={form.phoneNumber}
                                onChange={e => {
                                    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                                    setForm(f => ({ ...f, phoneNumber: digits }));
                                    validatePhone(digits);
                                }}
                                placeholder="0555123456"
                                className={`${inputClass} ${phoneError ? 'border-red-400 focus:ring-red-200 focus:border-red-400' : ''}`}
                            />
                            {phoneError && (
                                <p className="text-[11px] text-red-500 mt-1">{phoneError}</p>
                            )}
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-navy/50 mb-1.5">Adresse du cabinet</label>
                            <input
                                required
                                value={form.address}
                                onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                                placeholder="123 Rue des Oliviers, Alger"
                                className={inputClass}
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-5 py-2.5 text-sm font-medium text-navy/50 hover:text-navy hover:bg-navy/[0.04] rounded-xl transition-colors cursor-pointer"
                        >
                            Annuler
                        </button>
                        <button
                            type="submit"
                            className="px-6 py-2.5 text-sm font-semibold bg-gradient-to-r from-pink to-pink-light text-white rounded-xl shadow-[0_4px_14px_rgba(233,30,140,0.25)] hover:shadow-[0_6px_20px_rgba(233,30,140,0.35)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 cursor-pointer"
                        >
                            Créer le profil
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}