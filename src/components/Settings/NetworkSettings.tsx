import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConnectionTest, HostInfo, NetworkConfig, NetworkMode } from '../../../types/network';

/**
 * Where this machine gets the practice's data.
 *
 * Used in two places, which is why it takes no props about who is looking:
 * inside Settings for the doctor, and from the login screen, because a client
 * has to be pointed at the host BEFORE anyone can sign in on it — there is no
 * account to authenticate against until the link exists.
 *
 * Every change here needs a restart. The mode decides whether this process
 * opens a database at all, which is settled once at startup; there is no
 * coherent way to move a running process from owning the data to proxying it
 * while screens are open against the old answer.
 */

/** Shortens a 95-character fingerprint to something a person can compare. */
function shortFingerprint(value: string | null | undefined): string {
    if (!value) return '—';
    const parts = value.split(':');
    return parts.length > 8 ? `${parts.slice(0, 4).join(':')} … ${parts.slice(-4).join(':')}` : value;
}

export default function NetworkSettings({ compact = false }: { compact?: boolean }) {
    const { t } = useTranslation();
    const [config, setConfig] = useState<NetworkConfig | null>(null);
    const [host, setHost] = useState<HostInfo | null>(null);
    const [pinned, setPinned] = useState<string | null>(null);
    const [test, setTest] = useState<ConnectionTest | null>(null);
    const [testing, setTesting] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [saved, setSaved] = useState(false);
    const [firewall, setFirewall] = useState<'unsupported' | 'present' | 'absent' | 'unknown'>('unknown');
    const [allowing, setAllowing] = useState(false);

    // Draft fields — kept separate so typing an address does not write the file
    // on every keystroke.
    const [mode, setMode] = useState<NetworkMode>('standalone');
    const [address, setAddress] = useState('');
    const [port, setPort] = useState('7317');

    const load = useCallback(async () => {
        try {
            const [current, info, fingerprint] = await Promise.all([
                window.ipcRenderer.getNetworkConfig(),
                window.ipcRenderer.getHostInfo(),
                window.ipcRenderer.getPinnedFingerprint(),
            ]);
            setConfig(current);
            setHost(info);
            setPinned(fingerprint);
            setMode(current.mode);
            setAddress(current.hostAddress);
            setPort(String(current.port));
        } catch {
            // Leaves the panel in its loading state rather than claiming a mode
            // this machine may not be in.
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    // Only meaningful once this machine is actually the host.
    useEffect(() => {
        if (mode !== 'host') return;
        let alive = true;
        (async () => {
            try {
                const result = await window.ipcRenderer.checkFirewallRule();
                if (alive) setFirewall(result?.state ?? 'unknown');
            } catch {
                if (alive) setFirewall('unknown');
            }
        })();
        return () => { alive = false; };
    }, [mode, config?.port]);

    const allowThroughFirewall = async () => {
        setAllowing(true);
        try {
            const result = await window.ipcRenderer.addFirewallRule();
            setFirewall(result?.state ?? 'unknown');
        } finally {
            setAllowing(false);
        }
    };

    const save = async () => {
        const parsedPort = Number(port);
        const result = await window.ipcRenderer.setNetworkConfig({
            mode,
            hostAddress: address.trim(),
            port: Number.isInteger(parsedPort) ? parsedPort : 7317,
        });
        if (result?.status === 'success') {
            setSaved(true);
            setDirty(false);
            await load();
        }
    };

    const runTest = async () => {
        setTesting(true);
        setTest(null);
        try {
            // Saved first: the test reads the address out of the config file,
            // not out of this form, so an untested draft would test the OLD one.
            if (dirty) await save();
            const result = await window.ipcRenderer.testHostConnection();
            setTest(result);
            setPinned(await window.ipcRenderer.getPinnedFingerprint());
        } finally {
            setTesting(false);
        }
    };

    const unpair = async () => {
        if (!window.confirm(t('network.settings.unpair_confirm'))) return;
        await window.ipcRenderer.unpairHost();
        setPinned(null);
        setTest(null);
    };

    const change = (next: Partial<{ mode: NetworkMode; address: string; port: string }>) => {
        if (next.mode !== undefined) setMode(next.mode);
        if (next.address !== undefined) setAddress(next.address);
        if (next.port !== undefined) setPort(next.port);
        setDirty(true);
        setSaved(false);
    };

    if (!config) return <p className="text-sm text-navy/40">{t('network.settings.loading')}</p>;

    const modes: { id: NetworkMode; badge?: string }[] = [
        { id: 'standalone' },
        { id: 'host' },
        { id: 'client' },
    ];

    return (
        <div className="space-y-5">
            {!compact && (
                <div>
                    <h3 className="text-base font-bold text-navy">{t('network.settings.title')}</h3>
                    <p className="text-xs text-navy/50 mt-1 max-w-prose">{t('network.settings.subtitle')}</p>
                </div>
            )}

            {/* ── Mode ── */}
            <div className="grid gap-2 sm:grid-cols-3">
                {modes.map((entry) => {
                    const active = mode === entry.id;
                    return (
                        <button
                            key={entry.id}
                            type="button"
                            onClick={() => change({ mode: entry.id })}
                            className={`text-start p-4 rounded-2xl border transition-colors cursor-pointer select-none ${
                                active
                                    ? 'border-pink/40 bg-pink/[0.04]'
                                    : 'border-navy/10 bg-white hover:bg-navy/[0.02]'
                            }`}
                        >
                            <span className={`block text-sm font-bold ${active ? 'text-pink' : 'text-navy'}`}>
                                {t(`network.settings.modes.${entry.id}.label`)}
                            </span>
                            <span className="block text-[11px] text-navy/45 mt-1 leading-relaxed">
                                {t(`network.settings.modes.${entry.id}.hint`)}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* ── Host: what to read off ── */}
            {mode === 'host' && (
                <div className="p-5 rounded-2xl bg-navy/[0.02] border border-navy/[0.06] space-y-4">
                    <p className="text-xs text-navy/60 max-w-prose">{t('network.settings.host.intro')}</p>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <span className="block text-[11px] font-semibold text-navy/45 uppercase tracking-wide mb-1.5">
                                {t('network.settings.host.addresses')}
                            </span>
                            {host?.addresses.length ? (
                                <ul className="space-y-1">
                                    {host.addresses.map((ip) => (
                                        <li key={ip} className="font-mono text-sm text-navy tabular-nums">{ip}</li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-navy/40">{t('network.settings.host.no_addresses')}</p>
                            )}
                        </div>
                        <div>
                            <span className="block text-[11px] font-semibold text-navy/45 uppercase tracking-wide mb-1.5">
                                {t('network.settings.port')}
                            </span>
                            <input
                                type="number"
                                value={port}
                                onChange={(e) => change({ port: e.target.value })}
                                className="w-32 px-3 py-2 rounded-xl bg-white border border-navy/10 text-navy text-sm font-mono tabular-nums focus:outline-none focus:border-pink/40"
                            />
                        </div>
                    </div>

                    <div>
                        <span className="block text-[11px] font-semibold text-navy/45 uppercase tracking-wide mb-1.5">
                            {t('network.settings.fingerprint')}
                        </span>
                        <p className="font-mono text-[11px] text-navy/70 break-all">{shortFingerprint(host?.fingerprint)}</p>
                        <p className="text-[11px] text-navy/40 mt-1.5 max-w-prose">{t('network.settings.fingerprint_hint')}</p>
                    </div>

                    <p className={`text-xs font-semibold ${host?.running ? 'text-emerald-700' : 'text-navy/45'}`}>
                        {host?.running ? t('network.settings.host.running') : t('network.settings.host.not_running')}
                    </p>

                    {/* The single most likely reason a correct setup still does
                        not connect. Offered here rather than done by the
                        installer, which is per-user and cannot elevate. */}
                    {firewall !== 'unsupported' && (
                        <div className="pt-3 border-t border-navy/[0.06] flex items-center gap-3 flex-wrap">
                            <span className={`text-xs font-semibold ${firewall === 'present' ? 'text-emerald-700' : 'text-navy/60'}`}>
                                {firewall === 'present'
                                    ? t('network.settings.host.firewall_ok')
                                    : t('network.settings.host.firewall_missing')}
                            </span>
                            {firewall !== 'present' && (
                                <button
                                    type="button"
                                    onClick={allowThroughFirewall}
                                    disabled={allowing}
                                    className="px-4 py-2 rounded-xl border border-navy/10 bg-white text-navy/70 hover:text-navy hover:bg-navy/[0.03] text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 select-none"
                                >
                                    {allowing ? t('network.settings.host.firewall_allowing') : t('network.settings.host.firewall_allow')}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ── Client: where to look ── */}
            {mode === 'client' && (
                <div className="p-5 rounded-2xl bg-navy/[0.02] border border-navy/[0.06] space-y-4">
                    <p className="text-xs text-navy/60 max-w-prose">{t('network.settings.client.intro')}</p>

                    <div className="flex gap-3 flex-wrap items-end">
                        <label className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
                            <span className="text-[11px] font-semibold text-navy/45 uppercase tracking-wide">
                                {t('network.settings.client.address')}
                            </span>
                            <input
                                type="text"
                                value={address}
                                onChange={(e) => change({ address: e.target.value })}
                                placeholder="192.168.1.10"
                                spellCheck={false}
                                className="px-4 py-2.5 rounded-xl bg-white border border-navy/10 text-navy text-sm font-mono focus:outline-none focus:border-pink/40"
                            />
                        </label>
                        <label className="flex flex-col gap-1.5">
                            <span className="text-[11px] font-semibold text-navy/45 uppercase tracking-wide">
                                {t('network.settings.port')}
                            </span>
                            <input
                                type="number"
                                value={port}
                                onChange={(e) => change({ port: e.target.value })}
                                className="w-28 px-3 py-2.5 rounded-xl bg-white border border-navy/10 text-navy text-sm font-mono tabular-nums focus:outline-none focus:border-pink/40"
                            />
                        </label>
                        <button
                            type="button"
                            onClick={runTest}
                            disabled={testing || !address.trim()}
                            className="px-5 py-2.5 rounded-xl bg-navy text-white text-xs font-bold hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none"
                        >
                            {testing ? t('network.settings.client.testing') : t('network.settings.client.test')}
                        </button>
                    </div>

                    {test && (
                        <div className={`px-4 py-3 rounded-xl text-xs border ${
                            test.status === 'success'
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                : 'bg-pink/[0.06] border-pink/15 text-pink-dark'
                        }`}>
                            {test.status === 'success'
                                ? (test.paired ? t('network.settings.client.paired') : t('network.settings.client.reachable'))
                                : t(`network.banner.${test.code === 'fingerprint_mismatch' ? 'fingerprint_mismatch' : test.code === 'not_ausculta' ? 'not_ausculta' : 'unreachable'}`)}
                        </div>
                    )}

                    <div>
                        <span className="block text-[11px] font-semibold text-navy/45 uppercase tracking-wide mb-1.5">
                            {t('network.settings.client.paired_with')}
                        </span>
                        <p className="font-mono text-[11px] text-navy/70 break-all">{shortFingerprint(pinned)}</p>
                        <p className="text-[11px] text-navy/40 mt-1.5 max-w-prose">{t('network.settings.fingerprint_hint')}</p>
                        {pinned && (
                            <button
                                type="button"
                                onClick={unpair}
                                className="mt-2.5 px-3 py-1.5 rounded-xl border border-navy/10 text-navy/50 hover:text-red-500 hover:border-red-200 text-[11px] font-bold transition-colors cursor-pointer select-none"
                            >
                                {t('network.settings.client.unpair')}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* ── Consequences, said plainly ── */}
            {mode !== 'standalone' && (
                <ul className="text-[11px] text-navy/50 space-y-1.5 max-w-prose list-disc ps-4">
                    <li>{t('network.settings.notes.host_must_be_on')}</li>
                    <li>{t('network.settings.notes.backups')}</li>
                    <li>{t('network.settings.notes.firewall')}</li>
                    <li>{t('network.settings.notes.fixed_address')}</li>
                </ul>
            )}

            <div className="flex items-center gap-3 flex-wrap">
                <button
                    type="button"
                    onClick={save}
                    disabled={!dirty}
                    className="px-6 py-2.5 rounded-2xl bg-gradient-to-r from-pink to-pink-light text-white text-xs font-bold shadow-[0_4px_14px_rgba(233,30,140,0.25)] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none"
                >
                    {t('network.settings.save')}
                </button>
                {saved && (
                    <span className="text-xs font-semibold text-emerald-700">
                        {t('network.settings.restart_required')}
                    </span>
                )}
                {saved && (
                    <button
                        type="button"
                        onClick={() => window.ipcRenderer.relaunchApp()}
                        className="px-4 py-2 rounded-2xl border border-navy/10 text-navy/70 hover:text-navy hover:bg-navy/[0.03] text-xs font-bold transition-colors cursor-pointer select-none"
                    >
                        {t('network.settings.restart_now')}
                    </button>
                )}
            </div>
        </div>
    );
}
