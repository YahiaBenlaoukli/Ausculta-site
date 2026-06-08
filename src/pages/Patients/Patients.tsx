import { useEffect, useState, useMemo } from "react"
import { Patient, BloodType } from "../../../types/patient"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"

/* ─── Inline SVG icons ─── */
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
    sort: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />
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
    chevronLeft: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
        </svg>
    ),
    chevronRight: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 6 15 12 9 18" />
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
    moreH: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
        </svg>
    ),
}

/* ─── Helpers ─── */
function getInitials(name: string) {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function getAvatarColor(name: string) {
    const colors = [
        'from-pink to-pink-light',
        'from-navy to-navy-light',
        'from-pink-dark to-pink',
        'from-navy-light to-navy',
        'from-pink-light to-pink',
    ]
    let hash = 0
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
    return colors[Math.abs(hash) % colors.length]
}

function formatDate(dateStr: string, locale: string = 'fr') {
    if (!dateStr) return '—'
    try {
        return new Date(dateStr).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
    } catch { return dateStr }
}

function getRelativeTime(dateStr: string, t: any) {
    if (!dateStr) return ''
    try {
        const now = new Date()
        const date = new Date(dateStr)
        const diffMs = now.getTime() - date.getTime()
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
        if (diffDays === 0) return t('time.today')
        if (diffDays === 1) return t('time.yesterday')
        if (diffDays < 7) return t('time.days', { count: diffDays })
        if (diffDays < 30) return t('time.weeks', { count: Math.floor(diffDays / 7) })
        if (diffDays < 365) return t('time.months', { count: Math.floor(diffDays / 30) })
        return t('time.years', { count: Math.floor(diffDays / 365) })
    } catch { return '' }
}

/* Blood type badge color */
function bloodTypeStyle(bt: BloodType | null) {
    if (!bt) return 'bg-navy/5 text-navy/40'
    const styles: Record<string, string> = {
        'A+': 'bg-red-50 text-red-600 ring-red-200',
        'A-': 'bg-red-50 text-red-500 ring-red-100',
        'B+': 'bg-blue-50 text-blue-600 ring-blue-200',
        'B-': 'bg-blue-50 text-blue-500 ring-blue-100',
        'AB+': 'bg-purple-50 text-purple-600 ring-purple-200',
        'AB-': 'bg-purple-50 text-purple-500 ring-purple-100',
        'O+': 'bg-emerald-50 text-emerald-600 ring-emerald-200',
        'O-': 'bg-emerald-50 text-emerald-500 ring-emerald-100',
    }
    return styles[bt] ?? 'bg-navy/5 text-navy/50'
}

type SortField = 'fullName' | 'dateOfBirth' | 'createdAt' | 'bloodType' | 'phoneNumber'
type SortDir = 'asc' | 'desc'

const ROWS_PER_PAGE = 10

/* ═══════════════════════════════════════════════ */
/*                PATIENTS PAGE                    */
/* ═══════════════════════════════════════════════ */
export default function Patients() {
    const { t, i18n } = useTranslation()
    const isRtl = i18n.dir() === 'rtl'

    const [patients, setPatients] = useState<Patient[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [sortField, setSortField] = useState<SortField>('fullName')
    const [sortDir, setSortDir] = useState<SortDir>('asc')
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
    const [currentPage, setCurrentPage] = useState(1)
    const [showAddModal, setShowAddModal] = useState(false)
    const [filterBloodType, setFilterBloodType] = useState<string>('')
    const [showFilterMenu, setShowFilterMenu] = useState(false)

    const navigate = useNavigate()

    /* ── CRUD ops ── */
    const getAllPatients = async () => {
        try {
            setLoading(true)
            const data = await window.ipcRenderer.invoke('get-all-patients')
            setPatients(data)
        } catch (error) {
            console.log(error)
        } finally {
            setLoading(false)
        }
    }

    const addPatient = async (newPatient: Omit<Patient, 'id' | 'createdAt'>) => {
        try {
            await window.ipcRenderer.invoke('add-patient', newPatient)
            await getAllPatients()
            setShowAddModal(false)
        } catch (error) {
            console.log(error)
        }
    }

    const deletePatient = async (id: number) => {
        try {
            await window.ipcRenderer.invoke('delete-patient', id)
            await getAllPatients()
            setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n })
        } catch (error) {
            console.log(error)
        }
    }

    useEffect(() => { getAllPatients() }, [])

    /* ── Derived data ── */
    const filtered = useMemo(() => {
        let list = [...patients]
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase()
            list = list.filter(p =>
                p.fullName.toLowerCase().includes(q) ||
                p.phoneNumber?.toLowerCase().includes(q) ||
                p.ssn?.toLowerCase().includes(q) ||
                p.address?.toLowerCase().includes(q)
            )
        }
        if (filterBloodType) {
            list = list.filter(p => p.bloodType === filterBloodType)
        }
        list.sort((a, b) => {
            let cmp = 0
            const fieldA = a[sortField] ?? ''
            const fieldB = b[sortField] ?? ''
            if (typeof fieldA === 'string' && typeof fieldB === 'string') {
                cmp = fieldA.localeCompare(fieldB, i18n.language)
            }
            return sortDir === 'asc' ? cmp : -cmp
        })
        return list
    }, [patients, searchQuery, filterBloodType, sortField, sortDir, i18n.language])

    const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE))
    const paginated = filtered.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE)

    const allOnPageSelected = paginated.length > 0 && paginated.every(p => selectedIds.has(p.id))

    const toggleSelect = (id: number) => {
        setSelectedIds(prev => {
            const n = new Set(prev)
            n.has(id) ? n.delete(id) : n.add(id)
            return n
        })
    }

    const toggleSelectAll = () => {
        if (allOnPageSelected) {
            setSelectedIds(prev => {
                const n = new Set(prev)
                paginated.forEach(p => n.delete(p.id))
                return n
            })
        } else {
            setSelectedIds(prev => {
                const n = new Set(prev)
                paginated.forEach(p => n.add(p.id))
                return n
            })
        }
    }

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc')
        } else {
            setSortField(field)
            setSortDir('asc')
        }
    }

    const SortIndicator = ({ field }: { field: SortField }) => (
        <span className={`${isRtl ? 'mr-1' : 'ml-1'} inline-flex transition-opacity ${sortField === field ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}>
            {sortField === field && sortDir === 'desc' ? '↓' : '↑'}
        </span>
    )

    const handleRowClick = (id: number) => {
        navigate(`/patients/${id}`)
    }

    /* ═══════════════════════════════ RENDER ═══════════════════════════════ */
    return (
        <div className="space-y-5">
            {/* ── Page Header ── */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-navy">{t('patients.title')}</h1>
                    <p className="text-sm text-navy/50 mt-0.5">
                        {t('patients.subtitle')}
                    </p>
                </div>
                <button
                    id="btn-add-patient"
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-2 bg-gradient-to-r from-pink to-pink-light text-white text-sm font-semibold px-5 py-2.5 rounded-xl shadow-[0_4px_14px_rgba(233,30,140,0.25)] hover:shadow-[0_6px_20px_rgba(233,30,140,0.35)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 cursor-pointer"
                >
                    {icons.plus}
                    <span>{t('patients.add')}</span>
                </button>
            </div>

            {/* ── Toolbar ── */}
            <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(30,42,86,0.06)] overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-3 border-b border-navy/[0.06]">
                    {/* View pill */}
                    <div className="flex items-center gap-1.5 bg-navy/[0.04] rounded-lg px-3 py-1.5 text-xs font-semibold text-navy">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
                        {t('patients.toolbar.view_table')}
                    </div>

                    {/* Filter button */}
                    <div className="relative">
                        <button
                            id="btn-filter"
                            onClick={() => setShowFilterMenu(v => !v)}
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150 cursor-pointer ${filterBloodType ? 'bg-pink/10 text-pink' : 'text-navy/60 hover:bg-navy/[0.04]'}`}
                        >
                            {icons.filter}
                            {t('patients.toolbar.filter')}
                            {filterBloodType && (
                                <span className={`bg-pink text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center ${isRtl ? 'mr-1' : 'ml-1'}`}>1</span>
                            )}
                        </button>
                        {showFilterMenu && (
                            <div className={`absolute top-full ${isRtl ? 'right-0' : 'left-0'} mt-1 w-44 bg-white rounded-xl shadow-[0_8px_30px_rgba(30,42,86,0.12)] border border-navy/[0.06] py-1.5 z-30 animate-[fadeIn_0.15s_ease-out]`}>
                                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-navy/30">{t('patients.toolbar.filter_blood_type')}</div>
                                <button
                                    onClick={() => { setFilterBloodType(''); setShowFilterMenu(false) }}
                                    className={`w-full ${isRtl ? 'text-right' : 'text-left'} px-3 py-1.5 text-xs cursor-pointer hover:bg-navy/[0.03] transition-colors ${!filterBloodType ? 'text-pink font-semibold' : 'text-navy/70'}`}
                                >
                                    {t('patients.toolbar.filter_all')}
                                </button>
                                {Object.values(BloodType).map(bt => (
                                    <button
                                        key={bt}
                                        onClick={() => { setFilterBloodType(bt); setShowFilterMenu(false); setCurrentPage(1) }}
                                        className={`w-full ${isRtl ? 'text-right' : 'text-left'} px-3 py-1.5 text-xs cursor-pointer hover:bg-navy/[0.03] transition-colors ${filterBloodType === bt ? 'text-pink font-semibold' : 'text-navy/70'}`}
                                    >
                                        {bt}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Sort indicator */}
                    <div className="flex items-center gap-1.5 text-xs text-navy/50 font-medium">
                        {icons.sort}
                        {t('patients.toolbar.sort')}
                    </div>

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Search */}
                    <div className="relative">
                        <span className={`absolute ${isRtl ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-navy/30`}>{icons.search}</span>
                        <input
                            id="input-search-patients"
                            type="text"
                            value={searchQuery}
                            onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1) }}
                            placeholder={t('patients.toolbar.search_placeholder')}
                            className={`${isRtl ? 'pr-9 pl-4' : 'pl-9 pr-4'} py-2 w-56 text-sm bg-navy/[0.03] border border-navy/[0.06] rounded-xl text-navy placeholder:text-navy/30 focus:outline-none focus:ring-2 focus:ring-pink/20 focus:border-pink/30 transition-all duration-200`}
                        />
                    </div>

                    {/* Count */}
                    <div className="flex items-center gap-2 text-xs text-navy/40 font-medium">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-navy to-navy-light flex items-center justify-center">
                            <span className="text-[10px] font-bold text-white">{filtered.length}</span>
                        </div>
                        <span>{filtered.length} / {patients.length}</span>
                    </div>
                </div>

                {/* ── Table ── */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-navy/[0.06]">
                                <th className="w-12 px-4 py-3">
                                    <input
                                        type="checkbox"
                                        checked={allOnPageSelected}
                                        onChange={toggleSelectAll}
                                        className="w-4 h-4 rounded border-navy/20 text-pink accent-pink cursor-pointer"
                                    />
                                </th>
                                <th className={`px-4 py-3 ${isRtl ? 'text-right' : 'text-left'}`}>
                                    <button onClick={() => handleSort('fullName')} className="group flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-navy/40 hover:text-navy/70 transition-colors cursor-pointer">
                                        {t('patients.table.full_name')} <SortIndicator field="fullName" />
                                    </button>
                                </th>
                                <th className={`px-4 py-3 ${isRtl ? 'text-right' : 'text-left'}`}>
                                    <button onClick={() => handleSort('phoneNumber')} className="group flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-navy/40 hover:text-navy/70 transition-colors cursor-pointer">
                                        {t('patients.table.phone')} <SortIndicator field="phoneNumber" />
                                    </button>
                                </th>
                                <th className={`px-4 py-3 ${isRtl ? 'text-right' : 'text-left'}`}>
                                    <span className="text-[11px] font-semibold uppercase tracking-wider text-navy/40">{t('patients.table.ssn')}</span>
                                </th>
                                <th className={`px-4 py-3 ${isRtl ? 'text-right' : 'text-left'}`}>
                                    <button onClick={() => handleSort('dateOfBirth')} className="group flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-navy/40 hover:text-navy/70 transition-colors cursor-pointer">
                                        {t('patients.table.dob')} <SortIndicator field="dateOfBirth" />
                                    </button>
                                </th>
                                <th className={`px-4 py-3 ${isRtl ? 'text-right' : 'text-left'}`}>
                                    <span className="text-[11px] font-semibold uppercase tracking-wider text-navy/40">{t('patients.table.address')}</span>
                                </th>
                                <th className={`px-4 py-3 ${isRtl ? 'text-right' : 'text-left'}`}>
                                    <button onClick={() => handleSort('bloodType')} className="group flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-navy/40 hover:text-navy/70 transition-colors cursor-pointer">
                                        {t('patients.table.blood_type')} <SortIndicator field="bloodType" />
                                    </button>
                                </th>
                                <th className={`px-4 py-3 ${isRtl ? 'text-right' : 'text-left'}`}>
                                    <button onClick={() => handleSort('createdAt')} className="group flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-navy/40 hover:text-navy/70 transition-colors cursor-pointer">
                                        {t('patients.table.added')} <SortIndicator field="createdAt" />
                                    </button>
                                </th>
                                <th className="w-20 px-4 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                /* Skeleton rows */
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={`skel-${i}`} className="border-b border-navy/[0.03]">
                                        {Array.from({ length: 9 }).map((_, j) => (
                                            <td key={j} className="px-4 py-3.5">
                                                <div className="h-4 bg-navy/[0.04] rounded-md animate-pulse" style={{ width: j === 0 ? '16px' : `${50 + Math.random() * 50}%` }} />
                                            </td>
                                        ))}
                                    </tr>
                                ))
                            ) : paginated.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="text-center py-16">
                                        <div className="text-navy/20 text-4xl mb-3">🔍</div>
                                        <div className="text-sm text-navy/40 font-medium">{t('patients.table.empty')}</div>
                                        <div className="text-xs text-navy/25 mt-1">{t('patients.table.empty_hint')}</div>
                                    </td>
                                </tr>
                            ) : (
                                paginated.map((patient, idx) => {
                                    const isSelected = selectedIds.has(patient.id)
                                    return (
                                        <tr onClick={() => handleRowClick(patient.id)}
                                            key={patient.id}
                                            className={`
                        group border-b border-navy/[0.03] transition-colors duration-150 cursor-pointer
                        ${isSelected ? 'bg-pink/[0.03]' : 'hover:bg-navy/[0.015]'}
                      `}
                                            style={{ animationDelay: `${idx * 30}ms` }}
                                        >
                                            {/* Checkbox */}
                                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleSelect(patient.id)}
                                                    className="w-4 h-4 rounded border-navy/20 text-pink accent-pink cursor-pointer"
                                                />
                                            </td>

                                            {/* Name + avatar */}
                                            <td className={`px-4 py-3 ${isRtl ? 'text-right' : 'text-left'}`}>
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${getAvatarColor(patient.fullName)} flex items-center justify-center flex-shrink-0 shadow-sm`}>
                                                        <span className="text-[11px] font-bold text-white">{getInitials(patient.fullName)}</span>
                                                    </div>
                                                    <span className="text-sm font-medium text-navy truncate max-w-[180px]">{patient.fullName}</span>
                                                </div>
                                            </td>

                                            {/* Phone */}
                                            <td className={`px-4 py-3 ${isRtl ? 'text-right' : 'text-left'}`}>
                                                <span className="text-sm text-navy/70">{patient.phoneNumber || '—'}</span>
                                            </td>

                                            {/* SSN */}
                                            <td className={`px-4 py-3 ${isRtl ? 'text-right' : 'text-left'}`}>
                                                <span className="text-xs font-mono text-navy/50 bg-navy/[0.03] px-2 py-1 rounded-md">{patient.ssn || '—'}</span>
                                            </td>

                                            {/* Date of birth */}
                                            <td className={`px-4 py-3 ${isRtl ? 'text-right' : 'text-left'}`}>
                                                <span className="text-sm text-navy/70">{formatDate(patient.dateOfBirth, i18n.language)}</span>
                                            </td>

                                            {/* Address */}
                                            <td className={`px-4 py-3 ${isRtl ? 'text-right' : 'text-left'}`}>
                                                <span className="text-sm text-navy/60 truncate max-w-[160px] block">{patient.address || '—'}</span>
                                            </td>

                                            {/* Blood type badge */}
                                            <td className={`px-4 py-3 ${isRtl ? 'text-right' : 'text-left'}`}>
                                                <span className={`inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-full ring-1 ring-inset ${bloodTypeStyle(patient.bloodType)}`}>
                                                    {patient.bloodType || '—'}
                                                </span>
                                            </td>

                                            {/* Created at */}
                                            <td className={`px-4 py-3 ${isRtl ? 'text-right' : 'text-left'}`}>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                                                    <span className="text-xs text-navy/50">{getRelativeTime(patient.createdAt, t)}</span>
                                                </div>
                                            </td>

                                            {/* Actions */}
                                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                                                    <button
                                                        onClick={() => {}}
                                                        className="p-1.5 rounded-lg text-navy/30 hover:text-navy hover:bg-navy/[0.05] transition-colors cursor-pointer"
                                                        title={t('patients.table.actions.edit')}
                                                    >
                                                        {icons.edit}
                                                    </button>
                                                    <button
                                                        onClick={() => deletePatient(patient.id)}
                                                        className="p-1.5 rounded-lg text-navy/30 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                                                        title={t('patients.table.actions.delete')}
                                                    >
                                                        {icons.trash}
                                                    </button>
                                                    <button
                                                        onClick={() => {}}
                                                        className="p-1.5 rounded-lg text-navy/30 hover:text-navy hover:bg-navy/[0.05] transition-colors cursor-pointer"
                                                        title={t('patients.table.actions.more')}
                                                    >
                                                        {icons.moreH}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* ── Pagination ── */}
                {!loading && filtered.length > ROWS_PER_PAGE && (
                    <div className="flex items-center justify-between px-5 py-3 border-t border-navy/[0.06]">
                        <div className="text-xs text-navy/40">
                            {t('patients.pagination.info', { current: currentPage, total: totalPages })}
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                disabled={currentPage <= 1}
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                className="p-1.5 rounded-lg text-navy/40 hover:text-navy hover:bg-navy/[0.04] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                            >
                                {isRtl ? icons.chevronRight : icons.chevronLeft}
                            </button>
                            {Array.from({ length: totalPages }, (_, i) => i + 1)
                                .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                                .map((page, idx, arr) => (
                                    <span key={page} className="flex items-center">
                                        {idx > 0 && arr[idx - 1] !== page - 1 && (
                                            <span className="text-navy/20 text-xs px-1">…</span>
                                        )}
                                        <button
                                            onClick={() => setCurrentPage(page)}
                                            className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer ${page === currentPage ? 'bg-gradient-to-r from-pink to-pink-light text-white shadow-[0_2px_8px_rgba(233,30,140,0.2)]' : 'text-navy/50 hover:bg-navy/[0.04]'}`}
                                        >
                                            {page}
                                        </button>
                                    </span>
                                ))}
                            <button
                                disabled={currentPage >= totalPages}
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                className="p-1.5 rounded-lg text-navy/40 hover:text-navy hover:bg-navy/[0.04] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                            >
                                {isRtl ? icons.chevronLeft : icons.chevronRight}
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Bottom add row ── */}
                <div className="flex items-center gap-6 px-5 py-2.5 border-t border-navy/[0.04] text-navy/25 text-xs">
                    <button onClick={() => setShowAddModal(true)} className="flex items-center gap-1.5 hover:text-pink transition-colors cursor-pointer">
                        {icons.plus} {t('patients.add')}
                    </button>
                </div>
            </div>

            {/* ── Selected bar ── */}
            {selectedIds.size > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-4 bg-navy text-white px-6 py-3 rounded-2xl shadow-[0_8px_30px_rgba(30,42,86,0.25)] animate-[slideUp_0.25s_ease-out]">
                    <span className="text-sm font-medium">
                        {t(selectedIds.size > 1 ? 'patients.toolbar.selected_plural' : 'patients.toolbar.selected', { count: selectedIds.size })}
                    </span>
                    <div className="w-px h-5 bg-white/15" />
                    <button
                        onClick={() => {
                            selectedIds.forEach(id => deletePatient(id))
                            setSelectedIds(new Set())
                        }}
                        className="flex items-center gap-1.5 text-sm text-red-300 hover:text-red-200 transition-colors cursor-pointer"
                    >
                        {icons.trash} {t('patients.selected_bar.delete')}
                    </button>
                    <button
                        onClick={() => setSelectedIds(new Set())}
                        className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white transition-colors cursor-pointer"
                    >
                        {t('patients.selected_bar.deselect')}
                    </button>
                </div>
            )}

            {/* ═══════ Add Patient Modal ═══════ */}
            {showAddModal && <AddPatientModal onClose={() => setShowAddModal(false)} onSave={addPatient} />}
        </div>
    )
}

/* ─── Add Patient Modal Component ─── */
function AddPatientModal({
    onClose,
    onSave,
}: {
    onClose: () => void
    onSave: (p: Omit<Patient, 'id' | 'createdAt'>) => void
}) {
    const { t } = useTranslation()
    const [form, setForm] = useState({
        fullName: '',
        dateOfBirth: '',
        address: '',
        phoneNumber: '',
        ssn: '',
        bloodType: '' as string,
    })

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        onSave({
            ...form,
            bloodType: form.bloodType ? (form.bloodType as BloodType) : null,
        })
    }

    const inputClass =
        'w-full px-4 py-2.5 text-sm bg-navy/[0.02] border border-navy/[0.08] rounded-xl text-navy placeholder:text-navy/25 focus:outline-none focus:ring-2 focus:ring-pink/20 focus:border-pink/30 transition-all duration-200'

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Overlay */}
            <div className="absolute inset-0 bg-navy/30 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]" onClick={onClose} />

            {/* Modal */}
            <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-[0_24px_80px_rgba(30,42,86,0.18)] p-7 animate-[scaleIn_0.25s_ease-out]">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-lg font-bold text-navy">{t('patients.modal.title')}</h2>
                        <p className="text-xs text-navy/40 mt-0.5">{t('patients.modal.subtitle')}</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl text-navy/30 hover:text-navy hover:bg-navy/[0.04] transition-colors cursor-pointer">
                        {icons.close}
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Full name */}
                    <div>
                        <label className="block text-xs font-semibold text-navy/50 mb-1.5">{t('patients.modal.full_name')}</label>
                        <input
                            required
                            value={form.fullName}
                            onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                            placeholder={t('patients.modal.full_name_placeholder')}
                            className={inputClass}
                        />
                    </div>

                    {/* Date of birth + Blood type */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-semibold text-navy/50 mb-1.5">{t('patients.modal.dob')}</label>
                            <input
                                type="date"
                                value={form.dateOfBirth}
                                onChange={e => setForm(f => ({ ...f, dateOfBirth: e.target.value }))}
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-navy/50 mb-1.5">{t('patients.modal.blood_type')}</label>
                            <select
                                value={form.bloodType}
                                onChange={e => setForm(f => ({ ...f, bloodType: e.target.value }))}
                                className={inputClass}
                            >
                                <option value="">{t('patients.modal.blood_type_unspecified')}</option>
                                {Object.values(BloodType).map(bt => (
                                    <option key={bt} value={bt}>{bt}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Phone + SSN */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-semibold text-navy/50 mb-1.5">{t('patients.modal.phone')}</label>
                            <input
                                value={form.phoneNumber}
                                onChange={e => setForm(f => ({ ...f, phoneNumber: e.target.value }))}
                                placeholder={t('patients.modal.phone_placeholder')}
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-navy/50 mb-1.5">{t('patients.modal.ssn')}</label>
                            <input
                                value={form.ssn}
                                onChange={e => setForm(f => ({ ...f, ssn: e.target.value }))}
                                placeholder={t('patients.modal.ssn_placeholder')}
                                className={inputClass}
                            />
                        </div>
                    </div>

                    {/* Address */}
                    <div>
                        <label className="block text-xs font-semibold text-navy/50 mb-1.5">{t('patients.modal.address')}</label>
                        <input
                            value={form.address}
                            onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                            placeholder={t('patients.modal.address_placeholder')}
                            className={inputClass}
                        />
                    </div>

                    {/* Buttons */}
                    <div className="flex items-center justify-end gap-3 pt-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-5 py-2.5 text-sm font-medium text-navy/50 hover:text-navy hover:bg-navy/[0.04] rounded-xl transition-colors cursor-pointer"
                        >
                            {t('patients.modal.cancel')}
                        </button>
                        <button
                            type="submit"
                            className="px-6 py-2.5 text-sm font-semibold bg-gradient-to-r from-pink to-pink-light text-white rounded-xl shadow-[0_4px_14px_rgba(233,30,140,0.25)] hover:shadow-[0_6px_20px_rgba(233,30,140,0.35)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 cursor-pointer"
                        >
                            {t('patients.modal.save')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}