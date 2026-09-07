import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrentUser } from '../../hooks/useCurrentUser';

/**
 * "Send this to the front desk to be printed."
 *
 * Sits beside the buttons that open a freshly generated prescription,
 * certificate or receipt, and takes the same path those already hold — so
 * adding it to a screen is one line, and nothing that generates a document had
 * to learn about printing.
 *
 * Hidden on a standalone install, where there is no other seat to send
 * anything to, and hidden from an assistant, for whom queueing would be asking
 * themselves to print something.
 */
export default function SendToPrintButton({
    documentPath,
    className = '',
}: {
    documentPath: string | null | undefined;
    className?: string;
}) {
    const { t } = useTranslation();
    const { isDoctor } = useCurrentUser();
    const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
    const [linked, setLinked] = useState(false);

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

    // A new document means a new decision; without this the button would still
    // read "sent" for the next patient's prescription.
    useEffect(() => { setState('idle'); }, [documentPath]);

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

    if (state === 'sent') {
        return (
            <span className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold ${className}`}>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                </svg>
                {t('print.sent')}
            </span>
        );
    }

    return (
        <button
            type="button"
            onClick={send}
            disabled={state === 'sending'}
            title={t('print.send_hint')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-navy/10 bg-white text-navy/70 hover:text-navy hover:bg-navy/[0.03] text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 select-none ${className}`}
        >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
            </svg>
            {state === 'sending' ? t('print.sending') : state === 'error' ? t('print.send_failed') : t('print.send')}
        </button>
    );
}
