import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrentUser } from '../../hooks/useCurrentUser';

/**
 * Icon-sized "send to the front desk", for rows in a document list.
 *
 * Same behaviour as SendToPrintButton, sized to sit beside an open icon in a
 * table row rather than beside a form's primary action. Kept as its own
 * component instead of a `variant` prop because the two share three lines of
 * logic and nothing of their markup.
 *
 * Renders nothing on a standalone install — there is no second seat to send
 * to — or for an assistant, who would be queueing work for themselves.
 */
export default function SendToPrintIcon({ documentPath }: { documentPath: string | null | undefined }) {
    const { t } = useTranslation();
    const { isDoctor } = useCurrentUser();
    const [linked, setLinked] = useState(false);
    const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const config = await window.ipcRenderer.getNetworkConfig();
                if (alive) setLinked(config?.mode === 'host' || config?.mode === 'client');
            } catch {
                if (alive) setLinked(false);
            }
        })();
        return () => { alive = false; };
    }, []);

    if (!documentPath || !linked || !isDoctor) return null;

    const send = async () => {
        setState('sending');
        try {
            const result = await window.ipcRenderer.enqueuePrintJob(documentPath);
            setState(result?.status === 'success' ? 'sent' : 'error');
        } catch {
            setState('error');
        }
    };

    const sent = state === 'sent';

    return (
        <button
            type="button"
            onClick={send}
            disabled={state === 'sending' || sent}
            title={sent ? t('print.sent') : t('print.send_hint')}
            aria-label={sent ? t('print.sent') : t('print.send')}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer bg-transparent border-none disabled:cursor-default ${
                sent ? 'text-emerald-600' : state === 'error' ? 'text-red-500' : 'text-navy/25 hover:text-pink hover:bg-pink/5'
            }`}
        >
            {sent ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                </svg>
            ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 6 2 18 2 18 9" />
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                    <rect x="6" y="14" width="12" height="8" />
                </svg>
            )}
        </button>
    );
}
