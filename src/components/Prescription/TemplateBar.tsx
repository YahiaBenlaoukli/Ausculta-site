import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MedicineLine, PrescriptionTemplate } from '../../../types/doctor'

const icons = {
  bookmark: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  ),
  save: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  ),
  trash: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  chevron: (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
}

interface TemplateBarProps {
  userId: number | null | undefined
  /** Lines currently in the builder — what "save as template" captures. */
  currentMedicines: MedicineLine[]
  /** Applying a template hands its lines back for the parent to append. */
  onApply: (medicines: MedicineLine[], notes: string | null) => void
  disabled?: boolean
}

/**
 * Save / apply named sets of medicines, shown above a prescription builder.
 *
 * Applying COPIES the lines into the prescription rather than linking to the
 * template: editing a template later must never retroactively change what was
 * already prescribed to a patient.
 */
export default function TemplateBar({ userId, currentMedicines, onApply, disabled }: TemplateBarProps) {
  const { t } = useTranslation()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [templates, setTemplates] = useState<PrescriptionTemplate[]>([])
  const [listOpen, setListOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const result = await window.ipcRenderer.getPrescriptionTemplates(userId)
      setTemplates(result?.data ?? [])
    } catch (error) {
      console.error('getPrescriptionTemplates failed:', error)
    }
  }, [userId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!listOpen && !naming) return
    const onPointerDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setListOpen(false)
        setNaming(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [listOpen, naming])

  const saveableLines = currentMedicines.filter(m => m.medicineName?.trim())

  const handleSave = async () => {
    if (!userId || !name.trim() || !saveableLines.length) return
    setBusy(true)
    try {
      const result = await window.ipcRenderer.savePrescriptionTemplate(userId, name.trim(), saveableLines)
      if (result?.status !== 'success') {
        console.error('savePrescriptionTemplate failed:', result?.message)
        return
      }
      setName('')
      setNaming(false)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (template: PrescriptionTemplate) => {
    if (!window.confirm(t('prescription_library.templates.confirm_delete', { name: template.name }))) return
    try {
      await window.ipcRenderer.deletePrescriptionTemplate(template.id)
      await load()
    } catch (error) {
      console.error('deletePrescriptionTemplate failed:', error)
    }
  }

  /* Nothing saved and nothing to save — no reason to occupy the space. */
  if (!templates.length && !saveableLines.length) return null

  const nameCollides = templates.some(
    tpl => tpl.name.toLowerCase() === name.trim().toLowerCase()
  )

  return (
    <div ref={wrapperRef} className="relative flex flex-wrap items-center gap-2">
      {templates.length > 0 && (
        <div className="relative">
          <button
            type="button"
            disabled={disabled}
            onClick={() => { setListOpen(o => !o); setNaming(false) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-navy/[0.04] text-navy/70 hover:bg-navy/[0.08] hover:text-navy text-[11px] font-bold transition-colors cursor-pointer border-none disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {icons.bookmark}
            {t('prescription_library.templates.apply', { count: templates.length })}
            {icons.chevron}
          </button>

          {listOpen && (
            <div className="absolute z-30 top-full mt-1 start-0 w-[280px] max-h-[300px] overflow-y-auto bg-white rounded-xl border border-navy/10 shadow-[0_12px_32px_rgba(20,29,61,0.16)] py-1">
              {templates.map(template => (
                <div
                  key={template.id}
                  className="group flex items-center gap-1 px-1 hover:bg-navy/4 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => { onApply(template.medicines, template.notes); setListOpen(false) }}
                    className="flex-1 min-w-0 text-start px-2 py-2 bg-transparent border-none cursor-pointer"
                  >
                    <span className="block text-sm text-navy truncate">{template.name}</span>
                    <span className="block text-[11px] text-navy/45 truncate">
                      {template.medicines.map(m => m.medicineName).join(', ')}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(template)}
                    aria-label={t('prescription_library.templates.delete')}
                    title={t('prescription_library.templates.delete')}
                    className="flex-shrink-0 p-1.5 rounded-lg text-navy/20 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer bg-transparent border-none"
                  >
                    {icons.trash}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {saveableLines.length > 0 && !naming && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => { setNaming(true); setListOpen(false) }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-navy/[0.04] text-navy/70 hover:bg-navy/[0.08] hover:text-navy text-[11px] font-bold transition-colors cursor-pointer border-none disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {icons.save}
          {t('prescription_library.templates.save')}
        </button>
      )}

      {naming && (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); void handleSave() }
              if (e.key === 'Escape') { setNaming(false); setName('') }
            }}
            placeholder={t('prescription_library.templates.name_placeholder')}
            className="px-3 py-1.5 rounded-lg bg-white border border-navy/15 text-xs text-navy placeholder:text-navy/30 focus:outline-none focus:border-pink/50 min-w-[180px]"
          />
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!name.trim() || busy}
            className="px-3 py-1.5 rounded-lg bg-navy text-white text-[11px] font-bold transition-colors cursor-pointer border-none hover:bg-navy-light disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? t('prescription_library.templates.saving') : t('prescription_library.templates.confirm')}
          </button>
          {/* Re-saving under an existing name replaces it — say so before it happens. */}
          {nameCollides && (
            <span className="text-[10px] text-navy/45 max-w-[160px] leading-tight">
              {t('prescription_library.templates.will_replace')}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
