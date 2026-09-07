import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DoctorProfile } from "../../../types/doctor";
import type { ReminderList, ReminderOutcome, ReminderTarget } from "../../../types/reminder";

/**
 * Tomorrow's appointment reminders, sent over WhatsApp click-to-chat.
 *
 * The honesty problem this component is built around: clicking "Remind" opens
 * WhatsApp with the message loaded, and that is the last thing Ausculta knows.
 * Whether the patient was actually messaged — or WhatsApp said the number is
 * not registered, or asked to link a device — happens on the other side of
 * shell.openExternal and never comes back. So the row does not go green on its
 * own; it asks the person who watched it happen. Anything else would be a
 * "reminded ✓" that means nothing.
 *
 * What the panel CAN know in advance is which numbers are hopeless: a fixed
 * line is never on WhatsApp. Those rows are greyed out with the reason, so no
 * one spends a click discovering it (see electron/services/phone.ts).
 */

/** Languages a reminder can be written in — the three the app is localised to. */
type MessageLanguage = 'fr' | 'ar' | 'en';

const MESSAGE_LANGUAGES: MessageLanguage[] = ['fr', 'ar', 'en'];

/**
 * The message language, remembered separately from the interface language: a
 * doctor working in French routinely has patients who read Arabic, so the two
 * are genuinely different settings. Falls back to the prescription language,
 * which is the existing answer to "what language do this practice's patients
 * read", before falling back to the UI.
 */
function initialMessageLanguage(uiLanguage: string): MessageLanguage {
    const stored = localStorage.getItem('reminder_language');
    if (stored === 'fr' || stored === 'ar' || stored === 'en') return stored;

    const prescription = localStorage.getItem('prescription_language');
    if (prescription === 'fr' || prescription === 'en') return prescription;

    const base = (uiLanguage || 'fr').split('-')[0];
    return base === 'ar' || base === 'fr' ? base : 'en';
}

const PILL = 'text-[9px] font-bold px-2 py-1 rounded-full uppercase tracking-wider whitespace-nowrap';
const ICON_BUTTON = 'w-7 h-7 rounded-lg border flex items-center justify-center transition-colors disabled:opacity-40';

/** The WhatsApp mark, so the button is recognisable without reading it. */
function WhatsAppIcon({ className }: { className: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.347-.347.52-.52.174-.174.232-.298.347-.497.116-.198.058-.372-.03-.52-.086-.148-.66-1.59-.904-2.178-.24-.58-.484-.5-.664-.508-.172-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.015-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.695.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.414-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
        </svg>
    );
}

export default function TomorrowReminders({ doctor }: { doctor: DoctorProfile }) {
    const { t, i18n } = useTranslation();
    const locale = i18n.language || 'fr';

    const [list, setList] = useState<ReminderList>({ date: '', targets: [] });
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [messageLanguage, setMessageLanguage] = useState<MessageLanguage>(() => initialMessageLanguage(locale));

    const load = useCallback(async () => {
        try {
            const result = await window.ipcRenderer.getTomorrowReminders(doctor.id);
            if (result?.data) setList(result.data);
        } catch (loadError) {
            console.error("Failed to load tomorrow's reminders:", loadError);
        } finally {
            setLoading(false);
        }
    }, [doctor.id]);

    useEffect(() => {
        load();
    }, [load]);

    const chooseLanguage = (language: MessageLanguage) => {
        setMessageLanguage(language);
        localStorage.setItem('reminder_language', language);
    };

    /**
     * The reminder text. Name, date, time and where — and deliberately nothing
     * clinical: this lands on a phone that may be shared, and on Meta's
     * servers. The appointment's `reason` is never interpolated here.
     */
    const buildMessage = (target: ReminderTarget): string => {
        const time = target.appointmentDatetime.split('T')[1]?.substring(0, 5) ?? '';
        const date = new Date(target.appointmentDatetime).toLocaleDateString(messageLanguage, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
        });
        // Reuses the bilingual letterhead fields the colorful prescription
        // already fills in, so an Arabic reminder names the practice in Arabic.
        const clinic = messageLanguage === 'ar'
            ? doctor.clinicNameAr?.trim() || doctor.fullNameAr?.trim() || doctor.clinicName?.trim() || doctor.fullName
            : doctor.clinicName?.trim() || doctor.fullName;

        return t('dashboard.reminders.message', {
            lng: messageLanguage,
            name: target.patientName,
            date,
            time,
            clinic,
        });
    };

    const handleRemind = async (target: ReminderTarget) => {
        setBusyId(target.appointmentId);
        setError(null);
        try {
            const result = await window.ipcRenderer.openWhatsAppReminder(target.appointmentId, buildMessage(target));
            if (result?.status !== 'success') {
                const generic = t('dashboard.reminders.error.generic');
                setError(result?.code ? t(`dashboard.reminders.error.${result.code}`, generic) : generic);
            }
            // Reloaded rather than patched in place: the appointment may have
            // been cancelled or moved since the panel was drawn, and the
            // refusal we just got is the first we heard of it.
            await load();
        } catch (remindError) {
            console.error("openWhatsAppReminder failed:", remindError);
            setError(t('dashboard.reminders.error.generic'));
        } finally {
            setBusyId(null);
        }
    };

    const handleOutcome = async (target: ReminderTarget, outcome: ReminderOutcome) => {
        setBusyId(target.appointmentId);
        try {
            await window.ipcRenderer.setReminderOutcome(target.appointmentId, outcome);
            await load();
        } catch (outcomeError) {
            console.error("setReminderOutcome failed:", outcomeError);
        } finally {
            setBusyId(null);
        }
    };

    const counts = useMemo(() => {
        let toRemind = 0;
        let reminded = 0;
        let unreachable = 0;
        for (const target of list.targets) {
            if (target.reachability !== 'mobile') unreachable++;
            else if (target.reminderStatus === 'sent') reminded++;
            // 'opened' and 'failed' both still want attention, so they count
            // as outstanding rather than getting a category of their own.
            else toRemind++;
        }
        return { toRemind, reminded, unreachable };
    }, [list.targets]);

    const dateLabel = list.date
        ? new Date(`${list.date}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' })
        : '';

    function renderAction(target: ReminderTarget) {
        const busy = busyId === target.appointmentId;

        // Predictably hopeless: no number, a fixed line, or unparsable text.
        // Refused here rather than after a wasted click into WhatsApp.
        if (target.reachability !== 'mobile') {
            return (
                <span className={`${PILL} bg-gray-100 text-gray-500 border border-gray-200`}>
                    {t(`dashboard.reminders.state.${target.reachability}`)}
                </span>
            );
        }

        if (target.reminderStatus === 'opened') {
            return (
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-amber-600 whitespace-nowrap">
                        {t('dashboard.reminders.asking')}
                    </span>
                    <button
                        type="button"
                        onClick={() => handleOutcome(target, 'sent')}
                        disabled={busy}
                        title={t('dashboard.reminders.confirm_sent')}
                        aria-label={t('dashboard.reminders.confirm_sent')}
                        className={`${ICON_BUTTON} bg-green-50 border-green-200 text-green-600 hover:bg-green-100`}
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        onClick={() => handleOutcome(target, 'failed')}
                        disabled={busy}
                        title={t('dashboard.reminders.confirm_failed')}
                        aria-label={t('dashboard.reminders.confirm_failed')}
                        className={`${ICON_BUTTON} bg-red-50 border-red-200 text-red-500 hover:bg-red-100`}
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            );
        }

        if (target.reminderStatus === 'sent' || target.reminderStatus === 'failed') {
            const sent = target.reminderStatus === 'sent';
            return (
                <div className="flex items-center gap-1.5">
                    <span className={`${PILL} ${sent
                        ? 'bg-green-50 text-green-700 border border-green-200'
                        : 'bg-amber-50 text-amber-600 border border-amber-200'}`}>
                        {t(`dashboard.reminders.state.${target.reminderStatus}`)}
                    </span>
                    <button
                        type="button"
                        onClick={() => handleRemind(target)}
                        disabled={busy}
                        title={t('dashboard.reminders.resend')}
                        aria-label={t('dashboard.reminders.resend')}
                        className={`${ICON_BUTTON} bg-white border-gray-200 text-gray-400 hover:text-[#25D366] hover:border-[#25D366]/40`}
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992V4.356m-.238 4.992a8.25 8.25 0 0 0-15.6 3.007m-1.2 5.297v-4.992h4.992m-4.754 0a8.25 8.25 0 0 0 15.6-3.008" />
                        </svg>
                    </button>
                </div>
            );
        }

        return (
            <button
                type="button"
                onClick={() => handleRemind(target)}
                disabled={busy}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#25D366] hover:bg-[#1da851] disabled:opacity-50 text-white text-[11px] font-bold shadow-sm shadow-[#25D366]/20 transition-colors"
            >
                <WhatsAppIcon className="w-3.5 h-3.5" />
                {t('dashboard.reminders.action')}
            </button>
        );
    }

    return (
        <div className="bg-white rounded-3xl p-6 border border-white/40 shadow-[0_4px_20px_rgba(30,42,86,0.03)]">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-4 border-b border-gray-50 pb-3">
                <div className="group relative flex items-center gap-2">
                    <h2 className="text-base font-bold text-navy">{t('dashboard.reminders.title')}</h2>
                    <svg className="w-4 h-4 text-gray-300 group-hover:text-pink transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
                    </svg>
                    {/* Opacity rather than display so there is no layout shift, and
                        centred with a translate so it lands correctly in RTL too. */}
                    <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 z-20 w-60 rounded-xl bg-navy px-3 py-2 text-[11px] font-semibold leading-snug text-white text-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                        {t('dashboard.reminders.hint')}
                    </span>
                </div>

                <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{dateLabel}</span>
                    <div
                        className="flex items-center gap-0.5 rounded-xl bg-gray-50 p-0.5 border border-gray-100"
                        title={t('dashboard.reminders.language_label')}
                    >
                        {MESSAGE_LANGUAGES.map((language) => (
                            <button
                                key={language}
                                type="button"
                                onClick={() => chooseLanguage(language)}
                                className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase transition-colors ${
                                    messageLanguage === language
                                        ? 'bg-white text-navy shadow-sm'
                                        : 'text-gray-400 hover:text-navy'
                                }`}
                            >
                                {language}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-8">
                    <div className="w-6 h-6 border-2 border-pink border-t-transparent rounded-full animate-spin" />
                </div>
            ) : list.targets.length === 0 ? (
                <div className="py-8 text-center text-sm font-semibold text-gray-400">
                    {t('dashboard.reminders.empty')}
                </div>
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                        {[
                            { value: counts.toRemind, label: t('dashboard.reminders.stats.to_remind'), className: 'bg-pink/5 text-pink border-pink/20' },
                            { value: counts.reminded, label: t('dashboard.reminders.stats.reminded'), className: 'bg-green-50 text-green-700 border-green-200' },
                            { value: counts.unreachable, label: t('dashboard.reminders.stats.unreachable'), className: 'bg-gray-100 text-gray-500 border-gray-200' },
                        ].filter((chip) => chip.value > 0).map((chip) => (
                            <span key={chip.label} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold ${chip.className}`}>
                                <span className="font-black">{chip.value}</span>
                                {chip.label}
                            </span>
                        ))}
                    </div>

                    {error && (
                        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600">
                            {error}
                        </div>
                    )}

                    <div className="divide-y divide-gray-50 max-h-[320px] overflow-y-auto pr-1">
                        {list.targets.map((target) => {
                            const time = target.appointmentDatetime.split('T')[1]?.substring(0, 5) || '--:--';
                            const reachable = target.reachability === 'mobile';
                            return (
                                <div
                                    key={target.appointmentId}
                                    className={`flex items-center justify-between gap-3 py-3 px-2 rounded-xl transition-colors ${
                                        reachable ? 'hover:bg-gray-50/60' : 'opacity-60'
                                    }`}
                                >
                                    <div className="flex items-center gap-4 min-w-0">
                                        <span className="text-xs font-black text-gray-400 w-12 flex-shrink-0">{time}</span>
                                        <div className="min-w-0">
                                            <span className="font-bold text-sm text-navy block truncate">{target.patientName}</span>
                                            {/* A phone number reads left-to-right even in the Arabic UI. */}
                                            <span className="text-[11px] text-gray-400 block truncate" dir="ltr">
                                                {target.phoneDisplay || '—'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex-shrink-0">{renderAction(target)}</div>
                                </div>
                            );
                        })}
                    </div>

                    <p className="mt-3 pt-3 border-t border-gray-50 text-[10px] text-gray-400 font-medium leading-snug">
                        {t('dashboard.reminders.disclaimer')}
                    </p>
                </>
            )}
        </div>
    );
}
