import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Certificate, CertificateType } from '../../../types/certificate'
import type { PrescriptionLanguage } from '../../../types/doctor'

const CERTIFICATE_TYPES: CertificateType[] = ['work_leave', 'fitness', 'presence', 'free']

const trashIcon = (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)

/** Inclusive: the 1st to the 1st is one day off, not zero. Mirrors countLeaveDays. */
function countDays(startDate: string, endDate: string): number | null {
  if (!startDate || !endDate) return null
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  return days > 0 ? days : null
}

const todayKey = () => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

interface CertificateFormProps {
  userId: number | null | undefined
  patientId: number | null | undefined
  consultationId?: number | null
  /** Preferred PDF language, usually the doctor's prescription-language setting. */
  language?: PrescriptionLanguage
  /** Read-only once the visit is closed. */
  disabled?: boolean
}

/**
 * Issues medical certificates on the doctor's letterhead.
 *
 * The body is pre-filled from the chosen type and dates but stays editable —
 * and it is the edited text that gets stored and printed, so a reprint years
 * later reproduces exactly what the patient was handed.
 */
export default function CertificateForm({
  userId, patientId, consultationId, language = 'fr', disabled,
}: CertificateFormProps) {
  const { t } = useTranslation()

  const [type, setType] = useState<CertificateType>('work_leave')
  const [startDate, setStartDate] = useState(todayKey())
  const [endDate, setEndDate] = useState(todayKey())
  const [body, setBody] = useState('')
  const [bodyTouched, setBodyTouched] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<Certificate[]>([])

  const days = useMemo(() => countDays(startDate, endDate), [startDate, endDate])

  const load = useCallback(async () => {
    if (!consultationId) return
    try {
      const result = await window.ipcRenderer.getCertificatesByConsultationId(consultationId)
      setIssued(result?.data ?? [])
    } catch (err) {
      console.error('getCertificatesByConsultationId failed:', err)
    }
  }, [consultationId])

  useEffect(() => { void load() }, [load])

  /* Suggested wording follows the type and dates until the doctor edits it —
     after that their text wins and we never overwrite it. */
  const suggestedBody = useMemo(() => {
    const fmt = (iso: string) => {
      const date = new Date(`${iso}T00:00:00`)
      return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(language === 'en' ? 'en-GB' : 'fr-FR')
    }
    if (type === 'work_leave') {
      return t('certificates.body.work_leave', {
        days: days ?? 0, start: fmt(startDate), end: fmt(endDate),
      })
    }
    return t(`certificates.body.${type}`, { date: fmt(todayKey()) })
  }, [type, days, startDate, endDate, language, t])

  useEffect(() => {
    if (!bodyTouched) setBody(suggestedBody)
  }, [suggestedBody, bodyTouched])

  const reset = () => {
    setBody('')
    setBodyTouched(false)
    setError(null)
  }

  const issue = async () => {
    if (!userId || !patientId || !body.trim()) return
    setIssuing(true)
    setError(null)
    try {
      const result = await window.ipcRenderer.createCertificate(userId, {
        patientId,
        consultationId: consultationId ?? null,
        type,
        startDate: type === 'work_leave' ? startDate : null,
        endDate: type === 'work_leave' ? endDate : null,
        body: body.trim(),
        language,
      })

      if (result?.status !== 'success') {
        // The PDF font is Latin-only; name the characters rather than failing vaguely.
        setError(
          result?.message === 'unsupported_characters'
            ? t('certificates.errors.unsupported_characters', { characters: (result.characters ?? []).join(' ') })
            : t('certificates.errors.issue_failed')
        )
        return
      }

      reset()
      await load()
      if (result.data?.documentPath) await window.ipcRenderer.openDocument(result.data.documentPath)
    } catch (err) {
      console.error('createCertificate failed:', err)
      setError(t('certificates.errors.issue_failed'))
    } finally {
      setIssuing(false)
    }
  }

  /**
   * Removes the certificate from the record. The generated PDF deliberately
   * stays in the patient's documents — it may already be in the patient's
   * hands — so the confirmation says so rather than implying a clean undo.
   */
  const remove = async (certificate: Certificate) => {
    const confirmed = window.confirm(t('certificates.confirm_delete', {
      type: t(`certificates.types.${certificate.type}`),
      serial: certificate.serial,
    }))
    if (!confirmed) return

    try {
      const result = await window.ipcRenderer.deleteCertificate(certificate.id)
      if (result?.status !== 'success' && result?.status !== 'not_found') {
        setError(t('certificates.errors.delete_failed'))
        return
      }
      setError(null)
      await load()
    } catch (err) {
      console.error('deleteCertificate failed:', err)
      setError(t('certificates.errors.delete_failed'))
    }
  }

  const reprint = async (certificate: Certificate) => {
    try {
      const result = await window.ipcRenderer.reprintCertificate(certificate.id)
      if (result?.status === 'success' && result.data?.documentPath) {
        await window.ipcRenderer.openDocument(result.data.documentPath)
      }
    } catch (err) {
      console.error('reprintCertificate failed:', err)
    }
  }

  const inputClass = 'w-full px-3 py-2 rounded-xl bg-white border border-navy/12 text-sm text-navy placeholder:text-navy/30 focus:outline-none focus:border-pink/50 transition-colors'

  return (
    <div className="space-y-3">
      {!disabled && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {CERTIFICATE_TYPES.map(option => (
              <button
                key={option}
                type="button"
                onClick={() => { setType(option); setBodyTouched(false) }}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer border-none
                  ${type === option ? 'bg-navy text-white' : 'bg-navy/[0.04] text-navy/60 hover:bg-navy/[0.09] hover:text-navy'}`}
              >
                {t(`certificates.types.${option}`)}
              </button>
            ))}
          </div>

          {type === 'work_leave' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 items-end">
              <label className="block">
                <span className="block text-xs font-semibold text-navy/50 mb-1.5">{t('certificates.fields.start')}</span>
                <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setBodyTouched(false) }} className={inputClass} />
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-navy/50 mb-1.5">{t('certificates.fields.end')}</span>
                <input type="date" value={endDate} min={startDate} onChange={e => { setEndDate(e.target.value); setBodyTouched(false) }} className={inputClass} />
              </label>
              <p className={`text-xs pb-2.5 ${days ? 'text-navy/55' : 'text-red-500'}`}>
                {days ? t('certificates.fields.days', { count: days }) : t('certificates.fields.invalid_range')}
              </p>
            </div>
          )}

          <label className="block">
            <span className="block text-xs font-semibold text-navy/50 mb-1.5">{t('certificates.fields.body')}</span>
            <textarea
              value={body}
              onChange={e => { setBody(e.target.value); setBodyTouched(true) }}
              rows={4}
              placeholder={t('certificates.fields.body_placeholder')}
              className={`${inputClass} resize-y leading-relaxed`}
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void issue()}
              disabled={issuing || !body.trim() || !patientId || (type === 'work_leave' && !days)}
              className="px-4 py-2 rounded-xl bg-navy text-white text-xs font-bold transition-colors cursor-pointer border-none hover:bg-navy-light disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {issuing ? t('certificates.actions.issuing') : t('certificates.actions.issue')}
            </button>
            {bodyTouched && (
              <button
                type="button"
                onClick={() => setBodyTouched(false)}
                className="px-3 py-2 rounded-xl bg-transparent text-navy/45 hover:text-navy text-xs font-semibold transition-colors cursor-pointer border-none"
              >
                {t('certificates.actions.reset_wording')}
              </button>
            )}
          </div>
        </>
      )}

      {/* Outside the !disabled block: deleting is still possible on a closed
          visit, so its failures must be able to surface there too. */}
      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
      )}

      {issued.length > 0 && (
        <div className="space-y-2 pt-1">
          {issued.map(certificate => (
            <div key={certificate.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-navy/[0.02] border border-navy/[0.05]">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-navy">
                  {t(`certificates.types.${certificate.type}`)}
                </span>
                <span className="block text-[11px] text-navy/45 truncate">
                  {t('certificates.serial', { serial: certificate.serial })}
                  {certificate.days ? ` · ${t('certificates.fields.days', { count: certificate.days })}` : ''}
                </span>
              </div>
              <div className="flex-shrink-0 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void reprint(certificate)}
                  className="px-3 py-1.5 rounded-lg bg-navy/[0.04] text-navy/70 hover:bg-navy/[0.09] hover:text-navy text-[11px] font-bold transition-colors cursor-pointer border-none"
                >
                  {t('certificates.actions.reprint')}
                </button>
                {/* Allowed even on a closed visit: noticing a mistaken
                    certificate after finishing is exactly when it happens. */}
                <button
                  type="button"
                  onClick={() => void remove(certificate)}
                  aria-label={t('certificates.actions.delete')}
                  title={t('certificates.actions.delete')}
                  className="p-1.5 rounded-lg text-navy/20 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer bg-transparent border-none"
                >
                  {trashIcon}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {disabled && !issued.length && (
        <p className="text-xs text-navy/40">{t('certificates.empty')}</p>
      )}
    </div>
  )
}
