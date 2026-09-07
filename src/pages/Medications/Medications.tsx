import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
    CatalogMedication,
    MedicationAlternative,
    MedicationDetail,
    MedicationFacets,
    MedicationFilters,
    MedicationPage,
    MedicationSchedule,
} from '../../../types/medication'

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
    info: (
        <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
    ),
    check: (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    ),
    pill: (
        <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.5 20.5a5 5 0 0 1-7-7l7-7a5 5 0 0 1 7 7z" /><line x1="8.5" y1="8.5" x2="15.5" y2="15.5" />
        </svg>
    ),
}

/** Rows fetched per page. Matches the service default. */
const PAGE_SIZE = 50

/** The filters held as page state. The text query is tracked separately, since it
 *  is debounced and the others apply immediately. */
type FacetFilters = Omit<MedicationFilters, 'query'>

/* ─── Shared value formatting ─────────────────────────────────────────────── */

/**
 * Controlled-drug badge. Liste I is 63% of the catalogue, so it renders as plain
 * text — a badge on two rows in three is decoration, not a warning. Liste II and
 * narcotics change what the doctor has to write, so those get called out.
 */
function scheduleBadge(schedule: MedicationSchedule | null) {
    if (schedule === 'STUPEFIANT') return { tone: 'bg-pink/12 text-pink', strong: true }
    if (schedule === 'II') return { tone: 'bg-amber-50 text-amber-700', strong: true }
    return { tone: '', strong: false }
}

/* ─── Detail panel ────────────────────────────────────────────────────────── */

/** One label/value row in the detail panel. Renders nothing when there is no value. */
function DetailRow({ label, value, hint }: { label: string; value: string | null | undefined; hint?: string }) {
    if (!value) return null
    return (
        <div className="flex items-baseline gap-3 py-1.5">
            <span className="w-32 flex-shrink-0 text-[11px] font-semibold uppercase tracking-wide text-navy/35">{label}</span>
            {/* Catalogue values are French/Latin whatever the interface language. */}
            <span dir="ltr" className="flex-1 text-sm text-navy/80" title={hint}>{value}</span>
        </div>
    )
}

/**
 * Slide-over showing one product in full, plus the other brands of the same
 * molecule.
 *
 * Alternatives are clickable and re-target the panel, so a doctor can walk a
 * molecule's brands without going back to the list.
 */
function MedicationDetailPanel({
    catalogKey, onNavigate, onClose, isRtl,
}: { catalogKey: string; onNavigate: (key: string) => void; onClose: () => void; isRtl: boolean }) {
    const { t } = useTranslation()
    const [detail, setDetail] = useState<MedicationDetail | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let stale = false
        setLoading(true)
        void (async () => {
            try {
                const result = await window.ipcRenderer.getMedicationDetail(catalogKey)
                if (stale) return
                setDetail(result?.status === 'success' ? result.data ?? null : null)
            } catch (error) {
                console.error('getMedicationDetail failed:', error)
                if (!stale) setDetail(null)
            } finally {
                if (!stale) setLoading(false)
            }
        })()
        return () => { stale = true }
    }, [catalogKey])

    /* Escape closes, as it does for the app's modals. */
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [onClose])

    const med = detail?.medication

    /* Grouped only by the heading that precedes the first of each kind — the list
       stays flat so it scrolls as one thing. */
    const alternativeLabel = (alt: MedicationAlternative, index: number, all: MedicationAlternative[]) => {
        const tier = (a: MedicationAlternative) => (a.sameStrength && a.sameForm ? 0 : a.sameStrength ? 1 : 2)
        if (index > 0 && tier(all[index - 1]) === tier(alt)) return null
        return t(`medications.detail.tier_${tier(alt)}`)
    }

    return (
        <>
            <div
                className="fixed inset-0 z-40 bg-navy/20 animate-[fadeIn_0.15s_ease-out]"
                onClick={onClose}
            />
            <aside
                className={`fixed top-0 bottom-0 ${isRtl ? 'left-0' : 'right-0'} z-50 w-full max-w-[440px] bg-white shadow-[0_0_40px_rgba(20,29,61,0.22)] flex flex-col`}
                role="dialog"
                aria-label={t('medications.detail.title')}
            >
                {/* ── Panel header ── */}
                <div className="flex items-start gap-3 px-5 py-4 border-b border-navy/[0.07]">
                    <div className="flex-1 min-w-0">
                        {loading ? (
                            <div className="h-6 w-40 bg-navy/[0.06] rounded-md animate-pulse" />
                        ) : med ? (
                            <>
                                <h2 dir="ltr" className="text-lg font-bold text-navy leading-tight break-words">
                                    {med.brand} {med.dosage && <span className="text-navy/55 font-semibold">{med.dosage}</span>}
                                </h2>
                                <p dir="ltr" className="text-xs text-navy/45 mt-0.5">{med.innShort ?? med.inn ?? '—'}</p>
                            </>
                        ) : (
                            <h2 className="text-lg font-bold text-navy">{t('medications.detail.missing')}</h2>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        aria-label={t('medications.detail.close')}
                        className="flex-shrink-0 p-1.5 rounded-lg text-navy/40 hover:text-navy hover:bg-navy/[0.05] transition-colors cursor-pointer"
                    >
                        {icons.close}
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                    {med && (
                        <>
                            {/* ── Status chips: the two things that change what gets written ── */}
                            <div className="flex flex-wrap items-center gap-2 mb-4">
                                <span
                                    className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide ${med.source === 'dz' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}
                                    title={t(med.source === 'dz' ? 'medications.provenance.legacy_hint' : 'medications.provenance.current_hint')}
                                >
                                    {t(med.source === 'dz' ? 'medications.provenance.legacy' : 'medications.provenance.current')}
                                </span>
                                {med.schedule && (
                                    <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide ${scheduleBadge(med.schedule).strong ? scheduleBadge(med.schedule).tone : 'bg-navy/[0.06] text-navy/55'}`}>
                                        {t(`medications.schedule.${med.schedule}`)}
                                    </span>
                                )}
                                {med.refundable === true && (
                                    <span className="px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide bg-navy/[0.06] text-navy/60">
                                        {t('medications.table.refundable')}
                                    </span>
                                )}
                            </div>

                            {/* A narcotic is not an ordinary prescription — say so where the
                                doctor is looking at the drug, not only in a legend. */}
                            {med.schedule === 'STUPEFIANT' && (
                                <p className="flex items-start gap-2 mb-4 px-3 py-2 rounded-xl bg-pink/[0.06] text-[11px] leading-relaxed text-pink-dark">
                                    {icons.info}
                                    <span>{t('medications.detail.narcotic_note')}</span>
                                </p>
                            )}

                            <div className="divide-y divide-navy/[0.05]">
                                <DetailRow label={t('medications.table.molecule')} value={med.innShort ?? med.inn} hint={med.inn ?? undefined} />
                                <DetailRow label={t('medications.table.form')} value={med.form} hint={med.formRaw ?? undefined} />
                                <DetailRow label={t('medications.detail.packaging')} value={med.packaging.join(' · ') || null} />
                                <DetailRow label={t('medications.detail.composition')} value={med.composition} />
                                <DetailRow label={t('medications.table.therapeutic')} value={med.therapeutic} />
                                <DetailRow label={t('medications.detail.pharmacological')} value={med.pharmacological} />
                                <DetailRow label={t('medications.detail.class_code')} value={med.classCode} />
                                <DetailRow label={t('medications.table.lab')} value={med.lab} />
                                <DetailRow label={t('medications.detail.country')} value={med.country} />
                                <DetailRow label={t('medications.detail.registration')} value={med.registration} />
                                <DetailRow
                                    label={t('medications.detail.refundable')}
                                    value={med.refundable === null ? t('medications.value.unknown') : t(med.refundable ? 'medications.value.yes' : 'medications.value.no')}
                                />
                            </div>

                            {/* ── Alternatives ── */}
                            <div className="mt-6">
                                <h3 className="text-[11px] font-bold uppercase tracking-[1px] text-navy/40 mb-2">
                                    {t('medications.detail.alternatives', { n: detail?.alternatives.length ?? 0 })}
                                </h3>

                                {detail && detail.alternatives.length === 0 ? (
                                    <p className="text-xs text-navy/40 leading-relaxed">
                                        {t(med.innShort ?? med.inn ? 'medications.detail.no_alternatives' : 'medications.detail.no_molecule')}
                                    </p>
                                ) : (
                                    <div className="space-y-px">
                                        {detail?.alternatives.map((alt, index, all) => {
                                            const heading = alternativeLabel(alt, index, all)
                                            return (
                                                <div key={alt.key}>
                                                    {heading && (
                                                        <div className="pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-navy/30">
                                                            {heading}
                                                        </div>
                                                    )}
                                                    <button
                                                        onClick={() => onNavigate(alt.key)}
                                                        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-start hover:bg-navy/[0.04] transition-colors cursor-pointer"
                                                    >
                                                        <span className="flex-1 min-w-0" dir="ltr">
                                                            <span className="block text-sm text-navy truncate">
                                                                {alt.brand} <span className="text-navy/50 font-semibold">{alt.dosage}</span>
                                                            </span>
                                                            <span className="block text-[11px] text-navy/40 truncate">
                                                                {[alt.form, alt.lab].filter(Boolean).join(' · ')}
                                                            </span>
                                                        </span>
                                                        {alt.source !== 'dz' && (
                                                            <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500" title={t('medications.provenance.current_hint')} />
                                                        )}
                                                    </button>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}

                                {/* The limit of the data, stated where the substitution is offered. */}
                                <p className="flex items-start gap-2 mt-4 px-3 py-2 rounded-xl bg-navy/[0.03] text-[11px] leading-relaxed text-navy/50">
                                    {icons.info}
                                    <span>{t('medications.detail.substitution_note')}</span>
                                </p>
                            </div>
                        </>
                    )}
                </div>
            </aside>
        </>
    )
}

/* ─── Page ────────────────────────────────────────────────────────────────── */

/**
 * The national drug registry, browsable.
 *
 * This is a lookup tool, not a drug-information database: it answers "what is
 * this called, in what strengths and forms, from whom, is it refundable, does it
 * need a carnet à souches, and is it still registered". It carries no
 * interactions, contraindications or posology, because neither upstream source
 * does — see types/medication.ts. The page says so in the header rather than
 * leaving a doctor to infer it from absence.
 */
export default function Medications() {
    const { t, i18n } = useTranslation()
    const isRtl = i18n.dir() === 'rtl'

    const [query, setQuery] = useState('')
    /* Debounced copy — the scan is cheap but a request per keystroke is not. */
    const [search, setSearch] = useState('')
    const [filters, setFilters] = useState<FacetFilters>({})
    const [page, setPage] = useState(1)

    const [result, setResult] = useState<MedicationPage | null>(null)
    const [facets, setFacets] = useState<MedicationFacets | null>(null)
    const [loading, setLoading] = useState(true)
    /* The bundle is missing or unreadable — see medicationCatalog.ts. Worth saying
       plainly, since every result would otherwise be a silent zero. */
    const [unavailable, setUnavailable] = useState(false)
    const [openMenu, setOpenMenu] = useState<'form' | 'therapeutic' | 'schedule' | null>(null)
    const [detailKey, setDetailKey] = useState<string | null>(null)

    useEffect(() => {
        // Page 1 goes with the new query: staying on page 7 of a result set that
        // just shrank to two pages is disorienting. Reset here rather than in an
        // effect on `search`, which would fetch once for the old page and again
        // for the reset one.
        const timer = setTimeout(() => { setSearch(query); setPage(1) }, 200)
        return () => clearTimeout(timer)
    }, [query])

    useEffect(() => {
        void (async () => {
            try {
                const response = await window.ipcRenderer.getMedicationFacets()
                if (response?.status === 'success' && response.data) {
                    setFacets(response.data)
                    setUnavailable(response.data.total === 0)
                } else {
                    setUnavailable(true)
                }
            } catch (error) {
                console.error('getMedicationFacets failed:', error)
                setUnavailable(true)
            }
        })()
    }, [])

    useEffect(() => {
        let stale = false
        setLoading(true)
        void (async () => {
            try {
                const response = await window.ipcRenderer.browseMedications({ ...filters, query: search }, page, PAGE_SIZE)
                if (stale) return
                setResult(response?.status === 'success' ? response.data ?? null : null)
            } catch (error) {
                console.error('browseMedications failed:', error)
                if (!stale) setResult(null)
            } finally {
                if (!stale) setLoading(false)
            }
        })()
        return () => { stale = true }
    }, [search, filters, page])

    /* Close an open filter menu on any outside click. */
    useEffect(() => {
        if (!openMenu) return
        const onPointerDown = () => setOpenMenu(null)
        // Deferred so the click that opened the menu does not immediately close it.
        const timer = setTimeout(() => document.addEventListener('click', onPointerDown), 0)
        return () => { clearTimeout(timer); document.removeEventListener('click', onPointerDown) }
    }, [openMenu])

    const setFilter = useCallback(<K extends keyof FacetFilters>(key: K, value: FacetFilters[K]) => {
        setFilters(prev => {
            const next = { ...prev }
            // Undefined means "any", so an unset filter is removed rather than
            // carried as a key the service would have to interpret.
            if (value === undefined || value === '' || value === false) delete next[key]
            else next[key] = value
            return next
        })
        setPage(1)
        setOpenMenu(null)
    }, [])

    const activeCount = Object.keys(filters).length
    const lastPage = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1
    const rows = result?.items ?? []

    /* A menu of facet values, each with its row count. Long menus scroll rather
       than being truncated — 101 therapeutic classes is the whole point of the
       filter, and hiding the tail would silently narrow it. */
    const facetMenu = (
        id: 'form' | 'therapeutic' | 'schedule',
        values: { value: string; count: number }[],
        active: string | undefined,
        onPick: (value: string | undefined) => void,
        translateValue?: (value: string) => string,
    ) => (
        <div className="relative">
            <button
                onClick={e => { e.stopPropagation(); setOpenMenu(openMenu === id ? null : id) }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150 cursor-pointer ${active ? 'bg-pink/10 text-pink' : 'text-navy/60 hover:bg-navy/[0.04]'}`}
            >
                {id === 'form' && icons.filter}
                <span dir={active ? 'ltr' : undefined} className="max-w-[160px] truncate">
                    {active ? (translateValue?.(active) ?? active) : t(`medications.toolbar.${id}`)}
                </span>
            </button>
            {openMenu === id && (
                <div
                    onClick={e => e.stopPropagation()}
                    className={`absolute top-full ${isRtl ? 'right-0' : 'left-0'} mt-1 w-64 max-h-[320px] overflow-y-auto bg-white rounded-xl shadow-[0_8px_30px_rgba(30,42,86,0.14)] border border-navy/[0.06] py-1.5 z-30 animate-[fadeIn_0.15s_ease-out]`}
                >
                    <button
                        onClick={() => onPick(undefined)}
                        className={`w-full ${isRtl ? 'text-right' : 'text-left'} px-3 py-1.5 text-xs cursor-pointer hover:bg-navy/[0.03] transition-colors ${!active ? 'text-pink font-semibold' : 'text-navy/70'}`}
                    >
                        {t('medications.toolbar.all')}
                    </button>
                    {values.map(item => (
                        <button
                            key={item.value}
                            onClick={() => onPick(item.value)}
                            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-navy/[0.03] transition-colors ${active === item.value ? 'text-pink font-semibold' : 'text-navy/70'}`}
                        >
                            <span dir="ltr" className={`flex-1 truncate ${isRtl ? 'text-right' : 'text-left'}`}>
                                {translateValue?.(item.value) ?? item.value}
                            </span>
                            <span className="flex-shrink-0 text-[10px] text-navy/30 tabular-nums">{item.count}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )

    return (
        <div className="space-y-5">
            {/* ── Page header ── */}
            <div>
                <h1 className="text-2xl font-bold text-navy">{t('medications.title')}</h1>
                <p className="text-sm text-navy/50 mt-0.5">
                    {t('medications.subtitle', { total: facets?.total ?? 0, current: facets?.onCurrentList ?? 0 })}
                </p>
                {/* Always present, never dismissible: the absence of interaction data
                    is a permanent property of this page, not a notice to acknowledge. */}
                <p className="flex items-start gap-2 mt-3 px-3 py-2 rounded-xl bg-navy/[0.035] text-[11.5px] leading-relaxed text-navy/55 max-w-3xl">
                    {icons.info}
                    <span>{t('medications.scope_note')}</span>
                </p>
            </div>

            {unavailable ? (
                <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(30,42,86,0.06)] px-6 py-12 text-center">
                    <div className="inline-flex text-navy/15 mb-3">{icons.pill}</div>
                    <p className="text-sm font-semibold text-navy/70">{t('medications.unavailable.title')}</p>
                    <p className="text-xs text-navy/45 mt-1">{t('medications.unavailable.hint')}</p>
                </div>
            ) : (
                <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(30,42,86,0.06)] overflow-hidden">
                    {/* ── Toolbar ── */}
                    <div className="flex flex-wrap items-center gap-2.5 px-5 py-3 border-b border-navy/[0.06]">
                        <div className="relative">
                            <span className={`absolute ${isRtl ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-navy/30`}>{icons.search}</span>
                            <input
                                type="text"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                placeholder={t('medications.toolbar.search_placeholder')}
                                /* Drug names are Latin whatever the interface language. */
                                dir="auto"
                                className={`${isRtl ? 'pr-9 pl-4' : 'pl-9 pr-4'} py-2 w-64 text-sm bg-navy/[0.03] border border-navy/[0.06] rounded-xl text-navy placeholder:text-navy/30 focus:outline-none focus:ring-2 focus:ring-pink/20 focus:border-pink/30 transition-all duration-200`}
                            />
                        </div>

                        {facetMenu('form', facets?.formGroups ?? [], filters.formGroup, v => setFilter('formGroup', v))}
                        {facetMenu('therapeutic', facets?.therapeutic ?? [], filters.therapeutic, v => setFilter('therapeutic', v))}
                        {facetMenu(
                            'schedule',
                            facets?.schedules ?? [],
                            filters.schedule,
                            v => setFilter('schedule', v as MedicationSchedule | undefined),
                            v => t(`medications.schedule.${v}`),
                        )}

                        <button
                            onClick={() => setFilter('refundable', !filters.refundable)}
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150 cursor-pointer ${filters.refundable ? 'bg-pink/10 text-pink' : 'text-navy/60 hover:bg-navy/[0.04]'}`}
                        >
                            {filters.refundable && icons.check}
                            {t('medications.toolbar.refundable')}
                        </button>
                        <button
                            onClick={() => setFilter('onCurrentList', !filters.onCurrentList)}
                            title={t('medications.provenance.current_hint')}
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150 cursor-pointer ${filters.onCurrentList ? 'bg-pink/10 text-pink' : 'text-navy/60 hover:bg-navy/[0.04]'}`}
                        >
                            {filters.onCurrentList && icons.check}
                            {t('medications.toolbar.current_list')}
                        </button>

                        {activeCount > 0 && (
                            <button
                                onClick={() => { setFilters({}); setPage(1) }}
                                className="text-xs font-medium text-navy/40 hover:text-pink transition-colors cursor-pointer"
                            >
                                {t('medications.toolbar.clear')}
                            </button>
                        )}

                        <div className="flex-1" />

                        <span className="text-xs text-navy/40 font-medium tabular-nums">
                            {t('medications.toolbar.results', { count: result?.total ?? 0 })}
                        </span>
                    </div>

                    {/* ── Results ── */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b border-navy/[0.06]">
                                    {['brand', 'molecule', 'form', 'therapeutic', 'schedule', 'refundable', 'lab'].map(column => (
                                        <th key={column} className={`px-4 py-3 ${isRtl ? 'text-right' : 'text-left'}`}>
                                            <span className="text-[11px] font-semibold uppercase tracking-wider text-navy/40">
                                                {t(`medications.table.${column}`)}
                                            </span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    Array.from({ length: 8 }).map((_, i) => (
                                        <tr key={`skel-${i}`} className="border-b border-navy/[0.03]">
                                            {Array.from({ length: 7 }).map((_, j) => (
                                                <td key={j} className="px-4 py-3.5">
                                                    <div className="h-4 bg-navy/[0.04] rounded-md animate-pulse" style={{ width: `${45 + ((i * 7 + j) % 5) * 11}%` }} />
                                                </td>
                                            ))}
                                        </tr>
                                    ))
                                ) : rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-4 py-16 text-center">
                                            <div className="inline-flex text-navy/15 mb-3">{icons.pill}</div>
                                            <p className="text-sm font-semibold text-navy/60">{t('medications.empty.title')}</p>
                                            <p className="text-xs text-navy/40 mt-1">{t('medications.empty.hint')}</p>
                                        </td>
                                    </tr>
                                ) : (
                                    rows.map((med: CatalogMedication) => {
                                        const badge = scheduleBadge(med.schedule)
                                        return (
                                            <tr
                                                key={med.key}
                                                onClick={() => setDetailKey(med.key)}
                                                className="border-b border-navy/[0.03] hover:bg-navy/[0.02] cursor-pointer transition-colors"
                                            >
                                                <td className="px-4 py-3" dir="ltr">
                                                    <div className="flex items-center gap-2">
                                                        <span
                                                            className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${med.source === 'dz' ? 'bg-amber-400' : 'bg-emerald-500'}`}
                                                            title={t(med.source === 'dz' ? 'medications.provenance.legacy_hint' : 'medications.provenance.current_hint')}
                                                        />
                                                        <span className="text-sm font-semibold text-navy">{med.brand}</span>
                                                        {med.dosage && <span className="text-xs text-navy/50 tabular-nums">{med.dosage}</span>}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 max-w-[220px]" dir="ltr">
                                                    <span className="block text-xs text-navy/65 truncate" title={med.inn ?? undefined}>
                                                        {med.innShort ?? med.inn ?? '—'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 max-w-[180px]" dir="ltr">
                                                    <span className="block text-xs text-navy/55 truncate" title={med.form}>{med.formGroup}</span>
                                                </td>
                                                <td className="px-4 py-3 max-w-[180px]" dir="ltr">
                                                    <span className="block text-xs text-navy/55 truncate" title={med.therapeutic ?? undefined}>
                                                        {med.therapeutic ?? '—'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    {med.schedule ? (
                                                        badge.strong ? (
                                                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${badge.tone}`}>
                                                                {t(`medications.schedule.${med.schedule}`)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-xs text-navy/40">{t(`medications.schedule.${med.schedule}`)}</span>
                                                        )
                                                    ) : (
                                                        <span className="text-xs text-navy/25">—</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3">
                                                    {med.refundable === true ? (
                                                        <span className="inline-flex text-emerald-600">{icons.check}</span>
                                                    ) : (
                                                        <span className="text-xs text-navy/25" title={t(med.refundable === false ? 'medications.value.no' : 'medications.value.unknown')}>
                                                            {med.refundable === false ? '—' : '?'}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 max-w-[160px]" dir="ltr">
                                                    <span className="block text-xs text-navy/50 truncate" title={med.lab ?? undefined}>
                                                        {med.lab ?? '—'}
                                                    </span>
                                                </td>
                                            </tr>
                                        )
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* ── Pagination ── */}
                    {rows.length > 0 && (
                        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-navy/[0.06]">
                            <span className="text-xs text-navy/40 tabular-nums">
                                {t('medications.pagination.page', { page: result?.page ?? 1, total: lastPage })}
                            </span>
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={(result?.page ?? 1) <= 1}
                                    aria-label={t('medications.pagination.prev')}
                                    className="p-1.5 rounded-lg text-navy/50 enabled:hover:bg-navy/[0.05] enabled:hover:text-navy disabled:opacity-25 disabled:cursor-default transition-colors cursor-pointer"
                                >
                                    {isRtl ? icons.chevronRight : icons.chevronLeft}
                                </button>
                                <button
                                    onClick={() => setPage(p => Math.min(lastPage, p + 1))}
                                    disabled={(result?.page ?? 1) >= lastPage}
                                    aria-label={t('medications.pagination.next')}
                                    className="p-1.5 rounded-lg text-navy/50 enabled:hover:bg-navy/[0.05] enabled:hover:text-navy disabled:opacity-25 disabled:cursor-default transition-colors cursor-pointer"
                                >
                                    {isRtl ? icons.chevronLeft : icons.chevronRight}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {detailKey && (
                <MedicationDetailPanel
                    catalogKey={detailKey}
                    onNavigate={setDetailKey}
                    onClose={() => setDetailKey(null)}
                    isRtl={isRtl}
                />
            )}
        </div>
    )
}
