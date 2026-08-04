import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { UpdateStatus } from '../../../types/update';

/**
 * Update notice.
 *
 * Sits in the top corner, opposite the trial pill so the two never collide,
 * and follows the same card language as the rest of the app.
 *
 * It is silent by design. Nothing appears while checking, when already up to
 * date, or when the check failed — a clinic with no internet must never see an
 * error it can do nothing about. The card only shows up when there is a
 * decision for the doctor to make, and it can always be dismissed.
 */
export default function UpdateNotice() {
    const { t } = useTranslation();
    const [update, setUpdate] = useState<UpdateStatus | null>(null);
    const [dismissed, setDismissed] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            setUpdate(await window.ipcRenderer.getUpdateStatus());
        } catch {
            // The updater is unavailable; stay silent rather than alarm anyone.
        }
    }, []);

    useEffect(() => {
        refresh();
        // The main process pushes every phase change (progress included). The
        // bridge types payloads as unknown[], so narrow at the boundary.
        const onStatus = (_event: unknown, ...args: unknown[]) =>
            setUpdate(args[0] as UpdateStatus);
        window.ipcRenderer.on('update-status', onStatus);
        return () => window.ipcRenderer.off('update-status', onStatus);
    }, [refresh]);

    if (!update) return null;

    const { phase, newVersion, percent } = update;

    // Only these three phases are worth interrupting for.
    const visible = phase === 'available' || phase === 'downloading' || phase === 'ready';
    if (!visible) return null;

    // Dismissing hides this version until the app restarts or a newer one ships.
    if (phase === 'available' && dismissed === newVersion) return null;

    return (
        <div className="fixed top-5 end-5 z-[90] w-[320px]" style={{ animation: 'scaleIn 0.3s ease-out both' }}>
            <div className="bg-white rounded-2xl p-5 shadow-[0_4px_24px_rgba(30,42,86,0.12)] border border-navy/[0.04]">
                <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-pink/[0.08] flex items-center justify-center flex-shrink-0">
                        <svg className="w-4.5 h-4.5 text-pink" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                            <polyline points="21 3 21 9 15 9" />
                        </svg>
                    </div>

                    <div className="min-w-0 flex-1">
                        <h2 className="text-sm font-bold text-navy leading-tight">
                            {phase === 'ready' ? t('update.ready_title') : t('update.available_title')}
                        </h2>
                        <p className="text-xs text-navy/45 mt-1 leading-relaxed">
                            {phase === 'ready'
                                ? t('update.ready_body')
                                : phase === 'downloading'
                                    ? t('update.downloading_body')
                                    : t('update.available_body', { version: newVersion })}
                        </p>
                    </div>

                    {phase !== 'downloading' && (
                        <button
                            type="button"
                            onClick={() => setDismissed(newVersion ?? null)}
                            aria-label={t('update.dismiss')}
                            className="text-navy/25 hover:text-navy/60 transition-colors cursor-pointer flex-shrink-0"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                        </button>
                    )}
                </div>

                {phase === 'downloading' && (
                    <div className="mt-4">
                        <div className="h-1.5 w-full rounded-full bg-navy/[0.06] overflow-hidden">
                            <div
                                className="h-full rounded-full bg-gradient-to-r from-pink to-pink-light transition-[width] duration-300 ease-out"
                                style={{ width: `${percent ?? 0}%` }}
                            />
                        </div>
                        <p className="mt-1.5 text-[11px] font-medium text-navy/35 tabular-nums">
                            {t('update.progress', { percent: percent ?? 0 })}
                        </p>
                    </div>
                )}

                {phase === 'available' && (
                    <div className="mt-4 flex gap-2">
                        <button
                            type="button"
                            onClick={() => window.ipcRenderer.downloadUpdate()}
                            className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-pink to-pink-light hover:from-pink-light hover:to-pink shadow-[0_4px_16px_rgba(233,30,140,0.2)] active:scale-[0.98] transition-all duration-200 cursor-pointer"
                        >
                            {t('update.download')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setDismissed(newVersion ?? null)}
                            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-navy/50 hover:text-navy hover:bg-navy/[0.04] transition-all duration-200 cursor-pointer"
                        >
                            {t('update.later')}
                        </button>
                    </div>
                )}

                {phase === 'ready' && (
                    <div className="mt-4 flex gap-2">
                        <button
                            type="button"
                            onClick={() => window.ipcRenderer.quitAndInstall()}
                            className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-pink to-pink-light hover:from-pink-light hover:to-pink shadow-[0_4px_16px_rgba(233,30,140,0.2)] active:scale-[0.98] transition-all duration-200 cursor-pointer"
                        >
                            {t('update.restart_now')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setDismissed(newVersion ?? null)}
                            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-navy/50 hover:text-navy hover:bg-navy/[0.04] transition-all duration-200 cursor-pointer"
                        >
                            {t('update.on_quit')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
