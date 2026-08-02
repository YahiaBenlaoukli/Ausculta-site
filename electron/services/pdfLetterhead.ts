// A blank, code-drawn letterhead for documents that are NOT prescriptions.
//
// prescription.ts fills public/ordonnance/template{Fr,En}.pdf, whose artwork is
// a prescription form — it has "Ordonnance" printed on it and fixed boxes for
// patient/date/weight. A medical certificate cannot sit on that page, so this
// module builds an equivalent header from scratch on a blank A4: the doctor's
// identity block, a rule, and a signature line, with the body left to callers.
//
// Shared by certificates today, and by receipts when payments lands.
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import type { DoctorProfile, PrescriptionLanguage } from "../../types/doctor";

/** A4 at 72dpi, matching the prescription templates. */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;

/** Left/right text margin. */
export const MARGIN = 64;

/** Widest a line of body text may be before it wraps. */
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0, 0, 0);
const MUTED = rgb(0.42, 0.42, 0.42);
const RULE = rgb(0.78, 0.78, 0.78);

// Contact labels carry their own colon because French puts a space before it
// and English does not — keeping the punctuation in the label avoids a separate
// per-language separator rule.
const LETTERHEAD_LABELS = {
    fr: {
        doctorPrefix: "Dr ",
        signature: "Signature et cachet",
        phone: "Tél : ",
        address: "Adresse : ",
        email: "Email : ",
    },
    en: {
        doctorPrefix: "Dr ",
        signature: "Signature and stamp",
        phone: "Phone: ",
        address: "Address: ",
        email: "Email: ",
    },
} as const;

/** Separates the labelled contact fields on the header line. */
const CONTACT_SEPARATOR = "   ·   ";

export type Letterhead = {
    pdfDoc: PDFDocument;
    page: PDFPage;
    font: PDFFont;
    bold: PDFFont;
    width: number;
    height: number;
    /** Y coordinate just below the header rule — where body content starts. */
    contentTop: number;
};

/**
 * The characters WinAnsi encodes at 0x80–0x9F, which fall outside Latin-1 by
 * codepoint but are perfectly printable. Typographic punctuation lives here —
 * em dash, ellipsis, curly quotes — and any of it can turn up in text pasted
 * from Word or produced by a phone keyboard, so a naive "codepoint > 0xFF"
 * check would reject ordinary French prose.
 */
const WINANSI_HIGH_RANGE = new Set([
    '€', '‚', 'ƒ', '„', '…', '†', '‡',
    'ˆ', '‰', 'Š', '‹', 'Œ', 'Ž', '‘',
    '’', '“', '”', '•', '–', '—', '˜',
    '™', 'š', '›', 'œ', 'ž', 'Ÿ',
]);

/**
 * Typographic whitespace that WinAnsi cannot encode, mapped to a plain space.
 *
 * This is not a nicety. `(1500).toLocaleString('fr-FR')` returns "1 500" using
 * U+202F NARROW NO-BREAK SPACE as the thousands separator, so without this every
 * receipt for 1000 DA or more would be rejected as unprintable — which is very
 * nearly every consultation. Substituting a normal space is lossless for
 * display, unlike dropping a letter, so it is safe to do silently.
 */
// Keyed by CODEPOINT, never by literal character: these are all invisible or
// near-invisible, and an editor (or a formatter) that normalises them in the
// source would silently empty this table and take the fix with it.
const SUBSTITUTIONS = new Map<number, string>([
    // Space variants -> ordinary space.
    [0x00a0, ' '], // no-break space
    [0x2002, ' '], // en space
    [0x2003, ' '], // em space
    [0x2004, ' '], // three-per-em space
    [0x2005, ' '], // four-per-em space
    [0x2006, ' '], // six-per-em space
    [0x2007, ' '], // figure space
    [0x2008, ' '], // punctuation space
    [0x2009, ' '], // thin space
    [0x200a, ' '], // hair space
    [0x202f, ' '], // NARROW no-break space — the toLocaleString separator
    [0x205f, ' '], // medium mathematical space
    // Zero-width characters carry no meaning on paper.
    [0x200b, ''],  // zero-width space
    [0xfeff, ''],  // byte-order mark
    // Typographic minus -> hyphen.
    [0x2212, '-'],
]);

/**
 * Replaces characters that have a faithful WinAnsi equivalent. Every string
 * drawn on a letterhead goes through this, and so does the encodability check
 * below, so the two can never disagree about what is printable.
 */
export function sanitizeForPdf(text: string): string {
    let result = '';
    for (const char of text) {
        const replacement = SUBSTITUTIONS.get(char.codePointAt(0) ?? 0);
        result += replacement === undefined ? char : replacement;
    }
    return result;
}

/**
 * pdf-lib's standard fonts are WinAnsi-encoded and THROW on any character they
 * cannot represent — Arabic, in particular. Rather than let a doctor's Arabic
 * note blow up PDF generation with an opaque pdf-lib stack trace (or silently
 * mangle a legal document), callers check first and surface a real error.
 *
 * Returns the offending characters, or an empty array when the text is fine.
 */
export function unsupportedCharacters(text: string): string[] {
    const bad = new Set<string>();
    for (const char of sanitizeForPdf(text)) {
        // Tab/newline are handled by the wrapper, not drawn directly.
        if (char === '\n' || char === '\r' || char === '\t') continue;
        if (WINANSI_HIGH_RANGE.has(char)) continue;

        const code = char.codePointAt(0) ?? 0;
        const printableAscii = code >= 0x20 && code <= 0x7e;
        // Latin-1 supplement: every accented letter French needs.
        const latin1 = code >= 0xa0 && code <= 0xff;
        if (!printableAscii && !latin1) bad.add(char);
    }
    return [...bad];
}

/** Splits text into lines that fit `maxWidth`, honouring existing newlines. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const lines: string[] = [];

    for (const paragraph of sanitizeForPdf(text).split(/\r?\n/)) {
        if (!paragraph.trim()) {
            lines.push('');
            continue;
        }
        let current = '';
        for (const word of paragraph.split(/\s+/)) {
            const candidate = current ? `${current} ${word}` : word;
            if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
                lines.push(current);
                current = word;
            } else {
                current = candidate;
            }
        }
        if (current) lines.push(current);
    }
    return lines;
}

/**
 * Draws wrapped text and returns the Y coordinate below the last line, so
 * callers can stack blocks without tracking line counts themselves.
 */
export function drawParagraph(
    page: PDFPage,
    text: string,
    options: { x: number; y: number; size: number; font: PDFFont; maxWidth: number; lineHeight?: number; color?: ReturnType<typeof rgb> }
): number {
    const { x, y, size, font, maxWidth } = options;
    const lineHeight = options.lineHeight ?? size * 1.55;
    let cursor = y;
    for (const line of wrapText(text, font, size, maxWidth)) {
        if (line) page.drawText(line, { x, y: cursor, size, font, color: options.color ?? INK });
        cursor -= lineHeight;
    }
    return cursor;
}

function centeredX(text: string, font: PDFFont, size: number, width: number): number {
    return (width - font.widthOfTextAtSize(text, size)) / 2;
}

/**
 * Greedily packs whole segments onto lines no wider than `maxWidth`, never
 * splitting a segment. Used for the contact line so "Adresse : ..." stays
 * intact rather than wrapping mid-label.
 */
function packSegments(segments: string[], font: PDFFont, size: number, maxWidth: number): string[] {
    const lines: string[] = [];
    let current = '';
    for (const segment of segments) {
        const candidate = current ? `${current}${CONTACT_SEPARATOR}${segment}` : segment;
        if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
            lines.push(current);
            current = segment;
        } else {
            current = candidate;
        }
    }
    if (current) lines.push(current);
    return lines;
}

/** Draws `text` centred on the page and returns the Y below it. */
export function drawCentered(
    page: PDFPage,
    text: string,
    options: { y: number; size: number; font: PDFFont; width: number; color?: ReturnType<typeof rgb> }
): number {
    const { y, size, font, width } = options;
    const safe = sanitizeForPdf(text);
    page.drawText(safe, { x: centeredX(safe, font, size, width), y, size, font, color: options.color ?? INK });
    return y - size * 1.4;
}

/**
 * Creates a one-page document carrying the doctor's identity block, and reports
 * where the body may begin. The caller owns everything below `contentTop`.
 */
export async function createLetterhead(
    doctor: DoctorProfile,
    language: PrescriptionLanguage = "fr"
): Promise<Letterhead> {
    const labels = LETTERHEAD_LABELS[language];
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const { width, height } = page.getSize();

    let cursor = height - 62;
    cursor = drawCentered(page, `${labels.doctorPrefix}${doctor.fullName}`, { y: cursor, size: 19, font: bold, width });

    if (doctor.speciality) {
        cursor = drawCentered(page, doctor.speciality, { y: cursor - 4, size: 12, font: bold, width });
    }

    // Contact details, labelled so the header reads the same way as the
    // prescription form rather than as three anonymous strings. Only the fields
    // the profile actually has are printed.
    const contactParts = [
        doctor.phoneNumber && `${labels.phone}${doctor.phoneNumber}`,
        doctor.address && `${labels.address}${doctor.address}`,
        doctor.email && `${labels.email}${doctor.email}`,
    ]
        .filter((part): part is string => Boolean(part))
        // Sanitised up front so the width measurements below match what is drawn.
        .map(sanitizeForPdf);

    if (contactParts.length) {
        // Shrink until the longest single field fits on a line of its own, so
        // packing never has to break one mid-label. A long practice address is
        // the usual culprit; below 7.5pt it wraps onto a second line instead of
        // shrinking into illegibility.
        let size = 9.5;
        const widest = () => Math.max(...contactParts.map(part => font.widthOfTextAtSize(part, size)));
        while (size > 7.5 && widest() > CONTENT_WIDTH) size -= 0.5;

        cursor -= 6;
        for (const line of packSegments(contactParts, font, size, CONTENT_WIDTH)) {
            cursor = drawCentered(page, line, { y: cursor, size, font, color: MUTED, width });
        }
        // drawCentered already advanced past the last line; undo the extra gap
        // so the rule below sits the same distance away as it did with one line.
        cursor += size * 0.4;
    }

    const ruleY = cursor - 10;
    page.drawLine({
        start: { x: MARGIN, y: ruleY },
        end: { x: width - MARGIN, y: ruleY },
        thickness: 0.8,
        color: RULE,
    });

    return { pdfDoc, page, font, bold, width, height, contentTop: ruleY - 42 };
}

/**
 * Signature block, bottom-right, above the footer. Drawn last so it sits at a
 * fixed place on the page regardless of how long the body ran.
 */
export function drawSignatureBlock(
    letterhead: Letterhead,
    placeAndDate: string,
    language: PrescriptionLanguage = "fr"
) {
    const { page, font, bold, width } = letterhead;
    const labels = LETTERHEAD_LABELS[language];
    const blockRight = width - MARGIN;

    const dateSize = 10;
    const dateWidth = font.widthOfTextAtSize(placeAndDate, dateSize);
    page.drawText(placeAndDate, {
        x: blockRight - dateWidth,
        y: 208,
        size: dateSize,
        font,
        color: INK,
    });

    const labelSize = 10;
    const labelWidth = bold.widthOfTextAtSize(labels.signature, labelSize);
    page.drawText(labels.signature, {
        x: blockRight - labelWidth,
        y: 182,
        size: labelSize,
        font: bold,
        color: INK,
    });
}
