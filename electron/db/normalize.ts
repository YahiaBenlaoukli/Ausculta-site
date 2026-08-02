// Search-text normalisation, shared by the write path (patients.search_text is
// filled on insert/update) and the query path (the needle is normalised the
// same way before the LIKE). Both sides MUST use this function: the column only
// matches if the text stored in it and the text searched for went through the
// identical transformation.
//
// Why this exists at all: SQLite's LIKE and NOCASE collation are ASCII-only.
// 'benaissa' LIKE '%Benaïssa%' is false, and every Arabic name written with a
// different alef or hamza form fails to match. A doctor typing a name from
// memory would silently miss records that exist — the worst possible failure
// for a medical search box. So we store a flattened copy and search that.
//
// Kept dependency-free (no imports) on purpose so db.ts can use it during the
// migration backfill without pulling in a service module and creating a cycle.

// The character classes below hold literal combining marks, which render as
// nothing (or as a mark stuck to the bracket) in most editors. The U+XXXX
// values in each comment are the source of truth — verify against those rather
// than trusting what the glyphs look like, and re-check after any edit.

/** Latin combining accents left behind by NFD decomposition (é -> e + U+0301). */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Arabic combining marks (U+064B–U+065F) plus the superscript alef (U+0670).
 *
 * The range has to run past the harakat at U+0652 to cover U+0653–U+0655
 * (maddah, hamza above, hamza below): NFD decomposes أ إ آ ؤ ئ into a bare
 * letter followed by one of those, and they are NOT in the Latin combining
 * block above. Stopping at U+0652 leaves the hamza stranded, NON_ALPHANUMERIC
 * turns it into a space, and "أحمد" folds to "ا حمد" — which then fails to
 * match the "احمد" a user types.
 */
const ARABIC_DIACRITICS = /[ً-ٰٟ]/g;

/** Tatweel (U+0640) — pure typographic stretching, never meaningful. */
const TATWEEL = /ـ/g;

/** Arabic letters routinely written several ways, folded to a single form. */
const ARABIC_FOLDING: Record<string, string> = {
  'أ': 'ا', // أ alef with hamza above -> ا
  'إ': 'ا', // إ alef with hamza below -> ا
  'آ': 'ا', // آ alef with madda       -> ا
  'ٱ': 'ا', // ٱ alef wasla            -> ا
  'ى': 'ي', // ى alef maksura          -> ي
  'ة': 'ه', // ة ta marbuta            -> ه
  'ؤ': 'و', // ؤ waw with hamza        -> و
  'ئ': 'ي', // ئ ya with hamza         -> ي
};

const ARABIC_VARIANTS = /[أإآٱىةؤئ]/g;

/**
 * Everything that is not a letter or digit becomes a separator, so "ben-aissa",
 * "ben aissa" and "ben.aissa" normalise identically. \p{L}/\p{N} keep Arabic
 * and accent-stripped Latin letters alike.
 */
const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;

/**
 * Folds a string into its searchable form: lowercase, accent-free,
 * Arabic-variant-free, punctuation collapsed to single spaces.
 *
 *   "Dr. Benaïssa Mohammed" -> "dr benaissa mohammed"
 *   "أحمد بن عليّ"           -> "احمد بن علي"
 */
export function normalizeSearchText(input: string | null | undefined): string {
  if (!input) return '';

  return input
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(ARABIC_DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(ARABIC_VARIANTS, (c) => ARABIC_FOLDING[c])
    .toLowerCase()
    .replace(NON_ALPHANUMERIC, ' ')
    .trim();
}

/**
 * The value stored in patients.search_text — every field a doctor might search
 * a patient by, flattened into one haystack. Phone and SSN are added twice:
 * once as written and once digits-only, so both "0555 12 34" and "05551234"
 * find the same patient regardless of how the number was keyed in.
 */
export function buildPatientSearchText(patient: {
  fullName?: string | null;
  phoneNumber?: string | null;
  ssn?: string | null;
  address?: string | null;
}): string {
  const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

  return normalizeSearchText(
    [
      patient.fullName,
      patient.phoneNumber,
      digits(patient.phoneNumber),
      patient.ssn,
      digits(patient.ssn),
      patient.address,
    ]
      .filter(Boolean)
      .join(' ')
  );
}

/** Escapes LIKE wildcards in user-supplied text (always paired with ESCAPE '\'). */
export function escapeLike(query: string): string {
  return query.replace(/[\\%_]/g, (c) => `\\${c}`);
}
