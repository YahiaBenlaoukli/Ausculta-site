import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PrintJob } from '../../../types/print';

/**
 * What the front desk still has to print, and what it has printed.
 *
 * Polls rather than listening for a push. A poll self-heals: a seat that was
 * asleep, or briefly off the network, picks up the whole backlog on its next
 * tick, whereas a live connection needs a reconnect-and-catch-up path that IS
 * this loop, written twice. And the latency that matters is how long the
 * patient takes to walk from the consulting room to the desk.
 *
 * Both roles see it. For the desk it is a work list; for the doctor it is the
 * confirmation that the prescription they sent actually came out, which is the
 * half of this feature that is easy to leave out and immediately missed.
 */

const POLL_MS = 5_000;

export default function PrintQueuePanel() {
    const { t } = useTranslation();
    const [pending, setPending] = useState<PrintJob[]>([]);
    const [recent, setRecent] = useState<PrintJob[]>([]);
    const [open, setOpen] = useState(false);
    const [busyId, setBusyId] = useState<number | null>(null);
    const [error, setError] = useState('');
    const [linked, setLinked] = useState(false);
    // Kept in a ref so the interval never restarts just because a poll landed.
    const pollingRef = useRef(false);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const config = await window.ipcRenderer.getNetworkConfig();
                // On a standalone install nobody is at the other end, so this
                // would be a database query every five seconds forever.
                if (alive) setLinked(config?.mode === 'host' || config?.mode === 'client');
            } catch {
                if (alive) setLinked(false);
            }
        })();
        return () => { alive = false; };
    }, []);

    const refresh = useCallback(async () => {
        if (pollingRef.current) return;
        pollingRef.current = true;
        try {
            const result = await window.ipcRenderer.getPrintQueue();
            if (result?.status === 'success' && result.data) {
                setPending(result.data.pending);
                setRecent(result.data.recent);
            }
        } catch {
            // The host banner already says the link is down; a second, quieter
            // complaint down here would only be noise.
        } finally {
            pollingRef.current = false;
        }
    }, []);

    useEffect(() => {
        if (!linked) return;
        void refresh();
        const timer = setInterval(() => void refresh(), POLL_MS);
        return () => clearInterval(timer);
    }, [linked, refresh]);

    const print = async (job: PrintJob) => {
        setBusyId(job.id);
        setError('');
        try {
            const result = await window.ipcRenderer.printDocument(job.documentPath);
            if (result?.status !== 'success') {
                setError(result?.message || t('print.errors.print'));
                return;
            }
            // Marked only after the print actually succeeded — a job that
            // silently vanished from the queue without paper coming out is the
            // one failure this feature must not have.
            await window.ipcRenderer.markPrintJobPrinted(job.id);
            await refresh();
        } catch {
            setError(t('print.errors.print'));
        } finally {
            setBusyId(null);
        }
    };

    const cancel = async (job: PrintJob) => {
        setBusyId(job.id);
        try {
            await window.ipcRenderer.cancelPrintJob(job.id);
            await refresh();
        } finally {
            setBusyId(null);
        }
    };

    if (!linked || (pending.length === 0 && recent.length === 0)) return null;

    return (
        <div className="fixed bottom-5 end-5 z-[90] w-[340px] max-w-[calc(100vw-2.5rem)]">
            <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(30,42,86,0.14)] border border-navy/[0.06] overflow-hidden">
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    aria-expanded={open}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-navy/[0.02] transition-colors cursor-pointer text-start"
                >
                    <span className={`relative flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0 ${pending.length ? 'bg-pink/[0.1] text-pink' : 'bg-navy/[0.05] text-navy/40'}`}>
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 6 2 18 2 18 9" />
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                            <rect x="6" y="14" width="12" height="8" />
                        </svg>
                    </span>
                    <span className="flex-1 min-w-0">
                        <span className="block text-sm font-bold text-navy">{t('print.queue_title')}</span>
                        <span className="block text-[11px] text-navy/45">
                            {pending.length > 0 ? t('print.pending_count', { count: pending.length }) : t('print.nothing_pending')}
                        </span>
                    </span>
                    {pending.length > 0 && (
                        <span className="flex-shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full bg-pink text-white text-[11px] font-bold flex items-center justify-center">
                            {pending.length}
                        </span>
                    )}
                    <svg className={`w-4 h-4 flex-shrink-0 text-navy/30 transition-transform ${open ? '' : 'rotate-180'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9" />
                    </svg>
                </button>

                {open && (
                    <div className="border-t border-navy/[0.06] max-h-[50vh] overflow-y-auto">
                        {error && (
                            <p className="m-3 px-3 py-2 rounded-xl bg-pink/[0.06] border border-pink/15 text-[11px] text-pink-dark">
                                {error}
                            </p>
                        )}

                        {pending.map((job) => (
                            <div key={job.id} className="flex items-center gap-3 px-4 py-3 border-b border-navy/[0.04] last:border-b-0">
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs font-bold text-navy truncate">{job.patientName}</p>
                                    <p className="text-[11px] text-navy/45 truncate">
                                        {t(`print.categories.${job.fileCategory}`, { defaultValue: job.fileCategory })}
                                        {job.requestedByName ? ` · ${job.requestedByName}` : ''}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => print(job)}
                                    disabled={busyId === job.id}
                                    className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-pink hover:bg-pink-dark text-white text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50 select-none"
                                >
                                    {busyId === job.id ? t('print.printing') : t('print.print')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => cancel(job)}
                                    disabled={busyId === job.id}
                                    aria-label={t('print.cancel')}
                                    title={t('print.cancel')}
                                    className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-navy/30 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            </div>
                        ))}

                        {recent.length > 0 && (
                            <div className="px-4 py-2 bg-navy/[0.02] text-[10px] font-bold uppercase tracking-wider text-navy/35">
                                {t('print.recent')}
                            </div>
                        )}
                        {recent.map((job) => (
                            <div key={job.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-navy/[0.04] last:border-b-0">
                                <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${job.status === 'printed' ? 'bg-emerald-500' : 'bg-navy/20'}`} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-semibold text-navy/70 truncate">{job.patientName}</p>
                                    <p className="text-[10px] text-navy/35 truncate">
                                        {job.status === 'printed'
                                            ? t('print.printed_by', { name: job.printedByName ?? '—' })
                                            : t('print.cancelled')}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
