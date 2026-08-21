/**
 * Algerian phone numbers, as a receptionist actually types them, turned into
 * the digits WhatsApp needs.
 *
 * patients.phone_number is free text and the column has seen everything:
 * "0555 12 34 56", "05.55.12.34.56", "+213 555 123 456", "0770123456 /
 * 0555123456". wa.me accepts none of it — the URL wants bare international
 * digits with no '+', no separators and no trunk '0'.
 *
 * The other half of the job is refusing to try. A fixed line is never on
 * WhatsApp, so a reminder aimed at one is a guaranteed dead end, and saying so
 * in the panel BEFORE anyone clicks is the only feedback this channel can
 * offer: once the URL is handed to the OS, the app never learns what WhatsApp
 * did with it.
 *
 * Algeria only. Ausculta is sold to Algerian practices (prices are in DA), so
 * a bare "0555…" is unambiguous here in a way it would not be in a multi-
 * country build — that assumption is the whole reason this file can be 60
 * lines instead of a libphonenumber dependency.
 */

import type { PhoneReachability } from "../../types/reminder";

/** Algeria's country calling code. */
const COUNTRY_CODE = '213';

/**
 * National significant number lengths.
 *
 * A mobile always carries 9 digits after the trunk '0' (0555 12 34 56). Fixed
 * lines carry 8 in the older form still printed on most cards (021 45 67 89)
 * and 9 in the one Algeria has been migrating to, so both are accepted. That
 * leniency costs nothing: a fixed line is refused either way, and the only
 * difference is whether the panel can say "landline" or falls back to "invalid".
 */
const MOBILE_NSN_LENGTH = 9;
const LANDLINE_NSN_LENGTHS = [8, 9];

/** Shortest NSN any Algerian number can have — the guard for peeling a trunk '0'. */
const MIN_NSN_LENGTH = 8;

/** First NSN digit of a mobile: Mobilis (6), Djezzy (7), Ooredoo (5). */
const MOBILE_PREFIXES = ['5', '6', '7'];

/** First NSN digit of a fixed line. */
const LANDLINE_PREFIXES = ['2', '3', '4'];

/**
 * Separators that mean "here is a second number", never "here is the next
 * group of digits". Spaces, dots and dashes are excluded on purpose: they
 * group digits inside a single number, so splitting on them would shred
 * "0555 12 34 56" into four useless fragments.
 */
const NUMBER_SEPARATORS = /[/,;\n]|\bou\b|\bor\b/i;

export interface NormalizedPhone {
    reachability: PhoneReachability;
    /** Bare international digits for wa.me ('213555123456'); '' unless mobile. */
    waNumber: string;
    /** '+213 555 12 34 56' for a mobile; the raw text as typed otherwise. */
    display: string;
}

/**
 * Classifies one already-stripped run of digits.
 *
 * Prefixes are peeled in the only order they can legally appear — international
 * access code, country code, trunk zero — with a length guard on each so a bare
 * NSN is never mistaken for a prefixed one. Peeling all three in sequence is
 * what makes the malformed-but-common "+213 0555…" (country code AND trunk
 * zero) parse instead of being rejected.
 *
 * A mobile is checked for first: the two prefix sets do not overlap, but the
 * mobile answer is the only one that can carry a message, so it decides.
 */
function classify(digits: string): NormalizedPhone {
    let nsn = digits;
    if (nsn.startsWith('00')) nsn = nsn.slice(2);
    if (nsn.length > MOBILE_NSN_LENGTH && nsn.startsWith(COUNTRY_CODE)) nsn = nsn.slice(COUNTRY_CODE.length);
    if (nsn.length > MIN_NSN_LENGTH && nsn.startsWith('0')) nsn = nsn.slice(1);

    const lead = nsn[0] ?? '';

    if (nsn.length === MOBILE_NSN_LENGTH && MOBILE_PREFIXES.includes(lead)) {
        return {
            reachability: 'mobile',
            waNumber: `${COUNTRY_CODE}${nsn}`,
            display: `+${COUNTRY_CODE} ${nsn.slice(0, 3)} ${nsn.slice(3, 5)} ${nsn.slice(5, 7)} ${nsn.slice(7, 9)}`,
        };
    }
    if (LANDLINE_NSN_LENGTHS.includes(nsn.length) && LANDLINE_PREFIXES.includes(lead)) {
        return { reachability: 'landline', waNumber: '', display: '' };
    }
    return { reachability: 'invalid', waNumber: '', display: '' };
}

/**
 * Best interpretation of one phone_number field.
 *
 * A field sometimes holds two numbers ("0555 12 34 56 / 021 45 67 89"), so
 * every candidate is tried and the first mobile wins — a patient with a mobile
 * and a landline on file is reachable, and which one was typed first should not
 * decide that. Failing that, 'landline' is preferred over 'invalid' because it
 * explains the dead end instead of blaming the data entry.
 */
export function normalizePhone(raw: string | null | undefined): NormalizedPhone {
    const text = (raw ?? '').trim();
    if (!text) return { reachability: 'missing', waNumber: '', display: '' };

    const candidates = text
        .split(NUMBER_SEPARATORS)
        .map((part) => part.replace(/\D/g, ''))
        .filter(Boolean);

    let best: NormalizedPhone | null = null;
    for (const candidate of candidates) {
        const parsed = classify(candidate);
        if (parsed.reachability === 'mobile') return parsed;
        if (!best || (best.reachability === 'invalid' && parsed.reachability === 'landline')) {
            best = parsed;
        }
    }

    // Nothing parsed, so show the doctor what they typed rather than a blank —
    // they are the one who has to recognise and fix it.
    return { reachability: best?.reachability ?? 'invalid', waNumber: '', display: text };
}
