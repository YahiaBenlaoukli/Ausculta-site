import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DisplayOption, QueueDisplayNameMode } from '../../../types/network';

/**
 * The waiting-room TV: whether this machine drives one, and on which monitor.
 *
 * Machine-local, like the printer beside it — a monitor is physically plugged
 * into one seat — so it is stored in network.json rather than the shared
 * database, where it could only ever be right for one of them.
 *
 * "Reopen at every launch" is the setting that matters most, and not a
 * convenience: this page is doctor-only, so without it the assistant would have
 * to fetch the doctor every morning to put the board back on the TV.
 */

const NAME_MODES: QueueDisplayNameMode[] = ['full', 'initial', 'number'];

export default function QueueDisplaySettings() {
    const { t } = useTranslation();
    const [displays, setDisplays] = useState<DisplayOption[]>([]);
    const [enabled, setEnabled] = useState(false);
    const [displayId, setDisplayId] = useState<string>('');
    const [nameMode, setNameMode] = useState<QueueDisplayNameMode>('full');
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    const loadStatus = useCallback(async () => {
        try {
            const status = await window.ipcRenderer.getQueueDisplayStatus();
            if (status?.status === 'success' && status.data) setOpen(status.data.open);
        } catch {
            // Reported by the buttons themselves; nothing to say here.
        }
    }, []);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const [list, config] = await Promise.all([
                    window.ipcRenderer.listDisplays(),
                    window.ipcRenderer.getNetworkConfig(),
                ]);
                if (!alive) return;
                if (list?.status === 'success' && list.data) setDisplays(list.data);
                setEnabled(config?.queueDisplayEnabled ?? false);
                setDisplayId(config?.queueDisplayId != null ? String(config.queueDisplayId) : '');
                setNameMode(config?.queueDisplayNameMode ?? 'full');
            } catch {
                // A machine with one screen is a legitimate state: the panel
                // still works, it just has nothing useful to offer.
            }
            void loadStatus();
        })();
        return () => { alive = false; };
    }, [loadStatus]);

    /* Saved on change, like the printer picker — there is no Save button on
       this page's machine-local settings, and nothing here needs a restart. */
    const patch = async (change: Parameters<typeof window.ipcRenderer.setNetworkConfig>[0]) => {
        setSaving(true);
        try {
            await window.ipcRenderer.setNetworkConfig(change);
        } finally {
            setSaving(false);
        }
    };

    const chooseEnabled = async (value: boolean) => {
        setEnabled(value);
        await patch({ queueDisplayEnabled: value });
    };

    const chooseDisplay = async (value: string) => {
        setDisplayId(value);
        await patch({ queueDisplayId: value === '' ? null : Number(value) });
    };

    const chooseNameMode = async (value: QueueDisplayNameMode) => {
        setNameMode(value);
        await patch({ queueDisplayNameMode: value });
    };

    const openBoard = async () => {
        await window.ipcRenderer.openQueueDisplay(displayId === '' ? null : Number(displayId));
        await loadStatus();
    };

    const closeBoard = async () => {
        await window.ipcRenderer.closeQueueDisplay();
        await loadStatus();
    };

    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-base font-bold text-navy">{t('queue_display.settings.title')}</h3>
                <p className="text-xs text-navy/50 mt-1 max-w-prose">{t('queue_display.settings.subtitle')}</p>
            </div>

            {/* On/off as a two-card group: this app has no checkbox anywhere. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg">
                {[false, true].map((value) => (
                    <button
                        key={String(value)}
                        type="button"
                        onClick={() => chooseEnabled(value)}
                        disabled={saving}
                        className={`text-start p-4 rounded-2xl border transition-colors cursor-pointer select-none disabled:opacity-50 ${
                            enabled === value
                                ? 'border-pink/40 bg-pink/[0.04]'
                                : 'border-navy/10 bg-white hover:bg-navy/[0.02]'
                        }`}
                    >
                        <span className="block text-sm font-bold text-navy">
                            {t(value ? 'queue_display.settings.on' : 'queue_display.settings.off')}
                        </span>
                        <span className="block text-[11px] text-navy/50 mt-0.5">
                            {t(value ? 'queue_display.settings.on_hint' : 'queue_display.settings.off_hint')}
                        </span>
                    </button>
                ))}
            </div>

            <label className="flex flex-col gap-2 max-w-md">
                <span className="text-[11px] font-semibold text-navy/50 uppercase tracking-wide">
                    {t('queue_display.settings.screen')}
                </span>
                <select
                    value={displayId}
                    onChange={(e) => chooseDisplay(e.target.value)}
                    disabled={saving}
                    className="px-4 py-2.5 rounded-2xl bg-white border border-navy/10 text-navy text-sm focus:outline-none focus:border-pink/40 transition-colors cursor-pointer disabled:opacity-50"
                >
                    <option value="">{t('queue_display.settings.screen_auto')}</option>
                    {displays.map((display) => (
                        <option key={display.id} value={display.id}>
                            {display.label} ({display.bounds.width}×{display.bounds.height})
                            {display.isPrimary ? ` — ${t('queue_display.settings.primary')}` : ''}
                        </option>
                    ))}
                </select>
            </label>

            {displays.length < 2 && (
                <p className="text-[11px] text-navy/40 max-w-prose">{t('queue_display.settings.one_screen')}</p>
            )}

            <label className="flex flex-col gap-2 max-w-md">
                <span className="text-[11px] font-semibold text-navy/50 uppercase tracking-wide">
                    {t('queue_display.settings.name_mode')}
                </span>
                <select
                    value={nameMode}
                    onChange={(e) => chooseNameMode(e.target.value as QueueDisplayNameMode)}
                    disabled={saving}
                    className="px-4 py-2.5 rounded-2xl bg-white border border-navy/10 text-navy text-sm focus:outline-none focus:border-pink/40 transition-colors cursor-pointer disabled:opacity-50"
                >
                    {NAME_MODES.map((mode) => (
                        <option key={mode} value={mode}>{t(`queue_display.settings.name_mode_${mode}`)}</option>
                    ))}
                </select>
                <span className="text-[11px] text-navy/40 max-w-prose">
                    {t('queue_display.settings.name_mode_hint')}
                </span>
            </label>

            <div className="flex items-center gap-3 flex-wrap">
                <button
                    type="button"
                    onClick={openBoard}
                    className="px-4 py-2 rounded-2xl border border-navy/10 bg-white text-navy/70 hover:text-navy hover:bg-navy/[0.03] text-xs font-bold transition-colors cursor-pointer select-none"
                >
                    {t('queue_display.settings.open_now')}
                </button>
                {open && (
                    <button
                        type="button"
                        onClick={closeBoard}
                        className="px-4 py-2 rounded-2xl border border-navy/10 bg-white text-navy/70 hover:text-navy hover:bg-navy/[0.03] text-xs font-bold transition-colors cursor-pointer select-none"
                    >
                        {t('queue_display.settings.close')}
                    </button>
                )}
                {open && (
                    <span className="text-xs font-semibold text-emerald-700">
                        {t('queue_display.settings.is_open')}
                    </span>
                )}
            </div>
        </div>
    );
}
