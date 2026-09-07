import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MedicineLine, MedicineSuggestion } from '../../../types/doctor'
import type { MedicationDetail } from '../../../types/medication'

interface MedicineNameInputProps {
  value: string
  onChange: (value: string) => void
  /** Fires when a suggestion is picked, carrying the remembered posology so the
   *  parent can refill dosage/frequency/duration/quantity in one go. */
  onPick: (suggestion: MedicineLine) => void
  /** Enter with no suggestion highlighted — lets the host page submit the row. */
  onSubmit?: () => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

const icons = {
  info: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  back: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
}

/**
 * Medicine name field backed by the doctor's own prescribing history, topped up
 * from the national drug catalogue.
 *
 * Focusing it with nothing typed shows their most-prescribed drugs; typing
 * filters that list and, below it, offers matching products registered in Algeria.
 * Picking a history entry fills the whole medicine row — which is where the typing
 * is actually saved, since a doctor reaches for the same thirty drugs with the
 * same posology forever. Picking a catalogue entry fills the name and strength
 * only: the registry has no opinion on how often or how long.
 *
 * A catalogue row can also be opened in place, which replaces the list with that
 * product's record and the other brands of the same molecule — the substitution
 * question ("the pharmacy doesn't have it, what else?") arrives mid-prescription,
 * and answering it must not cost the half-written row.
 */
export default function MedicineNameInput({
  value, onChange, onPick, onSubmit, placeholder, className, disabled,
}: MedicineNameInputProps) {
  const { t } = useTranslation()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [suggestions, setSuggestions] = useState<MedicineSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  /* Non-null while the dropdown is showing one product instead of the list. */
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const [detail, setDetail] = useState<MedicationDetail | null>(null)

  /* The value the list currently reflects. Without this, picking a suggestion
     (which sets `value`) would immediately re-query and reopen the dropdown. */
  const queriedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (queriedFor.current === value) return

    const requestFor = value
    const timer = setTimeout(async () => {
      try {
        const result = await window.ipcRenderer.suggestMedicines(requestFor)
        // Ignore a reply that arrived after the user typed on.
        if (requestFor !== value) return
        queriedFor.current = requestFor
        setSuggestions(result?.data ?? [])
        setActiveIndex(-1)
      } catch (error) {
        console.error('suggestMedicines failed:', error)
        setSuggestions([])
      }
    }, 140)
    return () => clearTimeout(timer)
  }, [value, open])

  /* Typing again abandons the detail view: the query it was reached from is gone. */
  useEffect(() => { setDetailKey(null) }, [value])

  useEffect(() => {
    if (!detailKey) { setDetail(null); return }
    let stale = false
    setDetail(null)
    void (async () => {
      try {
        const result = await window.ipcRenderer.getMedicationDetail(detailKey)
        if (!stale) setDetail(result?.status === 'success' ? result.data ?? null : null)
      } catch (error) {
        console.error('getMedicationDetail failed:', error)
      }
    })()
    return () => { stale = true }
  }, [detailKey])

  /* Close when focus or the pointer leaves the field entirely. */
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) { setOpen(false); setDetailKey(null) }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  /** Fill the row and close up. Shared by list rows, the detail view and alternatives. */
  const pickLine = (line: MedicineLine) => {
    // Mark the incoming value as already-queried so the effect above does not
    // fire a fresh search and pop the list open again.
    queriedFor.current = line.medicineName
    setOpen(false)
    setDetailKey(null)
    setActiveIndex(-1)
    onPick(line)
  }

  const pick = (suggestion: MedicineSuggestion) => pickLine({
    medicineName: suggestion.medicineName,
    dosage: suggestion.dosage,
    frequency: suggestion.frequency,
    duration: suggestion.duration,
    quantity: suggestion.quantity,
  })

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      // Escape backs out one level at a time: detail → list → closed.
      if (detailKey) setDetailKey(null)
      else setOpen(false)
      return
    }
    // Arrow keys belong to the list; in the detail view there is nothing to walk.
    if (detailKey) return
    if (e.key === 'ArrowDown' && !open) {
      setOpen(true)
      return
    }
    if (open && suggestions.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex(i => (i + 1) % suggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex(i => (i <= 0 ? suggestions.length - 1 : i - 1))
        return
      }
      if (e.key === 'Enter' && activeIndex >= 0) {
        e.preventDefault()
        pick(suggestions[activeIndex])
        return
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      setOpen(false)
      onSubmit?.()
    }
  }

  const posologyOf = (s: MedicineSuggestion) =>
    [s.dosage, s.quantity, s.frequency, s.duration].filter(Boolean).join(' · ')

  /* Second line of a catalogue row: the molecule, then the galenic form. The
     molecule is the useful half — it is what tells the doctor that CLARADINE and
     LORADINE are the same drug. */
  const catalogDetailOf = (s: MedicineSuggestion) =>
    [s.catalog?.inn, s.catalog?.form].filter(Boolean).join(' · ')

  /* Controlled drugs are called out because the prescription itself differs:
     a narcotic needs a carnet à souches, not an ordinary ordonnance. Liste I is
     the unremarkable majority, so flagging it would be noise. */
  const scheduleBadgeOf = (s: MedicineSuggestion) => {
    const schedule = s.catalog?.schedule
    if (schedule === 'STUPEFIANT') {
      return { label: t('prescription_library.suggestions.schedule_narcotic'), tone: 'bg-pink/12 text-pink' }
    }
    if (schedule === 'II') {
      return { label: t('prescription_library.suggestions.schedule_list2'), tone: 'bg-navy/8 text-navy/55' }
    }
    return null
  }

  /* Where each group starts, so the list can be labelled without splitting it
     into two arrays and breaking the flat keyboard navigation above. */
  const firstCatalogIndex = suggestions.findIndex(s => s.catalog)
  const hasHistory = suggestions.some(s => !s.catalog)

  const med = detail?.medication

  return (
    <div ref={wrapperRef} className="relative">
      <input
        value={value}
        disabled={disabled}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        /* Drug names are Latin even when the interface is Arabic; `auto` keeps the
           caret on the correct side for whichever script the doctor types. */
        dir="auto"
      />

      {open && detailKey && (
        <div className="absolute z-30 top-full mt-1 w-full min-w-[320px] max-h-[340px] overflow-y-auto bg-white rounded-xl border border-navy/10 shadow-[0_12px_32px_rgba(20,29,61,0.16)]">
          {/* ── Detail header: back to the list, then the product ── */}
          <div className="sticky top-0 bg-white border-b border-navy/[0.07] px-3 py-2">
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); setDetailKey(null) }}
              className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-navy/40 hover:text-pink transition-colors cursor-pointer bg-transparent border-none p-0"
            >
              {icons.back}
              {t('prescription_library.suggestions.back')}
            </button>
            {med && (
              <div dir="ltr" className="mt-1.5">
                <span className="text-sm font-semibold text-navy">{med.brand}</span>
                {med.dosage && <span className="ms-1.5 text-xs font-semibold text-navy/50">{med.dosage}</span>}
                <span className="block text-[11px] text-navy/45 truncate">{med.innShort ?? med.inn ?? '—'}</span>
              </div>
            )}
          </div>

          {!med ? (
            <div className="px-3 py-4 space-y-2">
              <div className="h-3 w-32 bg-navy/[0.05] rounded animate-pulse" />
              <div className="h-3 w-24 bg-navy/[0.05] rounded animate-pulse" />
            </div>
          ) : (
            <div className="px-3 py-2.5">
              {/* ── Facts, one line each, nothing padded out with dashes ── */}
              <dl dir="ltr" className="text-[11px] leading-relaxed">
                {([
                  ['medications.table.form', med.form],
                  ['medications.detail.packaging', med.packaging.join(' · ')],
                  ['medications.table.lab', med.lab],
                  ['medications.table.therapeutic', med.therapeutic],
                ] as [string, string | null][]).filter(([, v]) => v).map(([labelKey, v]) => (
                  <div key={labelKey} className="flex gap-2">
                    <dt className="w-20 flex-shrink-0 text-navy/35">{t(labelKey)}</dt>
                    <dd className="flex-1 text-navy/70 truncate" title={v ?? undefined}>{v}</dd>
                  </div>
                ))}
              </dl>

              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span
                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${med.source === 'dz' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}
                  title={t(med.source === 'dz' ? 'medications.provenance.legacy_hint' : 'medications.provenance.current_hint')}
                >
                  {t(med.source === 'dz' ? 'medications.provenance.legacy' : 'medications.provenance.current')}
                </span>
                {med.schedule && (
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${med.schedule === 'STUPEFIANT' ? 'bg-pink/12 text-pink' : 'bg-navy/[0.06] text-navy/55'}`}>
                    {t(`medications.schedule.${med.schedule}`)}
                  </span>
                )}
                {med.refundable === true && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-navy/[0.06] text-navy/55">
                    {t('medications.table.refundable')}
                  </span>
                )}
              </div>

              <button
                type="button"
                onMouseDown={e => {
                  e.preventDefault()
                  pickLine({ medicineName: med.brand, dosage: med.dosage, frequency: '', duration: '', quantity: '' })
                }}
                className="w-full mt-3 py-1.5 rounded-lg bg-pink/10 text-pink text-xs font-semibold hover:bg-pink/15 transition-colors cursor-pointer border-none"
              >
                {t('prescription_library.suggestions.use_this')}
              </button>

              {/* ── Other brands of the same molecule ── */}
              <div className="mt-3 pt-2 border-t border-navy/[0.07]">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-navy/35 mb-1">
                  {t('prescription_library.suggestions.alternatives', { n: detail?.alternatives.length ?? 0 })}
                </div>
                {detail && detail.alternatives.length === 0 ? (
                  <p className="text-[11px] text-navy/40 pb-1">{t('prescription_library.suggestions.no_alternatives')}</p>
                ) : (
                  detail?.alternatives.map(alt => (
                    <button
                      key={alt.key}
                      type="button"
                      onMouseDown={e => {
                        e.preventDefault()
                        pickLine({ medicineName: alt.brand, dosage: alt.dosage, frequency: '', duration: '', quantity: '' })
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-start hover:bg-navy/[0.04] transition-colors cursor-pointer bg-transparent border-none"
                    >
                      <span dir="ltr" className="flex-1 min-w-0">
                        <span className="block text-xs text-navy truncate">
                          {alt.brand} <span className="text-navy/50 font-semibold">{alt.dosage}</span>
                        </span>
                        <span className="block text-[10px] text-navy/40 truncate">{alt.form}</span>
                      </span>
                      {/* Same strength AND form is the only swap that is purely a
                          change of brand; the rest are a clinical decision. */}
                      {alt.sameStrength && alt.sameForm && (
                        <span className="flex-shrink-0 px-1 py-px rounded text-[8px] font-bold uppercase text-emerald-700 bg-emerald-50">
                          {t('prescription_library.suggestions.same_product')}
                        </span>
                      )}
                    </button>
                  ))
                )}
                <p className="text-[10px] leading-relaxed text-navy/35 mt-2">
                  {t('prescription_library.suggestions.substitution_note')}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {open && !detailKey && suggestions.length > 0 && (
        <div className="absolute z-30 top-full mt-1 w-full min-w-[240px] max-h-[260px] overflow-y-auto bg-white rounded-xl border border-navy/10 shadow-[0_12px_32px_rgba(20,29,61,0.16)] py-1">
          {!value.trim() && (
            <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-[1px] text-navy/35">
              {t('prescription_library.suggestions.frequent')}
            </div>
          )}
          {suggestions.map((suggestion, index) => {
            const posology = posologyOf(suggestion)
            const catalogDetail = catalogDetailOf(suggestion)
            const badge = scheduleBadgeOf(suggestion)
            return (
              <div key={suggestion.catalog?.key ?? `history:${suggestion.medicineName}`}>
                {/* Only labelled when history is also present — a heading over the
                    whole list would just repeat what the field already is. */}
                {hasHistory && index === firstCatalogIndex && (
                  <div className="px-3 pt-2 pb-1 mt-1 border-t border-navy/8 text-[10px] font-semibold uppercase tracking-[1px] text-navy/35">
                    {t('prescription_library.suggestions.catalog')}
                  </div>
                )}
                {/* The row and the details affordance are siblings, not nested
                    buttons: one fills the prescription line, the other opens the
                    record, and they must not swallow each other's clicks. */}
                <div
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex items-stretch transition-colors ${index === activeIndex ? 'bg-pink/8' : 'bg-transparent hover:bg-navy/4'}`}
                >
                  <button
                    type="button"
                    // mousedown, not click: the input's blur would otherwise close
                    // the list before the click ever lands.
                    onMouseDown={e => { e.preventDefault(); pick(suggestion) }}
                    className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-start cursor-pointer border-none bg-transparent"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm text-navy truncate">{suggestion.medicineName}</span>
                        {suggestion.dosage && suggestion.catalog && (
                          <span className="flex-shrink-0 text-[11px] font-semibold text-navy/50 tabular-nums">
                            {suggestion.dosage}
                          </span>
                        )}
                        {badge && (
                          <span className={`flex-shrink-0 px-1.5 py-px rounded text-[9px] font-bold uppercase tracking-wide ${badge.tone}`}>
                            {badge.label}
                          </span>
                        )}
                      </span>
                      {suggestion.catalog
                        ? catalogDetail && (
                          <span className="block text-[11px] text-navy/45 truncate">{catalogDetail}</span>
                        )
                        : posology && (
                          <span className="block text-[11px] text-navy/45 truncate">{posology}</span>
                        )}
                    </span>
                    {!suggestion.catalog && (
                      <span className="flex-shrink-0 text-[10px] font-semibold text-navy/35 tabular-nums">
                        {t('prescription_library.suggestions.uses', { count: suggestion.uses })}
                      </span>
                    )}
                  </button>
                  {suggestion.catalog && (
                    <button
                      type="button"
                      title={t('prescription_library.suggestions.details')}
                      aria-label={t('prescription_library.suggestions.details')}
                      onMouseDown={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        setDetailKey(suggestion.catalog!.key)
                      }}
                      className="flex-shrink-0 px-2.5 flex items-center text-navy/25 hover:text-pink transition-colors cursor-pointer bg-transparent border-none"
                    >
                      {icons.info}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
