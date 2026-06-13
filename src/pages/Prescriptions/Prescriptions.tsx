import { useEffect, useState } from 'react';
import type { DoctorProfile, Prescription } from '../../../types/doctor';
import type { Patient } from '../../../types/patient';

/* ─── Step type for the wizard flow ─── */
type Step = 'loading' | 'create-profile' | 'generate-pdf' | 'prescriptions';

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

function formatDate(dateStr: string) {
    if (!dateStr) return '—';
    try {
        return new Date(dateStr).toLocaleDateString('fr', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return dateStr; }
}

/* ═══════════════════════════════════════════════════════════════════ */
/*                       PRESCRIPTIONS PAGE                           */
/* ═══════════════════════════════════════════════════════════════════ */
export default function Prescriptions() {
    const [currentUserId, setCurrentUserId] = useState<number | null>(null);

    const [step, setStep] = useState<Step>('loading');
    const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
    const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
    const [patients, setPatients] = useState<Patient[]>([]);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');

    /* ── Load auth + initial data ── */
    useEffect(() => {
        (async () => {
            try {
                const auth = await (window as any).ipcRenderer.checkAuth();
                if (auth?.status === 'success' && auth.user?.id) {
                    setCurrentUserId(auth.user.id);
                } else {
                    // Not logged in — redirect
                    window.location.hash = '/';
                    return;
                }
            } catch {
                window.location.hash = '/';
            }
        })();
    }, []);

    useEffect(() => {
        if (currentUserId !== null) {
            loadData(currentUserId);
        }
    }, [currentUserId]);

    const loadData = async (userId: number) => {
        try {
            // Check if doctor profile exists
            const profileResult = await window.ipcRenderer.invoke('get-doctor-profile', userId);

            if (profileResult.status === 'success' && profileResult.data) {
                setDoctorProfile(profileResult.data);

                if (profileResult.data.pdfPath) {
                    setStep('prescriptions');
                    // Load prescriptions
                    const prescResult = await window.ipcRenderer.invoke('get-all-prescriptions');
                    if (prescResult.status === 'success') {
                        setPrescriptions(prescResult.data || []);
                    }
                } else {
                    setStep('generate-pdf');
                }
            } else {
                setStep('create-profile');
            }

            // Load patients for the prescription form
            const patientsData = await window.ipcRenderer.invoke('get-all-patients');
            setPatients(patientsData || []);
        } catch (error) {
            console.error('Error loading data:', error);
            setStep('create-profile');
        }
    };

    /* ── Create doctor profile ── */
    const handleCreateProfile = async (form: { fullName: string; speciality: string; phoneNumber: string; address: string; email: string }) => {
        try {
            console.log("creating doctor profile", currentUserId, form.fullName, form.speciality, form.phoneNumber, form.address, form.email)
            const result = await window.ipcRenderer.invoke(
                'create-doctor-profile',
                currentUserId,
                form.fullName,
                form.speciality,
                form.phoneNumber,
                form.address,
                form.email
            );
            if (result.status === 'success') {
                setDoctorProfile(result.data);
                setStep('generate-pdf');
                setShowProfileModal(false);
                showSuccess('Profil médecin créé avec succès !');
            } else {
                console.error('Failed to create doctor profile:', result);
            }
        } catch (error) {
            console.error('Error creating profile:', error);
        }
    };

    /* ── Generate PDF ── */
    const handleGeneratePdf = async () => {
        if (!doctorProfile) return;
        try {
            console.log("generating pdf")
            setIsGeneratingPdf(true);
            const result = await window.ipcRenderer.invoke('set-prescription-pdf', doctorProfile.id, '');
            console.log("pdf result", result)
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

    /* ── Add prescription ── */
    const handleAddPrescription = async (form: { patientId: number; medicineName: string; dosage: string; frequency: string; duration: string }) => {
        try {
            const result = await window.ipcRenderer.invoke(
                'add-prescription',
                currentUserId,
                form.patientId,
                form.medicineName,
                form.dosage,
                form.frequency,
                form.duration
            );
            if (result.status === 'success') {
                const prescResult = await window.ipcRenderer.invoke('get-all-prescriptions');
                if (prescResult.status === 'success') {
                    setPrescriptions(prescResult.data || []);
                }
                setShowAddModal(false);
                showSuccess('Ordonnance ajoutée avec succès !');
            }
        } catch (error) {
            console.error('Error adding prescription:', error);
        }
    };

    /* ── Delete prescription ── */
    const handleDelete = async (id: number) => {
        try {
            await window.ipcRenderer.invoke('delete-prescription', id);
            setPrescriptions(prev => prev.filter(p => p.id !== id));
        } catch (error) {
            console.error('Error deleting prescription:', error);
        }
    };

    const showSuccess = (msg: string) => {
        setSuccessMessage(msg);
        setTimeout(() => setSuccessMessage(''), 3000);
    };

    const getPatientName = (patientId: number) => {
        const patient = patients.find(p => p.id === patientId);
        return patient?.fullName || `Patient #${patientId}`;
    };

    /* ── Loading State ── */
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
                {step === 'prescriptions' && (
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="flex items-center gap-2 bg-gradient-to-r from-pink to-pink-light text-white text-sm font-semibold px-5 py-2.5 rounded-xl shadow-[0_4px_14px_rgba(233,30,140,0.25)] hover:shadow-[0_6px_20px_rgba(233,30,140,0.35)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 cursor-pointer"
                    >
                        {icons.plus}
                        <span>Nouvelle ordonnance</span>
                    </button>
                )}
            </div>

            {/* ═══════ Step 1: Create Profile ═══════ */}
            {step === 'create-profile' && (
                <div className="flex items-center justify-center min-h-[450px]">
                    <div className="bg-white rounded-2xl p-10 shadow-[0_2px_12px_rgba(30,42,86,0.06)] border border-navy/[0.04] max-w-md w-full text-center animate-[scaleIn_0.3s_ease-out]">
                        {/* Decorative icon */}
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-pink/10 to-pink/5 text-pink mb-5">
                            {icons.stethoscope}
                        </div>

                        <h2 className="text-xl font-bold text-navy mb-2">Bienvenue, Docteur ! 👋</h2>
                        <p className="text-sm text-navy/45 leading-relaxed mb-6">
                            Pour commencer à créer des ordonnances, veuillez d'abord configurer votre profil médecin.
                            Vos informations apparaîtront sur chaque ordonnance.
                        </p>

                        {/* Decorative dots */}
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
                        {/* Decorative icon */}
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-navy/10 to-navy/5 text-navy mb-5">
                            {icons.fileText}
                        </div>

                        <h2 className="text-xl font-bold text-navy mb-2">Générer votre modèle PDF ✨</h2>
                        <p className="text-sm text-navy/45 leading-relaxed mb-6">
                            Votre profil est prêt ! Générez maintenant votre modèle d'ordonnance personnalisé avec vos informations.
                        </p>

                        {/* Doctor info preview */}
                        <div className="bg-navy/[0.02] border border-navy/[0.06] rounded-xl p-4 mb-6 text-left space-y-2">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink to-pink-light flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                                    {doctorProfile.fullName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
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

                        {/* Progress dots */}
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

            {/* ═══════ Step 3: Prescriptions List ═══════ */}
            {step === 'prescriptions' && (
                <>
                    {/* Doctor profile summary card */}
                    {doctorProfile && (
                        <div className="bg-white rounded-2xl p-5 shadow-[0_2px_12px_rgba(30,42,86,0.06)] border border-navy/[0.04] flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink to-pink-light flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                                {doctorProfile.fullName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
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

                    {/* Prescriptions Table */}
                    <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(30,42,86,0.06)] overflow-hidden">
                        {prescriptions.length === 0 ? (
                            <div className="text-center py-16">
                                <div className="text-navy/15 text-5xl mb-4">💊</div>
                                <div className="text-sm text-navy/40 font-medium mb-1">Aucune ordonnance pour le moment</div>
                                <div className="text-xs text-navy/25 mb-5">Commencez par créer votre première ordonnance</div>
                                <button
                                    onClick={() => setShowAddModal(true)}
                                    className="inline-flex items-center gap-2 bg-gradient-to-r from-pink to-pink-light text-white text-xs font-semibold px-5 py-2.5 rounded-xl shadow-[0_4px_14px_rgba(233,30,140,0.2)] hover:shadow-[0_6px_20px_rgba(233,30,140,0.3)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 cursor-pointer"
                                >
                                    {icons.plus}
                                    Créer une ordonnance
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className="px-5 py-3 border-b border-navy/[0.06] flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-xs text-navy/40 font-medium">
                                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-navy to-navy-light flex items-center justify-center">
                                            <span className="text-[10px] font-bold text-white">{prescriptions.length}</span>
                                        </div>
                                        <span>{prescriptions.length} ordonnance{prescriptions.length > 1 ? 's' : ''}</span>
                                    </div>
                                </div>

                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="border-b border-navy/[0.06]">
                                                <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Patient</th>
                                                <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Médicament</th>
                                                <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Dosage</th>
                                                <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Fréquence</th>
                                                <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Durée</th>
                                                <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Date</th>
                                                <th className="w-16 px-5 py-3" />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {prescriptions.map((presc) => (
                                                <tr key={presc.id} className="group border-b border-navy/[0.03] hover:bg-navy/[0.015] transition-colors">
                                                    <td className="px-5 py-3.5">
                                                        <span className="text-sm font-medium text-navy">{getPatientName(presc.patientId)}</span>
                                                    </td>
                                                    <td className="px-5 py-3.5">
                                                        <span className="inline-flex items-center gap-1.5 text-sm text-navy/70">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-pink flex-shrink-0" />
                                                            {presc.medicineName}
                                                        </span>
                                                    </td>
                                                    <td className="px-5 py-3.5">
                                                        <span className="text-xs font-mono text-navy/50 bg-navy/[0.03] px-2 py-1 rounded-md">{presc.dosage}</span>
                                                    </td>
                                                    <td className="px-5 py-3.5">
                                                        <span className="text-sm text-navy/60">{presc.frequency}</span>
                                                    </td>
                                                    <td className="px-5 py-3.5">
                                                        <span className="text-sm text-navy/60">{presc.duration}</span>
                                                    </td>
                                                    <td className="px-5 py-3.5">
                                                        <span className="text-xs text-navy/40">{formatDate(presc.createdAt)}</span>
                                                    </td>
                                                    <td className="px-5 py-3.5">
                                                        <button
                                                            onClick={() => handleDelete(presc.id)}
                                                            className="p-1.5 rounded-lg text-navy/20 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                                                            title="Supprimer"
                                                        >
                                                            {icons.trash}
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Bottom add row */}
                                <div className="flex items-center gap-6 px-5 py-2.5 border-t border-navy/[0.04] text-navy/25 text-xs">
                                    <button onClick={() => setShowAddModal(true)} className="flex items-center gap-1.5 hover:text-pink transition-colors cursor-pointer">
                                        {icons.plus} Ajouter une ordonnance
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
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

            {/* ═══════ Create Profile Modal ═══════ */}
            {showProfileModal && (
                <CreateProfileModal
                    onClose={() => setShowProfileModal(false)}
                    onSave={handleCreateProfile}
                />
            )}

            {/* ═══════ Add Prescription Modal ═══════ */}
            {showAddModal && (
                <AddPrescriptionModal
                    patients={patients}
                    onClose={() => setShowAddModal(false)}
                    onSave={handleAddPrescription}
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

    const inputClass =
        'w-full px-4 py-2.5 text-sm bg-navy/[0.02] border border-navy/[0.08] rounded-xl text-navy placeholder:text-navy/25 focus:outline-none focus:ring-2 focus:ring-pink/20 focus:border-pink/30 transition-all duration-200';

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

/* ─────────────────────────────────────────────────────────────────── */
/*                   Add Prescription Modal                            */
/* ─────────────────────────────────────────────────────────────────── */
function AddPrescriptionModal({
    patients,
    onClose,
    onSave,
}: {
    patients: Patient[];
    onClose: () => void;
    onSave: (form: { patientId: number; medicineName: string; dosage: string; frequency: string; duration: string }) => void;
}) {
    const [form, setForm] = useState({
        patientId: '',
        medicineName: '',
        dosage: '',
        frequency: '',
        duration: '',
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({
            ...form,
            patientId: Number(form.patientId),
        });
    };

    const inputClass =
        'w-full px-4 py-2.5 text-sm bg-navy/[0.02] border border-navy/[0.08] rounded-xl text-navy placeholder:text-navy/25 focus:outline-none focus:ring-2 focus:ring-pink/20 focus:border-pink/30 transition-all duration-200';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-navy/30 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]" onClick={onClose} />

            <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-[0_24px_80px_rgba(30,42,86,0.18)] p-7 animate-[scaleIn_0.25s_ease-out]">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-lg font-bold text-navy">Nouvelle Ordonnance</h2>
                        <p className="text-xs text-navy/40 mt-0.5">Créer une ordonnance pour un patient</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl text-navy/30 hover:text-navy hover:bg-navy/[0.04] transition-colors cursor-pointer">
                        {icons.close}
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-navy/50 mb-1.5">Patient</label>
                        <select
                            required
                            value={form.patientId}
                            onChange={e => setForm(f => ({ ...f, patientId: e.target.value }))}
                            className={inputClass}
                        >
                            <option value="">Sélectionner un patient</option>
                            {patients.map(p => (
                                <option key={p.id} value={p.id}>{p.fullName}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-navy/50 mb-1.5">Médicament</label>
                        <input
                            required
                            value={form.medicineName}
                            onChange={e => setForm(f => ({ ...f, medicineName: e.target.value }))}
                            placeholder="ex: Paracétamol 500mg"
                            className={inputClass}
                        />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs font-semibold text-navy/50 mb-1.5">Dosage</label>
                            <input
                                required
                                value={form.dosage}
                                onChange={e => setForm(f => ({ ...f, dosage: e.target.value }))}
                                placeholder="500mg"
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-navy/50 mb-1.5">Fréquence</label>
                            <input
                                required
                                value={form.frequency}
                                onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
                                placeholder="3x/jour"
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-navy/50 mb-1.5">Durée</label>
                            <input
                                required
                                value={form.duration}
                                onChange={e => setForm(f => ({ ...f, duration: e.target.value }))}
                                placeholder="7 jours"
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
                            Ajouter l'ordonnance
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}