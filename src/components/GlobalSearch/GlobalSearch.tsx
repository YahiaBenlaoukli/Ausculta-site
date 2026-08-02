import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { GlobalSearchResults, SearchResult, SearchResultType } from '../../../types/search'

/* ─── Icons, one per result kind ─── */
const icons: Record<SearchResultType, JSX.Element> = {
  patient: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  consultation: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" />
      <path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4" />
      <circle cx="20" cy="10" r="2" />
    </svg>
  ),
  prescription: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2h6v4H9z" />
      <path d="M7 4h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M9 12h6" />
      <path d="M12 9v6" />
    </svg>
  ),
  document: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
}

const EMPTY_RESULTS: GlobalSearchResults = {
  patients: [], consultations: [], prescriptions: [], documents: [], total: 0, truncated: false,
}

/** Order the groups are rendered and traversed in. Patients first: it is what
 *  the box is used for nine times out of ten. */
const GROUPS: { key: keyof Omit<GlobalSearchResults, 'total' | 'truncated'>; type: SearchResultType }[] = [
  { key: 'patients', type: 'patient' },
  { key: 'consultations', type: 'consultation' },
  { key: 'prescriptions', type: 'prescription' },
  { key: 'documents', type: 'document' },
]

interface GlobalSearchProps {
  open: boolean
  onClose: () => void
}

export default function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GlobalSearchResults>(EMPTY_RESULTS)
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  /* Flat list backing keyboard traversal — the visual grouping is cosmetic. */
  const flatResults = useMemo(
    () => GROUPS.flatMap(group => results[group.key]),
    [results]
  )

  /* ── Reset and focus whenever the palette is opened ── */
  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults(EMPTY_RESULTS)
    setActiveIndex(0)
    // The overlay mounts in the same tick; focus after paint or it is lost.
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  /* ── Debounced query ──────────────────────────────────────────────────────
     `requestId` guards against out-of-order replies: a slow search for "be"
     must not overwrite the finished results for "benali". */
  const requestId = useRef(0)
  useEffect(() => {
    if (!open) return

    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults(EMPTY_RESULTS)
      setLoading(false)
      return
    }

    setLoading(true)
    const id = ++requestId.current
    const timer = setTimeout(async () => {
      try {
        const found = await window.ipcRenderer.globalSearch(trimmed)
        if (id !== requestId.current) return
        setResults(found ?? EMPTY_RESULTS)
        setActiveIndex(0)
      } catch (error) {
        console.error('globalSearch failed:', error)
        if (id === requestId.current) setResults(EMPTY_RESULTS)
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    }, 180)

    return () => clearTimeout(timer)
  }, [query, open])

  /* ── Activating a result ── */
  const activate = useCallback(async (result: SearchResult) => {
    onClose()
    switch (result.type) {
      case 'patient':
        navigate(`/patients/${result.id}`)
        break
      case 'consultation':
        navigate(`/consultation/${result.id}`)
        break
      case 'prescription':
        // No per-prescription route exists; the patient file lists them all.
        navigate(`/patients/${result.patientId}`)
        break
      case 'document':
        // Opening the file itself beats dropping the doctor on a list to
        // find it again. Fall back to the patient file if the path is gone.
        if (result.localPath) {
          const error = await window.ipcRenderer.openDocument(result.localPath)
          if (!error) return
          console.error('openDocument failed:', error)
        }
        navigate(`/patients/${result.patientId}`)
        break
    }
  }, [navigate, onClose])

  /* ── Keyboard navigation ── */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (!flatResults.length) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => (i + 1) % flatResults.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => (i - 1 + flatResults.length) % flatResults.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selected = flatResults[activeIndex]
      if (selected) void activate(selected)
    }
  }

  /* Keep the highlighted row inside the scroll viewport during arrow-key nav. */
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const formatDate = (iso: string | null) => {
    if (!iso) return null
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleDateString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric' })
  }

  /* A consultation saved with no clinical text yet has nothing to show as a
     title — label it rather than rendering a blank row. */
  const titleFor = (result: SearchResult) =>
    result.title || t(`search.untitled.${result.type}`)

  if (!open) return null

  const hasQuery = query.trim().length >= 2
  const showEmpty = hasQuery && !loading && flatResults.length === 0

  /* Running offset so each group's rows know their index in the flat list. */
  let renderedIndex = -1

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4 bg-navy/40 backdrop-blur-[2px]"
      style={{ animation: 'fadeIn 120ms ease-out' }}
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-[620px] bg-white rounded-2xl shadow-[0_24px_64px_rgba(20,29,61,0.28)] border border-navy/10 overflow-hidden"
        style={{ animation: 'scaleIn 140ms cubic-bezier(0.4,0,0.2,1)' }}
        onMouseDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('search.title')}
      >
        {/* ── Input row ── */}
        <div className="flex items-center gap-3 px-5 border-b border-navy/8">
          <span className="text-navy/35 flex-shrink-0">
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="20" y1="20" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            className="flex-1 py-4 bg-transparent text-[15px] text-navy placeholder:text-navy/35 focus:outline-none"
          />
          {loading && (
            <span className="w-4 h-4 border-2 border-navy/15 border-t-pink rounded-full animate-spin flex-shrink-0" />
          )}
          <kbd className="flex-shrink-0 text-[10px] font-semibold text-navy/40 bg-navy/6 border border-navy/10 rounded-md px-1.5 py-1">
            ESC
          </kbd>
        </div>

        {/* ── Results ── */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto">
          {!hasQuery && (
            <p className="px-5 py-8 text-center text-sm text-navy/45">
              {t('search.hint')}
            </p>
          )}

          {showEmpty && (
            <p className="px-5 py-8 text-center text-sm text-navy/45">
              {t('search.no_results', { query: query.trim() })}
            </p>
          )}

          {GROUPS.map(group => {
            const rows = results[group.key]
            if (!rows.length) return null

            return (
              <div key={group.key} className="py-1.5">
                <div className="px-5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[1.1px] text-navy/35">
                  {t(`search.groups.${group.key}`)}
                </div>
                {rows.map(result => {
                  renderedIndex += 1
                  const index = renderedIndex
                  const active = index === activeIndex
                  const date = formatDate(result.date)

                  return (
                    <button
                      key={`${result.type}-${result.id}`}
                      data-active={active}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => void activate(result)}
                      className={`
                        w-full flex items-center gap-3 px-5 py-2.5 text-start cursor-pointer
                        transition-colors duration-100
                        ${active ? 'bg-pink/8' : 'hover:bg-navy/4'}
                      `}
                    >
                      <span className={`flex-shrink-0 ${active ? 'text-pink' : 'text-navy/40'}`}>
                        {icons[result.type]}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-navy truncate">
                          {titleFor(result)}
                        </span>
                        {result.subtitle && (
                          <span className="block text-xs text-navy/45 truncate">
                            {result.subtitle}
                          </span>
                        )}
                      </span>
                      {date && (
                        <span className="flex-shrink-0 text-[11px] text-navy/35 tabular-nums">
                          {date}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* ── Footer hints ── */}
        {flatResults.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-t border-navy/8 bg-navy/[0.02]">
            <span className="text-[11px] text-navy/40">
              {results.truncated ? t('search.truncated') : t('search.count', { count: results.total })}
            </span>
            <span className="text-[11px] text-navy/40 hidden sm:block">
              {t('search.nav_hint')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
