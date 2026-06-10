import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Patient } from '../../../types/patient';
import type { PatientDocument } from '../../../types/documents';

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
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'activity' | 'documents' | 'notes'>('activity');

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
        } catch (error) {
            console.error("Error fetching patient details:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchPatientData();
    }, [id]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !id) return;
        try {
            // In electron, file.path contains the local file system path
            const filePath = (file as any).path || file.name;
            await window.ipcRenderer.invoke('upload-document', {
                patientId: Number(id),
                fileName: file.name,
                fileCategory: 'Médical',
                localPath: filePath
            });
            // Refresh documents
            const docs = await window.ipcRenderer.invoke('get-documents-by-patient-id', Number(id));
            setDocuments(docs || []);
        } catch (error) {
            console.error("Error uploading document:", error);
        }
    };

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
            // Create updated patient object
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
                <button onClick={handleGoBack} className="px-4 py-2 text-sm bg-navy/5 text-navy hover:bg-navy/10 rounded-xl transition-colors cursor-pointer">
                    {isRtl ? '→' : '←'} {t('patient_details.back')}
                </button>
                <div className="bg-white p-6 rounded-2xl text-center text-navy/40 font-medium shadow-[0_2px_12px_rgba(30,42,86,0.06)]">
                    Patient non trouvé
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
                    <span className="text-lg transition-transform group-hover:scale-110">
                        {isRtl ? '→' : '←'}
                    </span>
                    <span>{patientData.fullName}</span>
                </button>

                <button
                    className="p-2.5 rounded-xl border border-navy/10 text-navy/60 hover:text-navy hover:bg-navy/[0.04] transition-all cursor-pointer bg-white shadow-sm"
                    title="Modifier le patient"
                >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
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
                        <span>Age {calculateAge(patientData.dateOfBirth)}</span>
                        <span>•</span>
                        <span>Gr. Sanguin: {patientData.bloodType || '—'}</span>
                        <span>•</span>
                        <span>N° Sécu: {patientData.ssn || '—'}</span>
                    </div>

                    <div className="flex flex-wrap gap-4 pt-1.5 text-xs text-navy/40">
                        <span className="flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                            Ajouté le {formatDate(patientData.createdAt, i18n.language)}
                        </span>
                        <span className="flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                            Dernière visite il y a 3 jours
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

            {/* Suivi Médical (Mimics "Programs" section) */}
            <div className="space-y-3">
                <h3 className="text-md font-bold text-navy">Suivi & Consultations</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {/* Consultation Card 1 */}
                    <div className="relative overflow-hidden bg-white rounded-2xl p-5 border border-navy/[0.04] shadow-[0_2px_12px_rgba(30,42,86,0.04)] group">
                        <div className="flex items-center justify-between mb-3">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-pink/10 text-pink">
                                <span className="w-1 h-1 rounded-full bg-pink" />
                                Général
                            </span>
                            <span className="text-navy/20 cursor-pointer">•••</span>
                        </div>
                        <h4 className="text-sm font-bold text-navy mb-1">Consultation Générale</h4>
                        <p className="text-xs text-navy/45">Prochain rdv: Lundi, 16:00 - 17:00</p>
                    </div>

                    {/* Consultation Card 2 */}
                    <div className="relative overflow-hidden bg-white rounded-2xl p-5 border border-navy/[0.04] shadow-[0_2px_12px_rgba(30,42,86,0.04)] group">
                        <div className="flex items-center justify-between mb-3">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-navy/5 text-navy/50">
                                <span className="w-1 h-1 rounded-full bg-navy/30" />
                                Suspendu
                            </span>
                            <span className="text-navy/20 cursor-pointer">•••</span>
                        </div>
                        <h4 className="text-sm font-bold text-navy mb-1">Bilan Cardiologique</h4>
                        <p className="text-xs text-navy/45">Prochain rdv: Aucun</p>
                    </div>

                    {/* Placeholder Card 3 */}
                    <div className="border-2 border-dashed border-navy/10 rounded-2xl flex items-center justify-center p-5 text-navy/30 text-xs font-semibold hover:border-pink/30 hover:text-pink transition-colors cursor-pointer">
                        + Ajouter un protocole de suivi
                    </div>
                </div>
            </div>

            {/* Tab navigation */}
            <div className="border-b border-navy/[0.06] flex items-center gap-6 pt-2">
                {[
                    { key: 'activity', label: 'Activité' },
                    { key: 'documents', label: `Documents (${documents.length})` },
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
                        {/* Timeline Item 1 */}
                        <div className="relative">
                            <span className="absolute -left-[31px] top-0.5 bg-pink/10 text-pink w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border border-white">
                                ✓
                            </span>
                            <div>
                                <span className="block text-[10px] text-navy/30 font-semibold uppercase tracking-wider">09:00 AM, 08 Jun 2026</span>
                                <span className="text-sm font-medium text-navy">Consultation générale effectuée</span>
                            </div>
                        </div>

                        {/* Timeline Item 2 */}
                        <div className="relative">
                            <span className="absolute -left-[31px] top-0.5 bg-emerald-50 text-emerald-600 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border border-white">
                                💊
                            </span>
                            <div>
                                <span className="block text-[10px] text-navy/30 font-semibold uppercase tracking-wider">04:50 PM, 30 May 2026</span>
                                <span className="text-sm font-medium text-navy">Ordonnance générée: Paracétamol 500mg</span>
                            </div>
                        </div>

                        {/* Timeline Item 3 */}
                        <div className="relative">
                            <span className="absolute -left-[31px] top-0.5 bg-blue-50 text-blue-600 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border border-white">
                                📁
                            </span>
                            <div>
                                <span className="block text-[10px] text-navy/30 font-semibold uppercase tracking-wider">10:33 AM, 25 May 2026</span>
                                <span className="text-sm font-medium text-navy">Dossier médical scanné et ajouté aux documents</span>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'documents' && (
                    <div className="space-y-5">
                        {/* Header & Upload Button */}
                        <div className="flex items-center justify-between">
                            <h4 className="text-sm font-bold text-navy">Documents du patient</h4>
                            <label className="flex items-center gap-1.5 bg-navy/5 text-navy hover:bg-navy/10 text-xs font-semibold px-4.5 py-2 rounded-xl transition-all cursor-pointer">
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                                Téléverser
                                <input
                                    type="file"
                                    onChange={handleFileUpload}
                                    className="hidden"
                                />
                            </label>
                        </div>

                        {/* Document List */}
                        {documents.length === 0 ? (
                            <div className="text-center py-10 text-navy/35 text-xs font-medium">
                                Aucun document disponible.
                            </div>
                        ) : (
                            <div className="divide-y divide-navy/[0.04]">
                                {documents.map((doc) => (
                                    <div key={doc.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-navy/5 text-navy/40 flex items-center justify-center">
                                                📄
                                            </div>
                                            <div>
                                                <span className="text-sm font-semibold text-navy block truncate max-w-[200px] sm:max-w-md">{doc.fileName}</span>
                                                <span className="text-[10px] text-navy/40 font-medium">Ajouté le {formatDate(doc.uploadDate, i18n.language)}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={async () => {
                                                    console.log('[open-document] path:', doc.localPath);
                                                    const err = await window.ipcRenderer.invoke('open-document', doc.localPath);
                                                    if (err) console.error('[open-document] error:', err);
                                                }}
                                                className="p-1.5 text-navy/20 hover:text-navy rounded-lg hover:bg-navy/5 transition-colors cursor-pointer"
                                                title="Ouvrir le document"
                                            >
                                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                                            </button>
                                            <button
                                                onClick={() => handleDeleteDoc(doc.id)}
                                                className="p-1.5 text-navy/20 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                                                title="Supprimer le document"
                                            >
                                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'notes' && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h4 className="text-sm font-bold text-navy">Notes & Antécédents</h4>
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
                            placeholder="Saisissez vos observations médicales, antécédents, allergies ou traitements habituels..."
                            rows={6}
                            className="w-full p-4 text-sm bg-navy/[0.01] border border-navy/[0.08] rounded-2xl focus:outline-none focus:ring-2 focus:ring-pink/20 focus:border-pink/30 text-navy placeholder:text-navy/30 resize-none transition-all duration-200"
                        />
                    </div>
                )}
            </div>
        </div>
    );
}