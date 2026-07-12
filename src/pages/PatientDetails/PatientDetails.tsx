import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Patient } from '../../../types/patient';
import type { PatientDocument } from '../../../types/documents';
import type { Prescription } from '../../../types/doctor';

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
};

const icons = {
    chevronLeft: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
        </svg>
    ),
    chevronRight: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 6 15 12 9 18" />
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
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
    ),
    edit: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
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
    plus: (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    ),
    check: (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    )
};

function getInitials(name: string) {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function getAvatarColor(name: string) {
    const colors = [
        'from-pink to-pink-light',
        'from-navy to-navy-light',
        'from-pink-dark to-pink',
        'from-navy-light to-navy',
        'from-pink-light to-pink',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

function formatDate(dateStr: string, locale: string = 'fr') {
    if (!dateStr) return '—';
    try {
        return new Date(dateStr).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return dateStr; }
}

const calculateAge = (dobString?: string) => {
    if (!dobString) return '';
    try {
        const birthDate = new Date(dobString);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        return age;
    } catch {
        return '';
    }
};

export default function PatientDetails() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();
    const isRtl = i18n.dir() === 'rtl';

    const [patientData, setPatientData] = useState<Patient | null>(null);
    const [documents, setDocuments] = useState<PatientDocument[]>([]);
    const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'activity' | 'prescriptions' | 'documents' | 'appointments' | 'notes'>('activity');

    // Notes state for editing
    const [notes, setNotes] = useState('');
    const [isSavingNotes, setIsSavingNotes] = useState(false);

    const handleGoBack = () => {
        navigate(-1);
    };

    const fetchPatientData = async () => {
        if (!id) return;
        try {
            setIsLoading(true);
            const patient = await window.ipcRenderer.invoke('get-patient-by-id', Number(id));
            setPatientData(patient);
            setNotes(patient?.notes || '');

            const docs = await window.ipcRenderer.invoke('get-documents-by-patient-id', Number(id));
            setDocuments(docs || []);

            const prescriptionsResult = await (window as any).ipcRenderer.getPatientPrescriptions(Number(id));
            if (prescriptionsResult.status === 'success') {
                setPrescriptions(prescriptionsResult.data || []);
            }

            const appointmentsResult = await (window as any).ipcRenderer.getAppointmentsByPatientId(Number(id));
            setAppointments(Array.isArray(appointmentsResult) ? appointmentsResult : []);
        } catch (error) {
            console.error("Error fetching patient details:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchPatientData();
    }, [id]);



    const handleDeleteDoc = async (docId: number) => {
        if (!confirm("Voulez-vous supprimer ce document ?")) return;
        try {
            await window.ipcRenderer.invoke('delete-document', docId);
            // Refresh documents
            const docs = await window.ipcRenderer.invoke('get-documents-by-patient-id', Number(id));
            setDocuments(docs || []);
        } catch (error) {
            console.error("Error deleting document:", error);
        }
    };

    const handleSaveNotes = async () => {
        if (!patientData) return;
        try {
            setIsSavingNotes(true);
            const updatedPatient = {
                ...patientData,
                notes: notes
            };
            await window.ipcRenderer.invoke('update-patient', updatedPatient);
            setPatientData(updatedPatient);
        } catch (error) {
            console.error("Error updating patient notes:", error);
        } finally {
            setIsSavingNotes(false);
        }
    };

    // Find linked PDF document for a prescription
    const findPdfDoc = (prescId: number, prescCreatedAt: string) => {
        // 1. Try exact match by prescriptionId
        const exact = documents.find(d => 
            d.fileCategory === 'prescription' && 
            d.prescriptionId != null && 
            String(d.prescriptionId) === String(prescId)
        );
        if (exact) return exact;

        // 2. Try fallback match by timestamp proximity (within 60 seconds)
        return documents.find(d => {
            if (d.fileCategory !== 'prescription') return false;
            if (d.prescriptionId !== null && d.prescriptionId !== undefined) return false;
            try {
                const pTime = new Date(prescCreatedAt.replace(' ', 'T')).getTime();
                const dTime = new Date(d.uploadDate.replace(' ', 'T')).getTime();
                return Math.abs(pTime - dTime) < 60000;
            } catch {
                return false;
            }
        });
    };

    /* ── Derived chronologically sorted timeline ── */
    const timelineItems = useMemo(() => {
        const items: {
            id: string;
            dateStr: string;
            dateObj: Date;
            title: string;
            type: 'prescription' | 'document';
            details?: string;
        }[] = [];

        prescriptions.forEach(p => {
            items.push({
                id: `presc-${p.id}`,
                dateStr: p.createdAt,
                dateObj: new Date(p.createdAt),
                title: `Ordonnance emise (Numero ${p.id})`,
                type: 'prescription',
                details: p.medicines.map(m => m.medicineName).join(', ')
            });
        });

        documents.forEach(d => {
            items.push({
                id: `doc-${d.id}`,
                dateStr: d.uploadDate,
                dateObj: new Date(d.uploadDate),
                title: `Document televerse (${d.fileName.split('_').slice(1).join('_') || d.fileName})`,
                type: 'document',
                details: `Categorie : ${d.fileCategory}`
            });
        });

        return items.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
    }, [prescriptions, documents]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-pink"></div>
            </div>
        );
    }

    if (!patientData) {
        return (
            <div className="space-y-4">
                <button onClick={handleGoBack} className="px-4 py-2 text-sm bg-navy/5 text-navy hover:bg-navy/10 rounded-xl transition-colors cursor-pointer flex items-center gap-2">
                    {isRtl ? icons.chevronRight : icons.chevronLeft}
                    {t('patient_details.back')}
                </button>
                <div className="bg-white p-6 rounded-2xl text-center text-navy/40 font-medium shadow-[0_2px_12px_rgba(30,42,86,0.06)]">
                    Patient non trouve
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Top Navigation & Action Header */}
            <div className="flex items-center justify-between">
                <button
                    onClick={handleGoBack}
                    className="group flex items-center gap-2 text-sm font-semibold text-navy/70 hover:text-navy transition-colors cursor-pointer"
                >
                    <span className="transition-transform group-hover:scale-110">
                        {isRtl ? icons.chevronRight : icons.chevronLeft}
                    </span>
                    <span>{patientData.fullName}</span>
                </button>

                <button
                    className="p-2.5 rounded-xl border border-navy/10 text-navy/60 hover:text-navy hover:bg-navy/[0.04] transition-all cursor-pointer bg-white shadow-sm"
                    title="Modifier le patient"
                >
                    {icons.edit}
                </button>
            </div>

            {/* Profile Card Header */}
            <div className="bg-white rounded-2xl p-6 shadow-[0_2px_12px_rgba(30,42,86,0.06)] border border-navy/[0.04] flex flex-col md:flex-row items-start md:items-center gap-5">
                {/* Avatar Initial */}
                <div className={`w-16 h-16 rounded-full bg-gradient-to-br ${getAvatarColor(patientData.fullName)} flex items-center justify-center text-xl font-bold text-white shadow-md flex-shrink-0`}>
                    {getInitials(patientData.fullName)}
                </div>

                {/* Patient Profile info */}
                <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-xl font-bold text-navy truncate">{patientData.fullName}</h2>
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/10">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Actif
                        </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-navy/50 font-medium">
                        <span>Age {calculateAge(patientData.dateOfBirth)} ans</span>
                        <span>•</span>
                        <span>Gr. Sanguin: {patientData.bloodType || '—'}</span>
                        <span>•</span>
                        <span>N Secu: {patientData.ssn || '—'}</span>
                    </div>

                    <div className="flex flex-wrap gap-4 pt-1.5 text-xs text-navy/40 font-medium">
                        <span className="flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 text-navy/35" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                            Ajoute le {formatDate(patientData.createdAt, i18n.language)}
                        </span>
                        <span className="flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 text-navy/35" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                            Rendez-vous : Aucun rendez-vous
                        </span>
                    </div>
                </div>

                {/* Quick Info Chips */}
                <div className="flex flex-col sm:flex-row md:flex-col lg:flex-row gap-2 w-full md:w-auto">
                    {patientData.phoneNumber && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-navy/10 text-navy/70 text-xs font-semibold bg-navy/[0.02]">
                            <svg className="w-3.5 h-3.5 text-navy/40 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                            <span className="truncate">{patientData.phoneNumber}</span>
                        </div>
                    )}
                    {patientData.address && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-navy/10 text-navy/70 text-xs font-semibold bg-navy/[0.02] max-w-xs">
                            <svg className="w-3.5 h-3.5 text-navy/40 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                            <span className="truncate">{patientData.address}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* General Overview Stats (No placeholders, displays real stats + appointment placeholder) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                <div className="bg-white rounded-2xl p-5 border border-navy/[0.04] shadow-[0_2px_12px_rgba(30,42,86,0.04)]">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-pink/5 rounded-xl text-pink">
                            {icons.pill}
                        </div>
                        <div>
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-navy/35">Ordonnances</span>
                            <span className="text-lg font-bold text-navy">{prescriptions.length} emise{prescriptions.length !== 1 ? 's' : ''}</span>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-2xl p-5 border border-navy/[0.04] shadow-[0_2px_12px_rgba(30,42,86,0.04)]">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-pink/5 rounded-xl text-pink">
                            {icons.fileDoc}
                        </div>
                        <div>
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-navy/35">Documents</span>
                            <span className="text-lg font-bold text-navy">{documents.length} fichier{documents.length !== 1 ? 's' : ''}</span>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-2xl p-5 border border-navy/[0.04] shadow-[0_2px_12px_rgba(30,42,86,0.04)]">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-pink/5 rounded-xl text-pink">
                            {icons.calendar}
                        </div>
                        <div>
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-navy/35">Prochain Rendez-vous</span>
                            <span className="text-sm font-semibold text-navy/55">Aucun planifie</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tab navigation */}
            <div className="border-b border-navy/[0.06] flex items-center gap-6 pt-2">
                {[
                    { key: 'activity', label: 'Activite' },
                    { key: 'prescriptions', label: `Ordonnances (${prescriptions.length})` },
                    { key: 'documents', label: `Documents (${documents.length})` },
                    { key: 'appointments', label: 'Rendez-vous' },
                    { key: 'notes', label: 'Notes de suivi' },
                ].map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key as any)}
                        className={`pb-3 text-sm font-semibold transition-all relative cursor-pointer ${activeTab === tab.key ? 'text-pink' : 'text-navy/40 hover:text-navy/70'}`}
                    >
                        {tab.label}
                        {activeTab === tab.key && (
                            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-pink rounded-full" />
                        )}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="bg-white rounded-2xl p-6 shadow-[0_2px_12px_rgba(30,42,86,0.06)] border border-navy/[0.04]">
                {activeTab === 'activity' && (
                    <div className="relative pl-6 border-l border-navy/[0.06] space-y-6 ml-2">
                        {timelineItems.length === 0 ? (
                            <div className="text-center py-6 text-navy/35 text-sm font-medium">
                                Aucune activite recente
                            </div>
                        ) : (
                            timelineItems.map((item) => (
                                <div key={item.id} className="relative">
                                    <span className="absolute -left-[31px] top-0.5 bg-pink/10 text-pink w-6 h-6 rounded-full flex items-center justify-center border border-white">
                                        {item.type === 'prescription' ? icons.pill : icons.fileDoc}
                                    </span>
                                    <div>
                                        <span className="block text-[10px] text-navy/30 font-semibold uppercase tracking-wider">
                                            {formatDate(item.dateStr, i18n.language)}
                                        </span>
                                        <span className="text-sm font-semibold text-navy">{item.title}</span>
                                        {item.details && (
                                            <p className="text-xs text-navy/40 mt-0.5">{item.details}</p>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {activeTab === 'prescriptions' && (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <h4 className="text-sm font-bold text-navy">Historique des ordonnances</h4>
                            <span className="text-xs text-navy/40 font-semibold">
                                {prescriptions.length} ordonnance{prescriptions.length !== 1 ? 's' : ''} au total
                            </span>
                        </div>

                        {prescriptions.length === 0 ? (
                            <div className="text-center py-10 text-navy/35 text-sm font-medium">
                                Aucune ordonnance redigee pour ce patient
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {prescriptions.map((presc) => (
                                    <div key={presc.id} className="p-4 bg-navy/[0.01] border border-navy/[0.06] rounded-2xl space-y-3 hover:border-pink/20 transition-all duration-200">
                                        <div className="flex items-center justify-between border-b border-navy/[0.04] pb-2">
                                            <div>
                                                <span className="text-sm font-bold text-navy">Ordonnance #{presc.id}</span>
                                                <span className="text-xs text-navy/40 ml-3">
                                                    {formatDate(presc.createdAt, i18n.language)}
                                                </span>
                                            </div>
                                            {(() => {
                                                const pdfDoc = findPdfDoc(presc.id, presc.createdAt);
                                                if (pdfDoc) {
                                                    return (
                                                        <button
                                                            onClick={async () => {
                                                                const err = await window.ipcRenderer.invoke('open-document', pdfDoc.localPath);
                                                                if (err) console.error('[open-document] error:', err);
                                                            }}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition-colors cursor-pointer"
                                                            title="Voir le PDF de l'ordonnance"
                                                        >
                                                            {icons.open}
                                                            Voir l'ordonnance
                                                        </button>
                                                    );
                                                }
                                                return (
                                                    <span className="text-xs text-navy/30 italic">Aucun PDF</span>
                                                );
                                            })()}
                                        </div>

                                        <div className="space-y-2">
                                            {presc.medicines.map((med, idx) => (
                                                <div key={med.id || idx} className="flex items-start gap-2.5 ml-1">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-pink/60 mt-1.5 flex-shrink-0" />
                                                    <div>
                                                        <span className="text-sm font-semibold text-navy">{med.medicineName}</span>
                                                        <span className="text-xs text-navy/40 ml-2">
                                                            {[med.dosage, med.quantity, med.frequency, med.duration].filter(Boolean).join(' - ')}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        {presc.notes && (
                                            <div className="text-xs text-navy/45 italic bg-navy/[0.02] p-2.5 rounded-xl border border-navy/[0.03]">
                                                Note : {presc.notes}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'documents' && (
                    <div className="space-y-5">
                        {/* Header & Upload Button */}
                        <div className="flex items-center justify-between">
                            <h4 className="text-sm font-bold text-navy">Documents du patient</h4>
                            <button
                                onClick={() => navigate('/documents', { state: { patient: patientData } })}
                                className="flex items-center gap-1.5 bg-navy/5 text-navy hover:bg-navy/10 text-xs font-semibold px-4.5 py-2 rounded-xl transition-all cursor-pointer border-none"
                            >
                                {icons.plus}
                                Ajouter un document
                            </button>
                        </div>

                        {/* Document List */}
                        {documents.length === 0 ? (
                            <div className="text-center py-10 text-navy/35 text-sm font-medium">
                                Aucun document disponible.
                            </div>
                        ) : (
                            <div className="divide-y divide-navy/[0.04]">
                                {documents.map((doc) => (
                                    <div key={doc.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-navy/5 text-navy/40 flex items-center justify-center">
                                                {icons.fileDoc}
                                            </div>
                                            <div>
                                                <span className="text-sm font-semibold text-navy block truncate max-w-[200px] sm:max-w-md">{doc.fileName}</span>
                                                <span className="text-[10px] text-navy/40 font-medium">Ajoute le {formatDate(doc.uploadDate, i18n.language)}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={async () => {
                                                    const err = await window.ipcRenderer.invoke('open-document', doc.localPath);
                                                    if (err) console.error('[open-document] error:', err);
                                                }}
                                                className="p-1.5 text-navy/20 hover:text-navy rounded-lg hover:bg-navy/5 transition-colors cursor-pointer"
                                                title="Ouvrir le document"
                                            >
                                                {icons.open}
                                            </button>
                                            <button
                                                onClick={() => handleDeleteDoc(doc.id)}
                                                className="p-1.5 text-navy/20 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                                                title="Supprimer le document"
                                            >
                                                {icons.trash}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'appointments' && (
                    <div className="space-y-5">
                        <div className="flex items-center justify-between">
                            <h4 className="text-sm font-bold text-navy">Rendez-vous du patient</h4>
                            <button
                                onClick={() => navigate('/appointments', { state: { patient: patientData } })}
                                className="flex items-center gap-1.5 bg-navy/5 text-navy hover:bg-navy/10 text-xs font-semibold px-4.5 py-2 rounded-xl transition-all cursor-pointer border-none"
                            >
                                {icons.plus}
                                Planifier un rendez-vous
                            </button>
                        </div>

                        {appointments.length === 0 ? (
                            <div className="text-center py-12">
                                <div className="mx-auto w-12 h-12 bg-pink/5 rounded-full flex items-center justify-center text-pink mb-3">
                                    {icons.calendar}
                                </div>
                                <p className="text-sm font-bold text-navy mb-1">Aucun rendez-vous planifie</p>
                                <p className="text-xs text-navy/40 max-w-xs mx-auto">
                                    Il n'y a pas de rendez-vous futur ou passe enregistre pour ce patient. Vous pouvez planifier une nouvelle consultation depuis l'onglet Rendez-vous de la barre latérale.
                                </p>
                            </div>
                        ) : (
                            <div className="divide-y divide-navy/[0.04]">
                                {appointments.map((app) => (
                                    <div key={app.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                                                app.status === 'Completed' ? 'bg-green-50 text-green-600' :
                                                app.status === 'Cancelled' ? 'bg-red-50 text-red-500' :
                                                app.status === 'No-Show' ? 'bg-amber-50 text-amber-500' :
                                                'bg-navy/5 text-navy/40'
                                            }`}>
                                                {icons.calendar}
                                            </div>
                                            <div>
                                                <span className="text-sm font-semibold text-navy block">
                                                    {new Date(app.appointment_datetime).toLocaleString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                                <span className="text-[10px] text-navy/40 font-medium">
                                                    {app.duration_minutes} min{app.reason ? ` · ${app.reason}` : ''}
                                                </span>
                                            </div>
                                        </div>
                                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border ${
                                            app.status === 'Completed' ? 'bg-green-50 text-green-700 border-green-200' :
                                            app.status === 'Cancelled' ? 'bg-red-50 text-red-600 border-red-200' :
                                            app.status === 'No-Show' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                                            'bg-navy/5 text-navy border-navy/10'
                                        }`}>
                                            {app.status === 'Scheduled' ? t('appointments.status.scheduled') :
                                                app.status === 'Completed' ? t('appointments.status.completed') :
                                                app.status === 'Cancelled' ? t('appointments.status.cancelled') :
                                                t('appointments.status.no_show')}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'notes' && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h4 className="text-sm font-bold text-navy">Notes & Antecedents</h4>
                            <button
                                onClick={handleSaveNotes}
                                disabled={isSavingNotes}
                                className="bg-pink hover:bg-pink-dark text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-[0_2px_8px_rgba(233,30,140,0.2)] disabled:opacity-50 cursor-pointer"
                            >
                                {isSavingNotes ? 'Enregistrement...' : 'Enregistrer'}
                            </button>
                        </div>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Saisissez vos observations medicales, antecedents, allergies ou traitements habituels..."
                            rows={6}
                            className="w-full p-4 text-sm bg-navy/[0.01] border border-navy/[0.08] rounded-2xl focus:outline-none focus:ring-2 focus:ring-pink/20 focus:border-pink/30 text-navy placeholder:text-navy/30 resize-none transition-all duration-200"
                        />
                    </div>
                )}
            </div>
        </div>
    );
}