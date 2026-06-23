import { useEffect, useState, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Patient } from '../../../types/patient';

type PatientDocumentDetail = {
    id: number;
    patientId: number;
    prescriptionId: number | null;
    fileName: string;
    fileCategory: string;
    localPath: string;
    uploadDate: string;
    patientName: string;
    patientPhone: string | null;
    fileSize: number;
};

const fileCategories = [
    { value: 'all', labelKey: 'documents.categories.all' },
    { value: 'prescription', labelKey: 'documents.categories.prescription' },
    { value: 'radiography', labelKey: 'documents.categories.radiography' },
    { value: 'analysis', labelKey: 'documents.categories.analysis' },
    { value: 'other', labelKey: 'documents.categories.other' }
];

/* ─── Inline SVG Icons ─── */
const icons = {
    search: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
    ),
    filter: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
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
    open: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
    ),
    fileDoc: (
        <svg className="w-10 h-10 text-pink" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
        </svg>
    ),
    uploadCloud: (
        <svg className="w-12 h-12 text-pink/40 group-hover:text-pink transition-colors duration-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
    ),
    pdfType: (
        <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <text x="7" y="17" fontSize="5" fontWeight="bold" fill="currentColor" stroke="none">PDF</text>
        </svg>
    ),
    imgType: (
        <svg className="w-5 h-5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
        </svg>
    ),
    wordType: (
        <svg className="w-5 h-5 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <text x="7" y="17" fontSize="5" fontWeight="bold" fill="currentColor" stroke="none">DOC</text>
        </svg>
    ),
    defaultFileType: (
        <svg className="w-5 h-5 text-navy/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
        </svg>
    )
};

function formatBytes(bytes: number, t: any, decimals = 2) {
    if (!bytes || bytes === 0) return '—';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = [
        t('documents.bytes.bytes'),
        t('documents.bytes.kb'),
        t('documents.bytes.mb'),
        t('documents.bytes.gb'),
        t('documents.bytes.tb')
    ];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatDate(dateStr: string, locale = 'fr') {
    if (!dateStr) return '—';
    try {
        return new Date(dateStr).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
        return dateStr;
    }
}

export default function Documents() {
    const { t, i18n } = useTranslation();
    const currentLang = i18n.language || 'fr';

    const [documents, setDocuments] = useState<PatientDocumentDetail[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    /* ── Search & Filter State ── */
    const [searchQuery, setSearchQuery] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [currentPage, setCurrentPage] = useState(0);
    const ROWS_PER_PAGE = 8;

    /* ── Upload Panel / Modal State ── */
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
    const [patientSearchQuery, setPatientSearchQuery] = useState('');
    const [patientSearchResults, setPatientSearchResults] = useState<Patient[]>([]);
    const [isSearchingPatient, setIsSearchingPatient] = useState(false);
    const [showPatientDropdown, setShowPatientDropdown] = useState(false);
    
    const [uploadCategory, setUploadCategory] = useState('radiography');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);

    /* ── UI Message State ── */
    const [successMessage, setSuccessMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    const fileInputRef = useRef<HTMLInputElement>(null);

    const location = useLocation();

    /* ── Load all documents ── */
    const loadDocuments = async () => {
        try {
            setIsLoading(true);
            const data = await (window as any).ipcRenderer.getAllDocuments();
            setDocuments(data || []);
        } catch (e) {
            console.error('Error loading documents:', e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadDocuments();
    }, []);

    /* ── Auto-select patient from router navigation state ── */
    useEffect(() => {
        if (location.state?.patient) {
            setSelectedPatient(location.state.patient);
            setShowUploadModal(true);
        }
    }, [location.state]);

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

    /* ── File selection handlers ── */
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setSelectedFile(e.target.files[0]);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            setSelectedFile(e.dataTransfer.files[0]);
        }
    };

    const triggerFileSelect = () => {
        fileInputRef.current?.click();
    };

    /* ── Submit file upload ── */
    const handleUploadSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedPatient) {
            showError(t('documents.alerts.patient_required'));
            return;
        }
        if (!selectedFile) {
            showError(t('documents.alerts.file_required'));
            return;
        }

        setIsUploading(true);
        try {
            // In Electron, HTML5 File object has .path property
            const localPath = (selectedFile as any).path;
            const fileName = selectedFile.name;

            const result = await (window as any).ipcRenderer.uploadDocument({
                patientId: selectedPatient.id,
                prescriptionId: null,
                fileCategory: uploadCategory,
                localPath,
                fileName
            });

            if (result) {
                showSuccess(t('documents.alerts.upload_success'));
                setShowUploadModal(false);
                setSelectedPatient(null);
                setPatientSearchQuery('');
                setSelectedFile(null);
                setUploadCategory('radiography');
                await loadDocuments();
            } else {
                showError(t('documents.alerts.upload_error'));
            }
        } catch (err) {
            console.error('Upload error:', err);
            showError(t('documents.alerts.save_error'));
        } finally {
            setIsUploading(false);
        }
    };

    /* ── Delete document ── */
    const handleDeleteDocument = async (id: number) => {
        if (!window.confirm(t('documents.alerts.delete_confirm'))) return;
        try {
            await (window as any).ipcRenderer.deleteDocument(id);
            showSuccess(t('documents.alerts.delete_success'));
            setDocuments(prev => prev.filter(d => d.id !== id));
        } catch (e) {
            console.error('Delete document error:', e);
            showError(t('documents.alerts.delete_error'));
        }
    };

    /* ── Open document ── */
    const handleOpenDocument = async (filePath: string) => {
        try {
            const error = await (window as any).ipcRenderer.openDocument(filePath);
            if (error) {
                showError(t('documents.alerts.open_error', { error }));
            }
        } catch (e) {
            console.error('Open document error:', e);
            showError(t('documents.alerts.open_fail'));
        }
    };

    /* ── Helper styles ── */
    const showSuccess = (msg: string) => {
        setSuccessMessage(msg);
        setTimeout(() => setSuccessMessage(''), 3000);
    };

    const showError = (msg: string) => {
        setErrorMessage(msg);
        setTimeout(() => setErrorMessage(''), 4000);
    };

    const getFileIcon = (fileName: string, category: string) => {
        const ext = fileName.split('.').pop()?.toLowerCase();
        if (ext === 'pdf' || category === 'prescription') return icons.pdfType;
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext || '')) return icons.imgType;
        if (['doc', 'docx', 'txt', 'rtf'].includes(ext || '')) return icons.wordType;
        return icons.defaultFileType;
    };

    const getCategoryBadgeColor = (category: string) => {
        switch (category) {
            case 'prescription':
                return 'bg-red-50 text-red-600 border border-red-100';
            case 'radiography':
                return 'bg-blue-50 text-blue-600 border border-blue-100';
            case 'analysis':
                return 'bg-emerald-50 text-emerald-600 border border-emerald-100';
            default:
                return 'bg-slate-50 text-slate-600 border border-slate-100';
        }
    };

    const getCategoryLabel = (category: string) => {
        switch (category) {
            case 'prescription': return t('documents.badge.prescription');
            case 'radiography': return t('documents.badge.radiography');
            case 'analysis': return t('documents.badge.analysis');
            default: return t('documents.badge.other');
        }
    };

    /* ── Filtering & Searching ── */
    const filteredDocuments = useMemo(() => {
        return documents.filter(doc => {
            const matchesCategory = categoryFilter === 'all' || doc.fileCategory === categoryFilter;
            const matchesSearch =
                doc.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                doc.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (doc.patientPhone && doc.patientPhone.includes(searchQuery));
            return matchesCategory && matchesSearch;
        });
    }, [documents, categoryFilter, searchQuery]);

    const paginatedDocs = useMemo(() => {
        const start = currentPage * ROWS_PER_PAGE;
        return filteredDocuments.slice(start, start + ROWS_PER_PAGE);
    }, [filteredDocuments, currentPage]);

    return (
        <div className="space-y-6">
            {/* ── Page Header ── */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-navy">{t('documents.title')}</h1>
                    <p className="text-sm text-navy/50 mt-0.5">
                        {t('documents.subtitle')}
                    </p>
                </div>
                <button
                    onClick={() => setShowUploadModal(true)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-pink to-pink-light text-white text-sm font-semibold hover:shadow-[0_4px_16px_rgba(233,30,140,0.25)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 cursor-pointer select-none"
                >
                    {icons.plus}
                    {t('documents.add_button')}
                </button>
            </div>

            {/* ── Toast Messages ── */}
            {successMessage && (
                <div className="fixed bottom-5 right-5 bg-emerald-500 text-white px-5 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-fade-in z-50">
                    <span className="text-lg">✓</span>
                    <span className="text-sm font-medium">{successMessage}</span>
                </div>
            )}
            {errorMessage && (
                <div className="fixed bottom-5 right-5 bg-red-500 text-white px-5 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-fade-in z-50">
                    <span className="text-lg">⚠</span>
                    <span className="text-sm font-medium">{errorMessage}</span>
                </div>
            )}

            {/* ═══════ Drag & Drop upload section ═══════ */}
            <div
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => setShowUploadModal(true)}
                className="group relative bg-white border-2 border-dashed border-navy/15 hover:border-pink rounded-3xl p-8 text-center cursor-pointer transition-all duration-300 shadow-[0_2px_12px_rgba(30,42,86,0.03)] hover:shadow-[0_8px_24px_rgba(233,30,140,0.06)] overflow-hidden"
            >
                {/* Visual glow background */}
                <div className="absolute inset-0 bg-gradient-to-r from-pink/0 via-pink/[0.015] to-pink/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative flex flex-col items-center justify-center space-y-3">
                    <div className="p-4 bg-pink/5 rounded-full group-hover:scale-110 transition-transform duration-300">
                        {icons.uploadCloud}
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-navy">
                            {t('documents.dropzone.prompt')} <span className="text-pink hover:underline">{t('documents.dropzone.click_browse')}</span>
                        </p>
                        <p className="text-xs text-navy/40 mt-1">
                            {t('documents.dropzone.supported')}
                        </p>
                    </div>
                </div>
            </div>

            {/* ═══════ Main Files Table Area ═══════ */}
            <div className="bg-white rounded-3xl shadow-[0_2px_12px_rgba(30,42,86,0.06)] border border-navy/[0.04] overflow-hidden">
                {/* Table Toolbar */}
                <div className="px-6 py-4 border-b border-navy/[0.06] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h3 className="text-sm font-bold text-navy">{t('documents.table.title')}</h3>
                        <p className="text-xs text-navy/40 mt-0.5">
                            {filteredDocuments.length === 1 
                                ? t('documents.table.total_count', { count: filteredDocuments.length }) 
                                : t('documents.table.total_count_plural', { count: filteredDocuments.length })}
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-3">
                        {/* Search Bar */}
                        <div className="relative w-full sm:w-64">
                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy/30">
                                {icons.search}
                            </span>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={e => {
                                    setSearchQuery(e.target.value);
                                    setCurrentPage(0);
                                }}
                                placeholder={t('documents.table.search_placeholder')}
                                className="w-full pl-10 pr-4 py-2 text-xs bg-navy/[0.02] border border-navy/[0.08] rounded-xl text-navy placeholder:text-navy/25 focus:outline-none focus:ring-2 focus:ring-pink/20 focus:border-pink/30 transition-all duration-200"
                            />
                        </div>

                        {/* Category Filter */}
                        <div className="relative w-full sm:w-48">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-navy/40">
                                {icons.filter}
                            </span>
                            <select
                                value={categoryFilter}
                                onChange={e => {
                                    setCategoryFilter(e.target.value);
                                    setCurrentPage(0);
                                }}
                                className="w-full pl-9 pr-8 py-2 text-xs bg-navy/[0.02] border border-navy/[0.08] rounded-xl text-navy focus:outline-none focus:ring-2 focus:ring-pink/20 focus:border-pink/30 transition-all duration-200 cursor-pointer appearance-none"
                            >
                                {fileCategories.map(cat => (
                                    <option key={cat.value} value={cat.value} className="text-navy">
                                        {t(cat.labelKey)}
                                    </option>
                                ))}
                            </select>
                            {/* Native select styling arrows */}
                            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-navy/40 text-[8px]">▼</span>
                        </div>
                    </div>
                </div>

                {/* Table Content */}
                {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-pink" />
                    </div>
                ) : filteredDocuments.length === 0 ? (
                    <div className="text-center py-20">
                        <div className="text-navy/15 text-5xl mb-4">📂</div>
                        <p className="text-base font-semibold text-navy mb-1">{t('documents.table.empty')}</p>
                        <p className="text-xs text-navy/40 max-w-sm mx-auto">
                            {t('documents.table.empty_hint')}
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-left">
                                <thead>
                                    <tr className="bg-navy/[0.02] border-b border-navy/[0.04]">
                                        <th className="w-12 px-6 py-4 text-center">
                                            <input type="checkbox" className="rounded border-navy/20 text-pink focus:ring-pink/30 cursor-pointer" readOnly checked={false} />
                                        </th>
                                        <th className="px-6 py-4 text-xs font-bold text-navy/45 uppercase tracking-wider">{t('documents.table.header.filename')}</th>
                                        <th className="px-6 py-4 text-xs font-bold text-navy/45 uppercase tracking-wider">{t('documents.table.header.size')}</th>
                                        <th className="px-6 py-4 text-xs font-bold text-navy/45 uppercase tracking-wider">{t('documents.table.header.modified')}</th>
                                        <th className="px-6 py-4 text-xs font-bold text-navy/45 uppercase tracking-wider">{t('documents.table.header.patient')}</th>
                                        <th className="px-6 py-4 text-xs font-bold text-navy/45 uppercase tracking-wider text-right">{t('documents.table.header.actions')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-navy/[0.04]">
                                    {paginatedDocs.map(doc => (
                                        <tr
                                            key={doc.id}
                                            onDoubleClick={() => handleOpenDocument(doc.localPath)}
                                            className="hover:bg-navy/[0.015] transition-colors group cursor-pointer"
                                        >
                                            <td className="px-6 py-4.5 text-center" onClick={e => e.stopPropagation()}>
                                                <input type="checkbox" className="rounded border-navy/20 text-pink focus:ring-pink/30 cursor-pointer" readOnly checked={false} />
                                            </td>
                                            <td className="px-6 py-4.5">
                                                <div className="flex items-center gap-3.5">
                                                    <div className="p-2 bg-navy/[0.03] rounded-xl flex-shrink-0 group-hover:scale-105 transition-transform duration-200">
                                                        {getFileIcon(doc.fileName, doc.fileCategory)}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-semibold text-navy truncate max-w-xs group-hover:text-pink transition-colors duration-200" title={doc.fileName}>
                                                            {doc.fileName.split('_').slice(1).join('_') || doc.fileName}
                                                        </p>
                                                        <div className="flex items-center gap-2 mt-1">
                                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${getCategoryBadgeColor(doc.fileCategory)}`}>
                                                                {getCategoryLabel(doc.fileCategory)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4.5">
                                                <span className="text-sm font-medium text-navy/70">
                                                    {formatBytes(doc.fileSize, t)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4.5">
                                                <span className="text-sm font-medium text-navy/70">
                                                    {formatDate(doc.uploadDate, currentLang)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4.5">
                                                <div>
                                                    <p className="text-sm font-semibold text-navy">{doc.patientName}</p>
                                                    {doc.patientPhone && (
                                                        <p className="text-xs text-navy/40 mt-0.5">{doc.patientPhone}</p>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4.5 text-right" onClick={e => e.stopPropagation()}>
                                                <div className="flex items-center justify-end gap-1">
                                                    <button
                                                        onClick={() => handleOpenDocument(doc.localPath)}
                                                        className="p-2 rounded-xl text-navy/40 hover:text-pink hover:bg-pink/5 transition-all cursor-pointer"
                                                        title={t('patient_details.documents.open')}
                                                    >
                                                        {icons.open}
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteDocument(doc.id)}
                                                        className="p-2 rounded-xl text-navy/40 hover:text-red-500 hover:bg-red-50 transition-all cursor-pointer"
                                                        title={t('patient_details.documents.delete')}
                                                    >
                                                        {icons.trash}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination Footer */}
                        {filteredDocuments.length > ROWS_PER_PAGE && (
                            <div className="px-6 py-4 border-t border-navy/[0.06] flex items-center justify-between">
                                <span className="text-xs text-navy/35 font-medium">
                                    {t('documents.table.pagination', {
                                        start: currentPage * ROWS_PER_PAGE + 1,
                                        end: Math.min((currentPage + 1) * ROWS_PER_PAGE, filteredDocuments.length),
                                        total: filteredDocuments.length
                                    })}
                                </span>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setCurrentPage(p => p - 1)}
                                        disabled={currentPage === 0}
                                        className="px-3.5 py-2 rounded-xl text-xs font-semibold text-navy/60 bg-navy/[0.03] hover:bg-navy/[0.06] hover:text-navy transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed select-none"
                                    >
                                        {t('documents.table.prev')}
                                    </button>
                                    <button
                                        onClick={() => setCurrentPage(p => p + 1)}
                                        disabled={(currentPage + 1) * ROWS_PER_PAGE >= filteredDocuments.length}
                                        className="px-3.5 py-2 rounded-xl text-xs font-semibold text-navy/60 bg-navy/[0.03] hover:bg-navy/[0.06] hover:text-navy transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed select-none"
                                    >
                                        {t('documents.table.next')}
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ═══════ Upload Document Modal ═══════ */}
            {showUploadModal && (
                <div className="fixed inset-0 z-50 bg-navy/40 backdrop-blur-sm flex items-center justify-center p-4">
                    <form
                        onSubmit={handleUploadSubmit}
                        className="bg-white rounded-[32px] shadow-2xl w-full max-w-lg overflow-hidden border border-white/20 animate-scale-in flex flex-col max-h-[90vh]"
                    >
                        {/* Modal Header */}
                        <div className="bg-white px-6 pt-6 pb-2 flex items-start justify-between">
                            <div>
                                <h3 className="font-bold text-navy text-xl md:text-2xl">{t('documents.modal.title')}</h3>
                                <p className="text-xs md:text-sm text-gray-400 mt-1">{t('documents.modal.subtitle')}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowUploadModal(false);
                                    setSelectedPatient(null);
                                    setPatientSearchQuery('');
                                    setSelectedFile(null);
                                }}
                                className="text-gray-400 hover:text-gray-600 cursor-pointer p-1"
                            >
                                {icons.close}
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6 overflow-y-auto space-y-4 flex-1">
                            {/* Patient Selection Search */}
                            <div className="space-y-1.5 relative">
                                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">{t('documents.modal.patient_label')}</label>
                                {selectedPatient ? (
                                    <div className="p-4 bg-pink/5 border border-pink/25 rounded-2xl flex items-center justify-between">
                                        <div>
                                            <span className="font-bold text-navy block">{selectedPatient.fullName}</span>
                                            <span className="text-xs text-gray-500 block">{t('patients.modal.dob')} : {selectedPatient.dateOfBirth}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedPatient(null);
                                                setPatientSearchQuery('');
                                            }}
                                            className="text-xs font-semibold text-pink hover:underline cursor-pointer"
                                        >
                                            {t('documents.modal.patient_change')}
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="relative">
                                            <input
                                                type="text"
                                                value={patientSearchQuery}
                                                onChange={e => setPatientSearchQuery(e.target.value)}
                                                placeholder={t('documents.modal.patient_placeholder')}
                                                className="w-full p-3.5 pl-10 bg-gray-50/50 hover:bg-gray-50 border border-gray-200/80 rounded-2xl font-medium text-navy focus:border-pink focus:ring-1 focus:ring-pink focus:bg-white outline-none transition-all"
                                            />
                                            <span className="absolute left-3 top-[17px] text-gray-400">
                                                {icons.search}
                                            </span>
                                            {isSearchingPatient && (
                                                <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                                                    <div className="w-4 h-4 border-2 border-pink/30 border-t-pink rounded-full animate-spin" />
                                                </div>
                                            )}
                                        </div>

                                        {/* Autocomplete Dropdown */}
                                        {showPatientDropdown && patientSearchResults.length > 0 && (
                                            <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200/80 rounded-2xl shadow-xl max-h-48 overflow-y-auto">
                                                {patientSearchResults.map(p => (
                                                    <button
                                                        key={p.id}
                                                        type="button"
                                                        onClick={() => {
                                                            setSelectedPatient(p);
                                                            setShowPatientDropdown(false);
                                                        }}
                                                        className="w-full text-left p-3.5 hover:bg-pink/5 border-b border-gray-100 last:border-0 flex flex-col cursor-pointer transition-all"
                                                    >
                                                        <span className="font-semibold text-sm text-navy">{p.fullName}</span>
                                                        <span className="text-xs text-gray-400 mt-0.5">{t('patients.modal.dob')} {p.dateOfBirth} | SSN: {p.ssn || '—'}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        {showPatientDropdown && patientSearchResults.length === 0 && patientSearchQuery && (
                                            <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200/80 rounded-2xl shadow-xl p-3.5 text-center text-sm text-gray-400">
                                                {t('documents.modal.patient_not_found')}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            {/* Category Selection */}
                            <div className="space-y-1.5">
                                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">{t('documents.modal.type_label')}</label>
                                <select
                                    value={uploadCategory}
                                    onChange={e => setUploadCategory(e.target.value)}
                                    className="w-full p-3.5 bg-gray-50/50 hover:bg-gray-50 border border-gray-200/80 rounded-2xl font-medium text-navy focus:border-pink focus:ring-1 focus:ring-pink focus:bg-white outline-none transition-all cursor-pointer"
                                >
                                    <option value="radiography">{t('documents.categories.radiography')}</option>
                                    <option value="analysis">{t('documents.categories.analysis')}</option>
                                    <option value="prescription">{t('documents.categories.prescription')}</option>
                                    <option value="other">{t('documents.categories.other')}</option>
                                </select>
                            </div>

                            {/* File Selector Dropzone */}
                            <div className="space-y-1.5">
                                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">{t('documents.modal.file_label')}</label>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileChange}
                                    className="hidden"
                                    accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                                />

                                <div
                                    onDragOver={handleDragOver}
                                    onDrop={handleDrop}
                                    onClick={triggerFileSelect}
                                    className="border-2 border-dashed border-gray-200 hover:border-pink rounded-2xl p-6 text-center cursor-pointer transition-colors bg-gray-50/20 hover:bg-pink/[0.01]"
                                >
                                    {selectedFile ? (
                                        <div className="flex flex-col items-center space-y-2">
                                            <div className="p-3 bg-pink/5 rounded-full">
                                                {icons.fileDoc}
                                            </div>
                                            <div className="max-w-xs truncate text-sm font-semibold text-navy">
                                                {selectedFile.name}
                                            </div>
                                            <div className="text-xs text-navy/45">
                                                {formatBytes(selectedFile.size, t)}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center space-y-1.5">
                                            <span className="text-3xl">📄</span>
                                            <p className="text-xs font-semibold text-navy">
                                                {t('documents.dropzone.prompt_modal')}
                                            </p>
                                            <p className="text-[10px] text-navy/35">
                                                {t('documents.dropzone.supported_modal')}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="bg-white px-6 py-5 flex items-center justify-end gap-4 border-t border-gray-100">
                            <button
                                type="button"
                                onClick={() => {
                                    setShowUploadModal(false);
                                    setSelectedPatient(null);
                                    setPatientSearchQuery('');
                                    setSelectedFile(null);
                                }}
                                className="px-5 py-3 text-gray-500 hover:text-navy font-semibold transition-all cursor-pointer select-none"
                            >
                                {t('documents.modal.cancel')}
                            </button>
                            <button
                                type="submit"
                                disabled={isUploading || !selectedPatient || !selectedFile}
                                className="px-8 py-3 bg-pink hover:bg-pink-dark text-white font-bold rounded-2xl shadow-lg shadow-pink/25 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 select-none"
                            >
                                {isUploading ? (
                                    <>
                                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        {t('documents.modal.saving')}
                                    </>
                                ) : (
                                    t('documents.modal.save')
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}
