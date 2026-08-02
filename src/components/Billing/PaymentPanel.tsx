import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConsultationBalance, Payment, PaymentMethod } from '../../../types/payment'
import type { PrescriptionLanguage } from '../../../types/doctor'

const METHODS: PaymentMethod[] = ['cash', 'card', 'transfer', 'cheque', 'other']

const icons = {
  receipt: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2v20l3-2 3 2 3-2 3 2 3-2V2l-3 2-3-2-3 2-3-2z" />
      <path d="M8 9h8" /><path d="M8 13h6" />
    </svg>
  ),
  trash: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
}

interface PaymentPanelProps {
  consultationId: number | null | undefined
  userId: number | null | undefined
  defaultFee: number
  language?: PrescriptionLanguage
  /**
   * The visit's "settled" state, owned by the parent's Paid checkbox.
   *
   * Passed in rather than re-read from the database because the checkbox
   * autosaves on a debounce: reloading on every toggle would read the OLD
   * value and push it straight back, making the checkbox impossible to
   * uncheck. The parent's state is the immediate truth; the database catches up.
   */
  settled: boolean
  /**
   * The fee currently in the parent's field; null when it is empty, meaning
   * "bill at the practice default".
   *
   * Taken from the form rather than the database for the same reason as
   * `settled`: the field autosaves on a debounce, and the amounts here should
   * follow what the doctor is typing instead of lagging a save behind.
   */
  fee: number | null
  /** Fired only when a recorded payment changes settlement — never on reload. */
  onSettledChange?: (settled: boolean) => void
}

/**
 * Records part-payments against one visit and shows what is still owed.
 *
 * The consultation's own "paid" checkbox remains the settled flag; this panel
 * drives it from the payments actually recorded rather than replacing it.
 */
export default function PaymentPanel({
  consultationId, userId, defaultFee, language = 'fr', settled, fee, onSettledChange,
}: PaymentPanelProps) {
  const { t, i18n } = useTranslation()
  const [balance, setBalance] = useState<ConsultationBalance | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Reloads the amounts. Deliberately does NOT report settlement back to the
   * parent — that would overwrite a checkbox the user just clicked with the
   * not-yet-saved database value. Only pay()/removePayment() push upward.
   */
  const load = useCallback(async (): Promise<ConsultationBalance | null> => {
    if (!consultationId) return null
    try {
      const result = await window.ipcRenderer.getConsultationBalance(consultationId, defaultFee)
      if (result?.status === 'success' && result.data) {
        setBalance(result.data)
        return result.data
      }
    } catch (err) {
      console.error('getConsultationBalance failed:', err)
    }
    return null
  }, [consultationId, defaultFee])

  useEffect(() => { void load() }, [load])

  const money = useMemo(() => {
    const locale = i18n.language?.startsWith('en') ? 'en-GB' : 'fr-FR'
    return (value: number) => `${value.toLocaleString(locale)} ${t('billing.currency')}`
  }, [i18n.language, t])

  /** An empty fee field bills at the practice default, matching the backend. */
  const due = fee ?? defaultFee

  /**
   * What is still owed, derived from the visible checkbox and the visible fee
   * rather than the database. Rounded to cents so float drift cannot leave a
   * fraction of a dinar outstanding forever.
   */
  const outstandingOf = (b: ConsultationBalance) =>
    settled ? 0 : Math.max(0, Math.round((due - b.paid) * 100) / 100)

  const pay = async (full: boolean) => {
    if (!consultationId || !balance) return
    const value = full ? outstandingOf(balance) : Number(amount.replace(',', '.'))
    if (!Number.isFinite(value) || value <= 0) {
      setError(t('billing.errors.invalid_amount'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await window.ipcRenderer.recordPayment(
        { consultationId, amount: value, method }, userId ?? null, defaultFee
      )
      if (result?.status !== 'success') {
        setError(t('billing.errors.record_failed'))
        return
      }
      setAmount('')
      // Recording money is an explicit act, so pushing settlement upward here
      // is safe — unlike doing it on every reload.
      const fresh = await load()
      if (fresh) onSettledChange?.(fresh.settled)
    } catch (err) {
      console.error('recordPayment failed:', err)
      setError(t('billing.errors.record_failed'))
    } finally {
      setBusy(false)
    }
  }

  const removePayment = async (payment: Payment) => {
    if (!window.confirm(t('billing.confirm_delete', { receipt: payment.receiptNumber, amount: money(payment.amount) }))) return
    try {
      const result = await window.ipcRenderer.deletePayment(payment.id, defaultFee)
      if (result?.status !== 'success' && result?.status !== 'not_found') {
        setError(t('billing.errors.delete_failed'))
        return
      }
      setError(null)
      const fresh = await load()
      if (fresh) onSettledChange?.(fresh.settled)
    } catch (err) {
      console.error('deletePayment failed:', err)
      setError(t('billing.errors.delete_failed'))
    }
  }

  const printReceipt = async (payment: Payment) => {
    try {
      const result = await window.ipcRenderer.generateReceiptPdf(payment.id, language, defaultFee)
      if (result?.status === 'success' && result.data?.documentPath) {
        await window.ipcRenderer.openDocument(result.data.documentPath)
        return
      }
      setError(
        result?.message === 'unsupported_characters'
          ? t('billing.errors.unsupported_characters', { characters: (result.characters ?? []).join(' ') })
          : t('billing.errors.receipt_failed')
      )
    } catch (err) {
      console.error('generateReceiptPdf failed:', err)
      setError(t('billing.errors.receipt_failed'))
    }
  }

  if (!consultationId || !balance) return null

  const outstanding = outstandingOf(balance)

  // A brand-new visit arrives pre-ticked (consultations.is_paid defaults to 1)
  // with nothing collected. Announcing "fully settled" there is nonsense, so
  // distinguish "settled because money came in" from "ticked, nothing recorded".
  const settledByPayments = settled && balance.paid > 0
  const settledWithoutPayments = settled && balance.paid === 0 && due > 0

  const inputClass = 'w-full px-3 py-2 rounded-xl bg-white border border-navy/12 text-sm text-navy placeholder:text-navy/30 focus:outline-none focus:border-pink/50 transition-colors'

  return (
    <div className="space-y-3">
      {/* Due / paid / outstanding at a glance */}
      <div className="grid grid-cols-3 gap-2">
        {([
          ['due', due, 'text-navy'],
          ['paid', balance.paid, 'text-emerald-600'],
          ['balance', outstanding, outstanding > 0 ? 'text-red-500' : 'text-navy/35'],
        ] as const).map(([key, value, tone]) => (
          <div key={key} className="rounded-xl bg-navy/[0.03] border border-navy/[0.05] px-3 py-2">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.6px] text-navy/40">
              {t(`billing.${key}`)}
            </span>
            <span className={`block text-sm font-bold tabular-nums ${tone}`}>{money(value)}</span>
          </div>
        ))}
      </div>

      {settledByPayments && (
        <p className="text-[11px] font-semibold text-emerald-600">{t('billing.settled')}</p>
      )}

      {settledWithoutPayments && (
        <p className="text-[11px] text-navy/45">{t('billing.settled_no_payment')}</p>
      )}

      {!settled && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[110px]">
            <span className="block text-xs font-semibold text-navy/50 mb-1.5">{t('billing.amount')}</span>
            <input
              id="payment-amount"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void pay(false) } }}
              inputMode="decimal"
              placeholder={String(outstanding)}
              className={inputClass}
            />
          </label>
          <label className="min-w-[120px]">
            <span className="block text-xs font-semibold text-navy/50 mb-1.5">{t('billing.method')}</span>
            <select value={method} onChange={e => setMethod(e.target.value as PaymentMethod)} className={inputClass}>
              {METHODS.map(m => <option key={m} value={m}>{t(`billing.methods.${m}`)}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void pay(false)}
            disabled={busy || !amount.trim()}
            className="px-4 py-2 rounded-xl bg-navy text-white text-xs font-bold transition-colors cursor-pointer border-none hover:bg-navy-light disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('billing.actions.record')}
          </button>
          {outstanding > 0 && (
            <button
              type="button"
              onClick={() => void pay(true)}
              disabled={busy}
              className="px-3 py-2 rounded-xl bg-navy/[0.04] text-navy/70 hover:bg-navy/[0.09] hover:text-navy text-xs font-bold transition-colors cursor-pointer border-none disabled:opacity-40"
            >
              {t('billing.actions.pay_full', { amount: money(outstanding) })}
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
      )}

      {balance.payments.length > 0 && (
        <div className="space-y-1.5">
          {balance.payments.map(payment => (
            <div key={payment.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-navy/[0.02] border border-navy/[0.05]">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-navy tabular-nums">{money(payment.amount)}</span>
                <span className="block text-[11px] text-navy/45 truncate">
                  {t(`billing.methods.${payment.method}`)} · {t('billing.receipt_no', { number: payment.receiptNumber })}
                </span>
              </div>
              <div className="flex-shrink-0 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void printReceipt(payment)}
                  title={t('billing.actions.receipt')}
                  aria-label={t('billing.actions.receipt')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-navy/[0.04] text-navy/70 hover:bg-navy/[0.09] hover:text-navy text-[11px] font-bold transition-colors cursor-pointer border-none"
                >
                  {icons.receipt}{t('billing.actions.receipt')}
                </button>
                <button
                  type="button"
                  onClick={() => void removePayment(payment)}
                  title={t('billing.actions.delete')}
                  aria-label={t('billing.actions.delete')}
                  className="p-1.5 rounded-lg text-navy/20 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer bg-transparent border-none"
                >
                  {icons.trash}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
