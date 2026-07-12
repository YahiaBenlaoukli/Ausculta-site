import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/* ─── Heart Animation (simplified for login — gentle auto-loop) ─── */
const TOTAL_FRAMES = 150;
const FRAME_PATH = './sequences/heart/';

function HeartCanvas() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imagesRef = useRef<HTMLImageElement[]>([]);
    const frameRef = useRef(0);
    const [isLoaded, setIsLoaded] = useState(false);

    const drawFrame = useCallback((frameIndex: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const img = imagesRef.current[frameIndex];
        if (!img || !img.complete || !img.naturalWidth) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }, []);

    useEffect(() => {
        const images: HTMLImageElement[] = [];
        let loadedCount = 0;

        function loadBatch(start: number, size: number) {
            const end = Math.min(start + size, TOTAL_FRAMES);
            for (let i = start; i < end; i++) {
                const img = new Image();
                img.src = `${FRAME_PATH}${(i + 1).toString().padStart(4, '0')}.png`;
                img.onload = () => {
                    loadedCount++;
                    if (loadedCount === 1) {
                        drawFrame(0);
                        setIsLoaded(true);
                    }
                    if (loadedCount === end && end < TOTAL_FRAMES) {
                        loadBatch(end, size);
                    }
                };
                img.onerror = () => {
                    // Remove broken image so drawFrame skips it
                    images[i] = null as unknown as HTMLImageElement;
                    loadedCount++;
                    if (loadedCount === end && end < TOTAL_FRAMES) {
                        loadBatch(end, size);
                    }
                };
                images[i] = img;
            }
        }

        imagesRef.current = images;
        loadBatch(0, 25);
    }, [drawFrame]);

    useEffect(() => {
        let rafId: number;
        let lastTime = 0;

        const animate = (time: number) => {
            if (!lastTime) lastTime = time;
            const delta = time - lastTime;
            lastTime = time;
            frameRef.current = (frameRef.current + delta * 0.018) % TOTAL_FRAMES;
            drawFrame(Math.floor(frameRef.current));
            rafId = requestAnimationFrame(animate);
        };

        rafId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(rafId);
    }, [drawFrame]);

    return (
        <canvas
            ref={canvasRef}
            width={512}
            height={512}
            className={`w-full max-w-[420px] aspect-square object-contain transition-opacity duration-1000 ${isLoaded ? 'opacity-30' : 'opacity-0'}`}
            style={{ filter: 'saturate(0.6) brightness(1.8)' }}
        />
    );
}

/* ─── Shared SVG Icons ─── */
const icons = {
    user: (
        <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
        </svg>
    ),
    lock: (
        <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
    ),
    eyeOff: (
        <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
        </svg>
    ),
    eye: (
        <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    ),
    check: (
        <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    ),
    arrow: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
        </svg>
    ),
    spinner: (
        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
    ),
    alertCircle: (
        <svg className="w-4 h-4 flex-shrink-0 text-pink" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
    ),
    successCircle: (
        <svg className="w-4 h-4 flex-shrink-0 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="16 10 11 15 8 12" />
        </svg>
    ),
    role: (
        <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01z" />
        </svg>
    ),
};

/* ─── Password Input Component ─── */
function PasswordInput({
    id, value, onChange, placeholder, label, t
}: {
    id: string; value: string; onChange: (v: string) => void;
    placeholder: string; label: string; t: (key: string) => string;
}) {
    const [show, setShow] = useState(false);
    return (
        <div className="mb-5">
            <label htmlFor={id} className="block text-xs font-semibold text-navy/50 uppercase tracking-wide mb-2">
                {label}
            </label>
            <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy/25 pointer-events-none">
                    {icons.lock}
                </span>
                <input
                    type={show ? 'text' : 'password'}
                    id={id}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className="w-full pl-11 pr-11 py-3 rounded-xl bg-bg/70 border border-navy/[0.08] text-navy text-sm placeholder:text-navy/25 focus:outline-none focus:border-pink/40 focus:bg-white focus:shadow-[0_0_0_3px_rgba(233,30,140,0.06)] transition-all duration-200"
                    required
                    autoComplete={id.includes('confirm') ? 'new-password' : 'current-password'}
                />
                <button
                    type="button"
                    onClick={() => setShow(!show)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-navy/25 hover:text-navy/50 transition-colors cursor-pointer p-0.5"
                    tabIndex={-1}
                    aria-label={show ? t('auth.hide_password') : t('auth.show_password')}
                >
                    {show ? icons.eyeOff : icons.eye}
                </button>
            </div>
        </div>
    );
}

/* ─── Main Auth Page ─── */
export default function Authentification() {
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();
    const activeLang = i18n.language?.startsWith('ar') ? 'ar' : i18n.language?.startsWith('en') ? 'en' : 'fr';
    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [langOpen, setLangOpen] = useState(false);

    // Shared
    const [fullName, setFullName] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [shake, setShake] = useState(false);

    // Login-only
    const [stayLogged, setStayLogged] = useState(false);

    // Register-only
    const [confirmPassword, setConfirmPassword] = useState('');
    const [role, setRole] = useState('doctor');

    // Check for existing session on mount
    useEffect(() => {
        (async () => {
            try {
                const result = await (window as any).ipcRenderer.checkAuth();
                if (result?.status === 'success') {
                    navigate('/dashboard', { replace: true });
                }
            } catch {
                // No saved session — stay on login
            }
        })();
    }, [navigate]);

    const triggerShake = () => {
        setShake(true);
        setTimeout(() => setShake(false), 600);
    };

    const resetForm = () => {
        setFullName('');
        setPassword('');
        setConfirmPassword('');
        setRole('doctor');
        setError('');
        setSuccess('');
    };

    const switchMode = (newMode: 'login' | 'register') => {
        resetForm();
        setMode(newMode);
    };

    /* ── Login handler ── */
    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setIsLoading(true);

        try {
            const result = await (window as any).ipcRenderer.login(fullName, password, stayLogged);
            if (result?.status === 'success') {
                navigate('/dashboard', { replace: true });
            } else {
                setError(result?.message || t('auth.login.error_invalid'));
                triggerShake();
            }
        } catch {
            setError(t('auth.login.error_connection'));
            triggerShake();
        } finally {
            setIsLoading(false);
        }
    };

    /* ── Register handler ── */
    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        // Client-side validation
        if (password.length < 6) {
            setError(t('auth.register.error_password_short'));
            triggerShake();
            return;
        }
        if (password !== confirmPassword) {
            setError(t('auth.register.error_passwords_mismatch'));
            triggerShake();
            return;
        }

        setIsLoading(true);

        try {
            const result = await (window as any).ipcRenderer.createUser({
                fullName,
                password,
                role,
            });
            if (result?.status === 'success') {
                setSuccess(t('auth.register.success'));
                // Switch to login after a brief delay
                setTimeout(() => {
                    resetForm();
                    setMode('login');
                    setFullName(fullName); // pre-fill the name
                }, 1500);
            } else {
                setError(result?.message || t('auth.register.error_creation'));
                triggerShake();
            }
        } catch {
            setError(t('auth.register.error_creation'));
            triggerShake();
        } finally {
            setIsLoading(false);
        }
    };

    const isLogin = mode === 'login';
    const prefix = isLogin ? 'auth.login' : 'auth.register';

    return (
        <div className="flex min-h-screen w-full">
            {/* ── Left Panel — navy gradient + heart ── */}
            <div className="hidden lg:flex lg:w-[45%] xl:w-[48%] relative overflow-hidden bg-gradient-to-br from-navy via-navy-dark to-[#0f1528] flex-col items-center justify-center">
                {/* Decorative radials */}
                <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-pink/[0.06] blur-[100px]" />
                    <div className="absolute bottom-[-15%] right-[-5%] w-[50%] h-[50%] rounded-full bg-navy-light/30 blur-[80px]" />
                </div>

                {/* Heart animation */}
                <div className="relative z-10 flex items-center justify-center">
                    <HeartCanvas />
                </div>

                {/* Branding below heart */}
                <div className="relative z-10 mt-6 text-center">
                    <div className="flex items-center justify-center gap-3 mb-3">
                        <img src="./logo.png" alt="Ausculta" className="w-10 h-10 object-contain" />
                        <div className="inline-flex">
                            <span className="text-3xl tracking-tight text-white font-bold">Ausc</span>
                            <span className="text-3xl tracking-tight text-pink font-bold">ulta</span>
                        </div>
                    </div>
                    <p className="text-white/30 text-sm max-w-[280px] leading-relaxed">
                        {t('auth.tagline')}
                    </p>
                </div>

                {/* Language switcher — bottom left */}
                <div className="absolute bottom-8 left-8 z-20">
                    {/* Trigger: 3 dots */}
                    <button
                        onClick={() => setLangOpen(!langOpen)}
                        className="flex items-center gap-2 cursor-pointer group"
                        aria-label="Change language"
                    >
                        {[...Array(3)].map((_, i) => (
                            <div
                                key={i}
                                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                                    langOpen
                                        ? 'bg-pink scale-110'
                                        : 'bg-white/30 group-hover:bg-white/60'
                                }`}
                            />
                        ))}
                    </button>

                    {/* Popup */}
                    {langOpen && (
                        <div
                            className="absolute bottom-full left-0 mb-3 bg-navy-light/90 backdrop-blur-md border border-white/10 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.3)] p-1.5 flex flex-col gap-0.5 min-w-[140px]"
                            style={{ animation: 'scaleIn 0.2s ease-out' }}
                        >
                            {[
                                { code: 'fr', label: 'Français', flag: 'FR' },
                                { code: 'en', label: 'English', flag: 'EN' },
                                { code: 'ar', label: 'العربية', flag: 'عر' },
                            ].map((lang) => (
                                <button
                                    key={lang.code}
                                    onClick={() => {
                                        i18n.changeLanguage(lang.code);
                                        setLangOpen(false);
                                    }}
                                    className={`
                                        w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer flex items-center justify-between
                                        ${activeLang === lang.code
                                            ? 'bg-pink/15 text-pink font-bold'
                                            : 'text-white/70 hover:bg-white/10 hover:text-white'
                                        }
                                    `}
                                >
                                    <span>{lang.label}</span>
                                    <span className="text-[10px] opacity-50">{lang.flag}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Right Panel — form ── */}
            <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 bg-bg relative overflow-hidden">
                {/* Background blurs */}
                <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-[10%] right-[10%] w-[300px] h-[300px] rounded-full bg-pink/[0.03] blur-[80px]" />
                    <div className="absolute bottom-[10%] left-[10%] w-[250px] h-[250px] rounded-full bg-navy/[0.03] blur-[80px]" />
                </div>


                {/* Mobile-only logo */}
                <div className="lg:hidden flex items-center gap-2.5 mb-10">
                    <img src="./logo.png" alt="Ausculta" className="w-9 h-9 object-contain" />
                    <div className="inline-flex">
                        <span className="text-2xl tracking-tight text-navy font-bold">Ausc</span>
                        <span className="text-2xl tracking-tight text-pink font-bold">ulta</span>
                    </div>
                </div>

                {/* Form container */}
                <div
                    key={mode}
                    className={`relative z-10 w-full max-w-[420px]`}
                    style={{ animation: shake ? 'headShake 0.6s ease-in-out' : 'scaleIn 0.4s ease-out both' }}
                >
                    {/* Header */}
                    <div className="mb-8">
                        <h1 className="text-[1.75rem] font-bold text-navy leading-tight">
                            {t(`${prefix}.greeting`)}
                        </h1>
                        <p className="text-navy/40 text-sm mt-2">
                            {t(`${prefix}.subtitle`)}
                        </p>
                    </div>

                    {/* Card */}
                    <form
                        onSubmit={isLogin ? handleLogin : handleRegister}
                        className="bg-white rounded-2xl p-7 shadow-[0_4px_24px_rgba(30,42,86,0.07)] border border-navy/[0.04]"
                    >
                        {/* Error banner */}
                        {error && (
                            <div className="mb-5 flex items-center gap-2.5 bg-pink/[0.06] border border-pink/15 rounded-xl px-4 py-3 text-sm text-pink-dark"
                                style={{ animation: 'scaleIn 0.3s ease-out' }}>
                                {icons.alertCircle}
                                {error}
                            </div>
                        )}

                        {/* Success banner */}
                        {success && (
                            <div className="mb-5 flex items-center gap-2.5 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700"
                                style={{ animation: 'scaleIn 0.3s ease-out' }}>
                                {icons.successCircle}
                                {success}
                            </div>
                        )}

                        {/* Full Name field */}
                        <div className="mb-5">
                            <label htmlFor="auth-fullname" className="block text-xs font-semibold text-navy/50 uppercase tracking-wide mb-2">
                                {t(`${prefix}.full_name`)}
                            </label>
                            <div className="relative">
                                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy/25 pointer-events-none">
                                    {icons.user}
                                </span>
                                <input
                                    type="text"
                                    id="auth-fullname"
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                    placeholder={t(`${prefix}.full_name_placeholder`)}
                                    className="w-full pl-11 pr-4 py-3 rounded-xl bg-bg/70 border border-navy/[0.08] text-navy text-sm placeholder:text-navy/25 focus:outline-none focus:border-pink/40 focus:bg-white focus:shadow-[0_0_0_3px_rgba(233,30,140,0.06)] transition-all duration-200"
                                    required
                                    autoComplete="username"
                                />
                            </div>
                        </div>

                        {/* Password field */}
                        <PasswordInput
                            id="auth-password"
                            value={password}
                            onChange={setPassword}
                            placeholder={t(`${prefix}.password_placeholder`)}
                            label={t(`${prefix}.password`)}
                            t={t}
                        />

                        {/* ── Register-only fields ── */}
                        {!isLogin && (
                            <>
                                {/* Confirm password */}
                                <PasswordInput
                                    id="auth-confirm-password"
                                    value={confirmPassword}
                                    onChange={setConfirmPassword}
                                    placeholder={t('auth.register.confirm_password_placeholder')}
                                    label={t('auth.register.confirm_password')}
                                    t={t}
                                />

                                {/* Role select */}
                                <div className="mb-5">
                                    <label htmlFor="auth-role" className="block text-xs font-semibold text-navy/50 uppercase tracking-wide mb-2">
                                        {t('auth.register.role')}
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy/25 pointer-events-none">
                                            {icons.role}
                                        </span>
                                        <select
                                            id="auth-role"
                                            value={role}
                                            onChange={(e) => setRole(e.target.value)}
                                            className="w-full pl-11 pr-4 py-3 rounded-xl bg-bg/70 border border-navy/[0.08] text-navy text-sm appearance-none focus:outline-none focus:border-pink/40 focus:bg-white focus:shadow-[0_0_0_3px_rgba(233,30,140,0.06)] transition-all duration-200 cursor-pointer"
                                        >
                                            <option value="doctor">{t('auth.register.role_doctor')}</option>
                                            <option value="assistant">{t('auth.register.role_assistant')}</option>
                                            <option value="admin">{t('auth.register.role_admin')}</option>
                                        </select>
                                        {/* Dropdown chevron */}
                                        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-navy/25 pointer-events-none">
                                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="6 9 12 15 18 9" />
                                            </svg>
                                        </span>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* ── Login-only: stay logged checkbox ── */}
                        {isLogin && (
                            <div className="flex items-center mb-7">
                                <label htmlFor="auth-stay-logged" className="flex items-center gap-2.5 cursor-pointer group">
                                    <div className="relative">
                                        <input
                                            type="checkbox"
                                            id="auth-stay-logged"
                                            checked={stayLogged}
                                            onChange={(e) => setStayLogged(e.target.checked)}
                                            className="sr-only peer"
                                        />
                                        <div className="w-[18px] h-[18px] rounded-md border-2 border-navy/15 bg-bg/50 transition-all duration-200 peer-checked:bg-pink peer-checked:border-pink flex items-center justify-center group-hover:border-navy/25">
                                            {stayLogged && icons.check}
                                        </div>
                                    </div>
                                    <span className="text-sm text-navy/50 group-hover:text-navy/70 transition-colors select-none">
                                        {t('auth.login.stay_logged')}
                                    </span>
                                </label>
                            </div>
                        )}

                        {/* Register mode: add some bottom margin */}
                        {!isLogin && <div className="mb-2" />}

                        {/* Submit button */}
                        <button
                            type="submit"
                            id="auth-submit"
                            disabled={isLoading}
                            className={`
                                w-full py-3.5 rounded-xl text-sm font-semibold text-white
                                ${isLogin
                                    ? 'bg-gradient-to-r from-navy to-navy-light hover:from-navy-light hover:to-navy shadow-[0_4px_16px_rgba(30,42,86,0.2)] hover:shadow-[0_6px_24px_rgba(30,42,86,0.3)]'
                                    : 'bg-gradient-to-r from-pink to-pink-light hover:from-pink-light hover:to-pink shadow-[0_4px_16px_rgba(233,30,140,0.2)] hover:shadow-[0_6px_24px_rgba(233,30,140,0.3)]'
                                }
                                active:scale-[0.98]
                                transition-all duration-200 cursor-pointer
                                disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100
                                flex items-center justify-center gap-2
                            `}
                        >
                            {isLoading ? (
                                <>
                                    {icons.spinner}
                                    {t(`${prefix}.loading`)}
                                </>
                            ) : (
                                <>
                                    {t(`${prefix}.submit`)}
                                    {icons.arrow}
                                </>
                            )}
                        </button>
                    </form>

                    {/* Toggle login / register */}
                    <p className="text-center text-navy/40 text-sm mt-6">
                        {isLogin ? t('auth.login.no_account') : t('auth.register.has_account')}{' '}
                        <button
                            type="button"
                            onClick={() => switchMode(isLogin ? 'register' : 'login')}
                            className="text-pink font-semibold hover:text-pink-dark transition-colors cursor-pointer"
                        >
                            {isLogin ? t('auth.login.register_link') : t('auth.register.login_link')}
                        </button>
                    </p>

                    {/* Footer note */}
                    <p className="text-center text-navy/25 text-xs mt-4">
                        {t('auth.footer', { year: new Date().getFullYear() })}
                    </p>
                </div>
            </div>
        </div>
    );
}