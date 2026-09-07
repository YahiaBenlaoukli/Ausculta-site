import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Tells the front desk when the doctor's machine has gone away.
 *
 * On a client every screen is fed by the host, so when it stops answering the
 * failure is the same everywhere and reporting it per-screen would mean the
 * same message six times over. This says it once, at the top, and offers the
 * only useful action.
 *
 * Silent by default and on a standalone or host install, where there is no
 * link to lose — the banner only ever appears after main has pushed a
 * 'host-status' event saying reachability changed.
 */
export default function HostBanner() {
    const { t } = useTranslation();
    const [status, setStatus] = useState<HostStatus | null>(null);
    const [retrying, setRetrying] = useState(false);

    useEffect(() => {
        const onStatus = (_event: unknown, ...args: unknown[]) =>
            setStatus(args[0] as HostStatus);
        window.ipcRenderer.on('host-status', onStatus);
        return () => window.ipcRenderer.off('host-status', onStatus);
    }, []);

    const retry = useCallback(async () => {
        setRetrying(true);
        try {
            const result = await window.ipcRenderer.testHostConnection();
            if (result?.status === 'success') setStatus({ reachable: true });
            else setStatus({ reachable: false, code: result?.code });
        } catch {
            setStatus({ reachable: false });
        } finally {
            setRetrying(false);
        }
    }, []);

    if (!status || status.reachable) return null;

    // A changed certificate is not a connectivity problem and must not read
    // like one: the fix is to re-pair deliberately, having checked it really
    // is the same machine.
    const isPinFailure = status.code === 'fingerprint_mismatch';
    const key = isPinFailure ? 'fingerprint_mismatch' : status.code === 'not_ausculta' ? 'not_ausculta' : 'unreachable';

    return (
        <div
            role="status"
            className={`fixed top-0 inset-x-0 z-[95] px-5 py-2.5 flex items-center justify-center gap-3 flex-wrap text-xs font-semibold shadow-[0_2px_12px_rgba(30,42,86,0.12)] ${
                isPinFailure ? 'bg-red-600 text-white' : 'bg-navy text-white'
            }`}
        >
            <span className="flex items-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                {t(`network.banner.${key}`)}
            </span>
            {!isPinFailure && (
                <button
                    type="button"
                    onClick={retry}
                    disabled={retrying}
                    className="px-3 py-1 rounded-lg bg-white/15 hover:bg-white/25 transition-colors cursor-pointer disabled:opacity-50 select-none"
                >
                    {retrying ? t('network.banner.retrying') : t('network.banner.retry')}
                </button>
            )}
        </div>
    );
}
