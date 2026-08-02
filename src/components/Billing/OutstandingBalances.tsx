import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { PatientBalance } from '../../../types/payment'

interface OutstandingBalancesProps {
  /** Resolves visits stored with a NULL fee. Comes from the page's price input. */
  defaultFee: number
}

/**
 * Everyone who currently owes the practice money.
 *
 * Deliberately NOT filtered by the page's date range: a debt is a running
 * total, not an event in a period. A visit from March that is still unpaid
 * belongs on this list in August — which is exactly what the date-scoped
 * "unpaid" metric elsewhere on this page cannot tell you.
 */
export default function OutstandingBalances({ defaultFee }: OutstandingBalancesProps) {
  const { t, i18n } = useTranslation()
  const [patients, setPatients] = useState<PatientBalance[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.ipcRenderer.getOutstandingBalances(defaultFee)
      if (result?.status === 'success' && result.data) {
        setPatients(result.data.patients)
        setTotal(result.data.totalOutstanding)
      }
    } catch (error) {
      console.error('getOutstandingBalances failed:', error)
    } finally {
      setLoading(false)
    }
  }, [defaultFee])

  useEffect(() => { void load() }, [load])

  const locale = i18n.language?.startsWith('en') ? 'en-GB' : 'fr-FR'
  const money = useMemo(
    () => (value: number) => `${value.toLocaleString(locale)} ${t('billing.currency')}`,
    [locale, t]
  )

  /** Whole days since the oldest unsettled visit — how stale the debt is. */
  const ageInDays = (iso: string) => {
    const then = new Date(iso)
    if (Number.isNaN(then.getTime())) return 0
    return Math.max(0, Math.floor((Date.now() - then.getTime()) / 86_400_000))
  }

  return (
    <div className="bg-white rounded-3xl p-6 border border-white/40 shadow-[0_4px_20px_rgba(30,42,86,0.03)]">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-[#1E2A56]">{t('billing.outstanding.title')}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{t('billing.outstanding.subtitle')}</p>
        </div>
        {total > 0 && (
          <span className="flex-shrink-0 px-3 py-1 bg-red-50 border border-red-100 text-red-600 rounded-full text-xs font-bold tabular-nums">
            {money(total)}
          </span>
        )}
      </div>

      {loading && <p className="text-sm text-gray-400 py-6 text-center">{t('billing.outstanding.loading')}</p>}

      {!loading && !patients.length && (
        <p className="text-sm text-gray-400 py-6 text-center">{t('billing.outstanding.empty')}</p>
      )}

      {!loading && patients.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">{t('billing.outstanding.patient')}</th>
                <th className="py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">{t('billing.outstanding.phone')}</th>
                <th className="py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider text-center">{t('billing.outstanding.visits')}</th>
                <th className="py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider text-center">{t('billing.outstanding.oldest')}</th>
                <th className="py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider text-end">{t('billing.outstanding.balance')}</th>
              </tr>
            </thead>
            <tbody>
              {patients.map(entry => {
                const days = ageInDays(entry.oldestUnpaid)
                const isOpen = expanded === entry.patientId
                return [
                  <tr
                    key={entry.patientId}
                    onClick={() => setExpanded(isOpen ? null : entry.patientId)}
                    className="border-b border-gray-50 hover:bg-gray-50/60 cursor-pointer transition-colors"
                  >
                    <td className="py-3">
                      <Link
                        to={`/patients/${entry.patientId}`}
                        onClick={e => e.stopPropagation()}
                        className="text-sm font-semibold text-[#1E2A56] hover:text-pink no-underline"
                      >
                        {entry.patientName}
                      </Link>
                    </td>
                    <td className="py-3 text-sm text-gray-500">{entry.patientPhone || '—'}</td>
                    <td className="py-3 text-sm text-gray-500 text-center tabular-nums">{entry.visits.length}</td>
                    <td className="py-3 text-center">
                      {/* Past ~60 days the debt is unlikely to be collected on
                          its own, so flag it rather than just printing a number. */}
                      <span className={`text-xs font-semibold tabular-nums ${days > 60 ? 'text-red-500' : 'text-gray-500'}`}>
                        {t('billing.outstanding.days_ago', { count: days })}
                      </span>
                    </td>
                    <td className="py-3 text-end text-sm font-bold text-red-500 tabular-nums">
                      {money(entry.totalBalance)}
                    </td>
                  </tr>,

                  isOpen && (
                    <tr key={`${entry.patientId}-detail`} className="bg-gray-50/40">
                      <td colSpan={5} className="py-2 px-3">
                        <div className="space-y-1">
                          {entry.visits.map(visit => (
                            <div key={visit.consultationId} className="flex items-center justify-between gap-3 text-xs">
                              <Link
                                to={`/consultation/${visit.consultationId}`}
                                className="text-[#1E2A56]/70 hover:text-pink no-underline"
                              >
                                {new Date(visit.consultationDatetime).toLocaleDateString(locale, {
                                  day: '2-digit', month: 'short', year: 'numeric',
                                })}
                              </Link>
                              <span className="text-gray-400 tabular-nums">
                                {t('billing.outstanding.of_which', {
                                  due: money(visit.due), paid: money(visit.paid),
                                })}
                              </span>
                              <span className="font-bold text-red-500 tabular-nums">{money(visit.balance)}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
