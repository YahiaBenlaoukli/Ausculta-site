import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MedicineLine, MedicineSuggestion } from '../../../types/doctor'

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

/**
 * Medicine name field backed by the doctor's own prescribing history.
 *
 * Focusing it with nothing typed shows their most-prescribed drugs; typing
 * filters that list. Picking an entry fills the whole medicine row, which is
 * where the typing is actually saved — a doctor reaches for the same thirty
 * drugs with the same posology forever.
 */
export default function MedicineNameInput({
  value, onChange, onPick, onSubmit, placeholder, className, disabled,
}: MedicineNameInputProps) {
  const { t } = useTranslation()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [suggestions, setSuggestions] = useState<MedicineSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

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

  /* Close when focus or the pointer leaves the field entirely. */
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const pick = (suggestion: MedicineSuggestion) => {
    // Mark the incoming value as already-queried so the effect above does not
    // fire a fresh search and pop the list open again.
    queriedFor.current = suggestion.medicineName
    setOpen(false)
    setActiveIndex(-1)
    onPick({
      medicineName: suggestion.medicineName,
      dosage: suggestion.dosage,
      frequency: suggestion.frequency,
      duration: suggestion.duration,
      quantity: suggestion.quantity,
    })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
      return
    }
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
      />

      {open && suggestions.length > 0 && (
        <div className="absolute z-30 top-full mt-1 w-full min-w-[240px] max-h-[260px] overflow-y-auto bg-white rounded-xl border border-navy/10 shadow-[0_12px_32px_rgba(20,29,61,0.16)] py-1">
          {!value.trim() && (
            <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-[1px] text-navy/35">
              {t('prescription_library.suggestions.frequent')}
            </div>
          )}
          {suggestions.map((suggestion, index) => {
            const posology = posologyOf(suggestion)
            return (
              <button
                key={suggestion.medicineName}
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                // mousedown, not click: the input's blur would otherwise close
                // the list before the click ever lands.
                onMouseDown={e => { e.preventDefault(); pick(suggestion) }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-start cursor-pointer border-none transition-colors
                  ${index === activeIndex ? 'bg-pink/8' : 'bg-transparent hover:bg-navy/4'}`}
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-navy truncate">{suggestion.medicineName}</span>
                  {posology && (
                    <span className="block text-[11px] text-navy/45 truncate">{posology}</span>
                  )}
                </span>
                <span className="flex-shrink-0 text-[10px] font-semibold text-navy/35 tabular-nums">
                  {t('prescription_library.suggestions.uses', { count: suggestion.uses })}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
