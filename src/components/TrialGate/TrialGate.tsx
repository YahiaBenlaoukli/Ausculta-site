import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TrialStatus } from '../../../types/trial';

/**
 * Gates the whole app behind the trial check.
 * - While the status loads: renders nothing (a few ms flash at most).
 * - Trial expired & not licensed: full-screen activation page.
 * - Trial running: renders the app, plus a clickable "X days left" pill that
 *   opens the license section in Settings — the key works at any time.
 */
export default function TrialGate({ children }: { children: React.ReactNode }) {
    const { t } = useTranslation();
    const [trial, setTrial] = useState<TrialStatus | null>(null);
    const [licenseKey, setLicenseKey] = useState('');
    const [isActivating, setIsActivating] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    // Shown next to the trial pill when it's clicked while no one is signed in:
    // license activation lives in Settings, which needs an account, so we point
    // the user there instead of navigating to a page they can't use yet.
    const [loginHint, setLoginHint] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const result = await window.ipcRenderer.getTrialStatus();
            setTrial(result);
        } catch {
            // The check itself failed — fail closed, same policy as the backend.
            setTrial({ status: 'fail', licensed: false, expired: true, daysRemaining: 0, totalDays: 14 });
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    // The settings page activates the license out-of-band — refresh so the
    // trial pill disappears without a restart.
    useEffect(() => {
        window.addEventListener('license-activated', refresh);
        return () => window.removeEventListener('license-activated', refresh);
    }, [refresh]);

    const handleActivate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsActivating(true);
        try {
            const result = await window.ipcRenderer.activateLicense(licenseKey);
            if (result?.status === 'success') {
                setSuccess(t('trial.success'));
                // Small pause so the user sees the confirmation before the app appears
                setTimeout(() => refresh(), 900);
            } else {
                setError(result?.message || t('trial.error_invalid'));
            }
        } catch {
            setError(t('trial.error_connection'));
        } finally {
            setIsActivating(false);
        }
    };

    // Status not loaded yet — avoid flashing the app before the verdict
    if (!trial) return null;

    /* ── Expired: full-screen license activation ── */
    if (!trial.licensed && trial.expired) {
        return (
            <div className="flex min-h-screen w-full items-center justify-center bg-bg px-6 relative overflow-hidden">
                {/* Background blurs, same language as the auth page */}
                <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-[10%] right-[10%] w-[300px] h-[300px] rounded-full bg-pink/[0.03] blur-[80px]" />
                    <div className="absolute bottom-[10%] left-[10%] w-[250px] h-[250px] rounded-full bg-navy/[0.03] blur-[80px]" />
                </div>

                <div className="relative z-10 w-full max-w-[440px]" style={{ animation: 'scaleIn 0.4s ease-out both' }}>
                    {/* Branding */}
                    <div className="flex items-center justify-center gap-2.5 mb-8">
                        <img src="./logo.png" alt="Ausculta" className="w-9 h-9 object-contain" />
                        <div className="inline-flex">
                            <span className="text-2xl tracking-tight text-navy font-bold">Ausc</span>
                            <span className="text-2xl tracking-tight text-pink font-bold">ulta</span>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl p-7 shadow-[0_4px_24px_rgba(30,42,86,0.07)] border border-navy/[0.04]">
                        {/* Lock icon */}
                        <div className="w-12 h-12 rounded-xl bg-pink/[0.08] flex items-center justify-center mb-5 mx-auto">
                            <svg className="w-6 h-6 text-pink" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="11" width="18" height="11" rx="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                        </div>

                        <h1 className="text-xl font-bold text-navy text-center leading-tight mb-2">
                            {t('trial.expired_title')}
                        </h1>
                        <p className="text-navy/40 text-sm text-center mb-6">
                            {t('trial.expired_subtitle')}
                        </p>

                        {error && (
                            <div className="mb-5 flex items-center gap-2.5 bg-pink/[0.06] border border-pink/15 rounded-xl px-4 py-3 text-sm text-pink-dark"
                                style={{ animation: 'scaleIn 0.3s ease-out' }}>
                                <svg className="w-4 h-4 flex-shrink-0 text-pink" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="12" y1="8" x2="12" y2="12" />
                                    <line x1="12" y1="16" x2="12.01" y2="16" />
                                </svg>
                                {error}
                            </div>
                        )}

                        {success && (
                            <div className="mb-5 flex items-center gap-2.5 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700"
                                style={{ animation: 'scaleIn 0.3s ease-out' }}>
                                <svg className="w-4 h-4 flex-shrink-0 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10" />
                                    <polyline points="16 10 11 15 8 12" />
                                </svg>
                                {success}
                            </div>
                        )}

                        <form onSubmit={handleActivate}>
                            <label htmlFor="trial-license-key" className="block text-xs font-semibold text-navy/50 uppercase tracking-wide mb-2">
                                {t('trial.license_label')}
                            </label>
                            <input
                                type="text"
                                id="trial-license-key"
                                value={licenseKey}
                                onChange={(e) => setLicenseKey(e.target.value)}
                                placeholder={t('trial.license_placeholder')}
                                className="w-full px-4 py-3 mb-5 rounded-xl bg-bg/70 border border-navy/[0.08] text-navy text-sm placeholder:text-navy/25 focus:outline-none focus:border-pink/40 focus:bg-white focus:shadow-[0_0_0_3px_rgba(233,30,140,0.06)] transition-all duration-200 font-mono"
                                required
                                autoComplete="off"
                                spellCheck={false}
                            />

                            <button
                                type="submit"
                                disabled={isActivating || !licenseKey.trim()}
                                className="w-full py-3.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-pink to-pink-light hover:from-pink-light hover:to-pink shadow-[0_4px_16px_rgba(233,30,140,0.2)] hover:shadow-[0_6px_24px_rgba(233,30,140,0.3)] active:scale-[0.98] transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100 flex items-center justify-center gap-2"
                            >
                                {isActivating ? (
                                    <>
                                        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                        {t('trial.activating')}
                                    </>
                                ) : (
                                    t('trial.activate')
                                )}
                            </button>
                        </form>
                    </div>

                    <p className="text-center text-navy/25 text-xs mt-5">
                        {t('trial.contact')}
                    </p>
                </div>
            </div>
        );
    }

    /* ── Trial running (or licensed): the app, plus a days-left pill during trial ── */
    return (
        <>
            {children}
            {!trial.licensed && (
                <div className="fixed bottom-4 end-4 z-50 flex flex-col items-end gap-2">
                    {/* Hint bubble — only when a signed-out user clicks the pill */}
                    {loginHint && (
                        <div
                            className="max-w-[240px] bg-white text-navy/70 text-xs leading-relaxed px-3.5 py-2.5 rounded-xl shadow-[0_4px_16px_rgba(30,42,86,0.18)] border border-navy/[0.06]"
                            style={{ animation: 'scaleIn 0.2s ease-out both' }}
                        >
                            {t('trial.login_required')}
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={async () => {
                            // License activation lives in Settings, which requires a
                            // logged-in user. Only route there once we confirm a session.
                            try {
                                const auth = await window.ipcRenderer.checkAuth();
                                if (auth?.status === 'success') {
                                    window.location.hash = '/settings?tab=license';
                                    return;
                                }
                            } catch {
                                // fall through to the hint
                            }
                            setLoginHint(true);
                            setTimeout(() => setLoginHint(false), 5000);
                        }}
                        title={t('trial.activate_title')}
                        className="select-none bg-navy/85 backdrop-blur-sm text-white/90 text-xs font-medium px-3.5 py-2 rounded-full shadow-[0_4px_16px_rgba(30,42,86,0.25)] hover:bg-navy cursor-pointer transition-colors duration-200 flex items-center gap-1.5"
                    >
                        {t('trial.days_remaining', { days: trial.daysRemaining })}
                        <span className="text-white/60">·</span>
                        <span className="underline underline-offset-2">{t('trial.activate_now')}</span>
                    </button>
                </div>
            )}
        </>
    );
}
