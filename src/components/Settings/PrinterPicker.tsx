import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PrinterOption } from '../../../types/print';

/**
 * Which printer this machine prints to.
 *
 * Machine-local: the desk and the consulting room have different printers, so
 * this is stored beside the network settings rather than in the shared
 * database, where it could only ever be right for one seat.
 *
 * "Ask every time" is the default and a legitimate choice, not a missing
 * value — it opens the document in the OS viewer and lets the user press
 * Ctrl+P. That is what makes the queue work on an install nobody configured.
 */
export default function PrinterPicker() {
    const { t } = useTranslation();
    const [printers, setPrinters] = useState<PrinterOption[]>([]);
    const [selected, setSelected] = useState<string>('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const [list, config] = await Promise.all([
                    window.ipcRenderer.listPrinters(),
                    window.ipcRenderer.getNetworkConfig(),
                ]);
                if (!alive) return;
                if (list?.status === 'success' && list.data) setPrinters(list.data);
                setSelected(config?.printerName ?? '');
            } catch {
                // No printers visible is a legitimate state — the fallback path
                // works without any of this.
            }
        })();
        return () => { alive = false; };
    }, []);

    const choose = async (value: string) => {
        setSelected(value);
        setSaving(true);
        try {
            await window.ipcRenderer.setNetworkConfig({ printerName: value || null });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-3">
            <div>
                <h3 className="text-base font-bold text-navy">{t('print.settings.title')}</h3>
                <p className="text-xs text-navy/50 mt-1 max-w-prose">{t('print.settings.subtitle')}</p>
            </div>

            <label className="flex flex-col gap-2 max-w-md">
                <span className="text-[11px] font-semibold text-navy/50 uppercase tracking-wide">
                    {t('print.settings.printer')}
                </span>
                <select
                    value={selected}
                    onChange={(e) => choose(e.target.value)}
                    disabled={saving}
                    className="px-4 py-2.5 rounded-2xl bg-white border border-navy/10 text-navy text-sm focus:outline-none focus:border-pink/40 transition-colors cursor-pointer disabled:opacity-50"
                >
                    <option value="">{t('print.settings.ask_every_time')}</option>
                    {printers.map((printer) => (
                        <option key={printer.name} value={printer.name}>
                            {printer.displayName}{printer.isDefault ? ` — ${t('print.settings.system_default')}` : ''}
                        </option>
                    ))}
                </select>
            </label>

            {printers.length === 0 && (
                <p className="text-[11px] text-navy/40 max-w-prose">{t('print.settings.none_found')}</p>
            )}
        </div>
    );
}
