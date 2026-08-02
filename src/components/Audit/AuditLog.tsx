import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuditAction, AuditEntry } from '../../../types/audit'

const PAGE_SIZE = 25

/**
 * Grouped for the filter dropdown. The order here is the order shown, and every
 * action the backend can write must appear in exactly one group — an action
 * missing from this list would be invisible in the filter while still being
 * logged, which is worse than not filtering at all.
 */
const ACTION_GROUPS: { key: string; actions: AuditAction[] }[] = [
  { key: 'patients', actions: ['patient.create', 'patient.update', 'patient.delete'] },
  { key: 'consultations', actions: ['consultation.complete', 'consultation.delete'] },
  { key: 'prescriptions', actions: ['prescription.create', 'prescription.delete'] },
  { key: 'documents', actions: ['document.upload', 'document.delete'] },
  { key: 'certificates', actions: ['certificate.create', 'certificate.delete'] },
  { key: 'payments', actions: ['payment.record', 'payment.delete'] },
  { key: 'access', actions: ['auth.login', 'auth.login_failed', 'auth.logout', 'database.reset'] },
]

/** Destructive actions are tinted so a deletion is findable by eye. */
const DESTRUCTIVE = new Set<AuditAction>([
  'patient.delete', 'consultation.delete', 'prescription.delete',
  'document.delete', 'certificate.delete', 'payment.delete',
  'database.reset', 'auth.login_failed',
])

export default function AuditLog() {
  const { t, i18n } = useTranslation()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [group, setGroup] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const actions = useMemo(
    () => (group === 'all' ? undefined : ACTION_GROUPS.find(g => g.key === group)?.actions),
    [group]
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.ipcRenderer.getAuditLog({
        actions,
        search: search.trim() || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      if (result?.status === 'success' && result.data) {
        setEntries(result.data.entries)
        setTotal(result.data.total)
      }
    } catch (error) {
      console.error('getAuditLog failed:', error)
    } finally {
      setLoading(false)
    }
  }, [actions, search, page])

  // Debounced so typing in the search box does not fire a query per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => { void load() }, 200)
    return () => clearTimeout(timer)
  }, [load])

  // Filter changes invalidate the current page number.
  useEffect(() => { setPage(0) }, [group, search])

  const locale = i18n.language?.startsWith('en') ? 'en-GB' : i18n.language?.startsWith('ar') ? 'ar' : 'fr-FR'
  const formatWhen = (at: string) => {
    // SQLite CURRENT_TIMESTAMP is 'YYYY-MM-DD HH:MM:SS' in UTC with no zone
    // marker; without the T and Z it would be read as local and shown hours off.
    const iso = at.includes('T') ? at : `${at.replace(' ', 'T')}Z`
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return at
    return date.toLocaleString(locale, {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  const pages = Math.ceil(total / PAGE_SIZE)
  const inputClass = 'px-3 py-2 rounded-xl bg-white border border-navy/12 text-sm text-navy placeholder:text-navy/30 focus:outline-none focus:border-pink/50 transition-colors'

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-navy">{t('audit.title')}</h3>
        <p className="text-xs text-navy/45 mt-0.5">{t('audit.subtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select value={group} onChange={e => setGroup(e.target.value)} className={inputClass}>
          <option value="all">{t('audit.filters.all')}</option>
          {ACTION_GROUPS.map(g => (
            <option key={g.key} value={g.key}>{t(`audit.groups.${g.key}`)}</option>
          ))}
        </select>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('audit.filters.search_placeholder')}
          className={`${inputClass} flex-1 min-w-[200px]`}
        />
      </div>

      {loading && <p className="text-sm text-navy/40 py-6 text-center">{t('audit.loading')}</p>}

      {!loading && !entries.length && (
        <p className="text-sm text-navy/40 py-8 text-center">{t('audit.empty')}</p>
      )}

      {!loading && entries.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-start border-collapse">
              <thead>
                <tr className="border-b border-navy/8">
                  <th className="py-2.5 text-[11px] font-bold text-navy/40 uppercase tracking-wider text-start">{t('audit.table.when')}</th>
                  <th className="py-2.5 text-[11px] font-bold text-navy/40 uppercase tracking-wider text-start">{t('audit.table.who')}</th>
                  <th className="py-2.5 text-[11px] font-bold text-navy/40 uppercase tracking-wider text-start">{t('audit.table.action')}</th>
                  <th className="py-2.5 text-[11px] font-bold text-navy/40 uppercase tracking-wider text-start">{t('audit.table.detail')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <tr key={entry.id} className="border-b border-navy/5 hover:bg-navy/[0.02] transition-colors">
                    <td className="py-2.5 text-xs text-navy/50 whitespace-nowrap tabular-nums">{formatWhen(entry.at)}</td>
                    <td className="py-2.5 text-xs text-navy/70">{entry.actorName}</td>
                    <td className="py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold
                        ${DESTRUCTIVE.has(entry.action) ? 'bg-red-50 text-red-600' : 'bg-navy/[0.05] text-navy/60'}`}>
                        {t(`audit.actions.${entry.action}`)}
                      </span>
                    </td>
                    <td className="py-2.5 text-xs text-navy/60 max-w-[320px] truncate" title={entry.summary ?? ''}>
                      {entry.summary || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-navy/40">
                {t('audit.pagination', { current: page + 1, total: pages, count: total })}
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 rounded-lg bg-navy/[0.04] text-navy/70 hover:bg-navy/[0.09] text-[11px] font-bold cursor-pointer border-none disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {t('audit.prev')}
                </button>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
                  disabled={page >= pages - 1}
                  className="px-3 py-1.5 rounded-lg bg-navy/[0.04] text-navy/70 hover:bg-navy/[0.09] text-[11px] font-bold cursor-pointer border-none disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {t('audit.next')}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Says plainly what this record is and is not, so nobody mistakes it
          for tamper-proof evidence. */}
      <p className="text-[11px] text-navy/35 leading-relaxed border-t border-navy/[0.06] pt-3">
        {t('audit.disclaimer')}
      </p>
    </div>
  )
}
