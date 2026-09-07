import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Front-desk accounts, managed by the doctor.
 *
 * Only assistants appear as editable: the doctor's own account owns the
 * doctor_profile row that every appointment, consultation and prescription
 * hangs off, so deleting it would take the practice's clinical history with it.
 * The main process refuses that outright — this just does not offer it.
 */
export default function UserAccounts({ currentUserId }: { currentUserId: number | null }) {
    const { t } = useTranslation();
    const [users, setUsers] = useState<UserSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);

    const [showForm, setShowForm] = useState(false);
    const [newName, setNewName] = useState('');
    const [newPassword, setNewPassword] = useState('');

    const [resetFor, setResetFor] = useState<number | null>(null);
    const [resetPassword, setResetPassword] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await window.ipcRenderer.listUsers();
            if (result?.status === 'success' && result.data) {
                setUsers(result.data);
                setError('');
            } else {
                setError(result?.message || t('settings.accounts.errors.load'));
            }
        } catch {
            setError(t('settings.accounts.errors.load'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => { void load(); }, [load]);

    /** Clears both banners so a new action never shows the previous outcome. */
    const resetFeedback = () => { setError(''); setNotice(''); };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        resetFeedback();
        setBusy(true);
        try {
            const result = await window.ipcRenderer.createAssistant(newName.trim(), newPassword);
            if (result?.status === 'success') {
                setNotice(t('settings.accounts.created', { name: newName.trim() }));
                setNewName('');
                setNewPassword('');
                setShowForm(false);
                await load();
            } else {
                setError(result?.message || t('settings.accounts.errors.create'));
            }
        } catch {
            setError(t('settings.accounts.errors.create'));
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async (user: UserSummary) => {
        if (!window.confirm(t('settings.accounts.delete_confirm', { name: user.fullName }))) return;
        resetFeedback();
        setBusy(true);
        try {
            const result = await window.ipcRenderer.deleteUser(user.id);
            if (result?.status === 'success') {
                setNotice(t('settings.accounts.deleted', { name: user.fullName }));
                await load();
            } else {
                setError(result?.message || t('settings.accounts.errors.delete'));
            }
        } catch {
            setError(t('settings.accounts.errors.delete'));
        } finally {
            setBusy(false);
        }
    };

    const handleReset = async (e: React.FormEvent) => {
        e.preventDefault();
        if (resetFor === null) return;
        resetFeedback();
        setBusy(true);
        try {
            const result = await window.ipcRenderer.resetUserPassword(resetFor, resetPassword);
            if (result?.status === 'success') {
                setNotice(t('settings.accounts.password_reset'));
                setResetFor(null);
                setResetPassword('');
            } else {
                setError(result?.message || t('settings.accounts.errors.reset'));
            }
        } catch {
            setError(t('settings.accounts.errors.reset'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h3 className="text-base font-bold text-navy">{t('settings.accounts.title')}</h3>
                    <p className="text-xs text-navy/50 mt-1 max-w-prose">{t('settings.accounts.subtitle')}</p>
                </div>
                <button
                    type="button"
                    onClick={() => { resetFeedback(); setShowForm(open => !open); }}
                    className="flex-shrink-0 px-4 py-2 rounded-2xl border border-navy/10 bg-white text-navy/70 hover:text-navy hover:bg-navy/[0.03] text-xs font-bold transition-colors cursor-pointer select-none"
                >
                    {showForm ? t('settings.accounts.cancel') : t('settings.accounts.add')}
                </button>
            </div>

            {error && (
                <div className="px-4 py-3 rounded-2xl bg-pink/[0.06] border border-pink/15 text-sm text-pink-dark">
                    {error}
                </div>
            )}
            {notice && (
                <div className="px-4 py-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">
                    {notice}
                </div>
            )}

            {showForm && (
                <form onSubmit={handleCreate} className="p-5 rounded-3xl bg-navy/[0.02] border border-navy/[0.06] space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="flex flex-col gap-2">
                            <span className="text-[11px] font-semibold text-navy/50 uppercase tracking-wide">
                                {t('settings.accounts.name')}
                            </span>
                            <input
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                autoComplete="off"
                                required
                                className="px-4 py-2.5 rounded-2xl bg-white border border-navy/10 text-navy text-sm focus:outline-none focus:border-pink/40 transition-colors"
                            />
                        </label>
                        <label className="flex flex-col gap-2">
                            <span className="text-[11px] font-semibold text-navy/50 uppercase tracking-wide">
                                {t('settings.accounts.password')}
                            </span>
                            <input
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                autoComplete="new-password"
                                minLength={6}
                                required
                                className="px-4 py-2.5 rounded-2xl bg-white border border-navy/10 text-navy text-sm focus:outline-none focus:border-pink/40 transition-colors"
                            />
                        </label>
                    </div>
                    <p className="text-[11px] text-navy/40">{t('settings.accounts.password_hint')}</p>
                    <button
                        type="submit"
                        disabled={busy}
                        className="px-6 py-2.5 rounded-2xl bg-gradient-to-r from-pink to-pink-light text-white text-xs font-bold shadow-[0_4px_14px_rgba(233,30,140,0.25)] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none"
                    >
                        {t('settings.accounts.create')}
                    </button>
                </form>
            )}

            {loading ? (
                <p className="text-sm text-navy/40">{t('settings.accounts.loading')}</p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {users.map((user) => {
                        const isSelf = user.id === currentUserId;
                        const isAssistant = user.role === 'assistant';
                        return (
                            <li
                                key={user.id}
                                className="flex items-center gap-4 p-4 rounded-3xl bg-white border border-navy/[0.06]"
                            >
                                <div className={`w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center font-extrabold text-sm text-white ${isAssistant ? 'bg-navy/40' : 'bg-navy'}`}>
                                    {user.fullName.charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-bold text-navy truncate">
                                        {user.fullName}
                                        {isSelf && (
                                            <span className="ml-2 text-[10px] font-semibold text-navy/35 uppercase tracking-wide">
                                                {t('settings.accounts.you')}
                                            </span>
                                        )}
                                    </p>
                                    <p className="text-[11px] text-navy/45">{t(`roles.${user.role}`)}</p>
                                </div>
                                {isAssistant && (
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                resetFeedback();
                                                setResetPassword('');
                                                setResetFor(current => (current === user.id ? null : user.id));
                                            }}
                                            className="px-3 py-1.5 rounded-xl border border-navy/10 text-navy/60 hover:text-navy hover:bg-navy/[0.03] text-[11px] font-bold transition-colors cursor-pointer select-none"
                                        >
                                            {t('settings.accounts.reset')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(user)}
                                            disabled={busy}
                                            className="px-3 py-1.5 rounded-xl border border-navy/10 text-navy/50 hover:text-red-500 hover:border-red-200 text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50 select-none"
                                        >
                                            {t('settings.accounts.delete')}
                                        </button>
                                    </div>
                                )}
                            </li>
                        );
                    })}

                    {resetFor !== null && (
                        <li>
                            <form onSubmit={handleReset} className="flex items-end gap-3 flex-wrap p-4 rounded-3xl bg-navy/[0.02] border border-navy/[0.06]">
                                <label className="flex flex-col gap-2 flex-1 min-w-[220px]">
                                    <span className="text-[11px] font-semibold text-navy/50 uppercase tracking-wide">
                                        {t('settings.accounts.new_password')}
                                    </span>
                                    <input
                                        type="password"
                                        value={resetPassword}
                                        onChange={(e) => setResetPassword(e.target.value)}
                                        autoComplete="new-password"
                                        minLength={6}
                                        required
                                        className="px-4 py-2.5 rounded-2xl bg-white border border-navy/10 text-navy text-sm focus:outline-none focus:border-pink/40 transition-colors"
                                    />
                                </label>
                                <button
                                    type="submit"
                                    disabled={busy}
                                    className="px-5 py-2.5 rounded-2xl bg-navy text-white text-xs font-bold hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50 select-none"
                                >
                                    {t('settings.accounts.confirm_reset')}
                                </button>
                            </form>
                        </li>
                    )}
                </ul>
            )}
        </div>
    );
}
