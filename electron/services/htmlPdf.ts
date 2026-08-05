// Renders an HTML string to a PDF through Chromium, for documents pdf-lib
// cannot draw.
//
// The pdf-lib path (prescription.ts, pdfLetterhead.ts) stamps text at measured
// coordinates using WinAnsi standard fonts. That is fine for Latin script, but
// pdf-lib performs no glyph shaping and no bidi reordering, so Arabic comes out
// as isolated letters in visual left-to-right order — see the deliberate
// refusals in certificates.ts and pdfLetterhead.ts. Chromium already implements
// shaping, bidi and RTL line breaking, and it comes with Electron, so a hidden
// BrowserWindow plus printToPDF buys correct Arabic with no new dependency and
// nothing extra for electron-builder to rebuild.
//
// It also brings page breaking for free, which is why the colorful prescription
// can print an unlimited number of medicines where the classic one truncates.
import { BrowserWindow, app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Characters that would otherwise let database text escape its element and
 * become markup. Every interpolated value in a template MUST go through
 * escapeHtml — a patient named `<b>` is a layout bug, and the quote entities
 * matter because values also land in attributes.
 */
const HTML_ESCAPES: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

/** Escapes text for interpolation into HTML markup or an attribute value. */
export function escapeHtml(value: unknown): string {
    if (value === null || value === undefined) return "";
    return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/**
 * Font files read off disk, keyed by absolute path, as base64.
 *
 * Cached because a base64 Amiri is ~600 KB and a doctor generating a morning's
 * prescriptions would otherwise re-read and re-encode the same two files for
 * every document. Cleared only by restarting the app, which is correct: the
 * bundled fonts cannot change while it runs.
 */
const fontCache = new Map<string, string>();

/**
 * Reads a bundled font and returns it as a `data:` URI for use in @font-face.
 *
 * Inlining rather than linking is deliberate. The rendered page is loaded from
 * a temp file, so it has an opaque file:// origin, and Chromium applies CORS to
 * font fetches from such origins — a relative url() would silently fail and
 * fall back to a system font, which on a machine with no Arabic face installed
 * means tofu boxes on a medical document. A data URI cannot fail that way, and
 * it keeps the renderer honest offline.
 *
 * Returns null when the file is missing so a template can degrade to system
 * fonts instead of failing to produce a prescription at all.
 */
async function fontDataUri(absolutePath: string): Promise<string | null> {
    const cached = fontCache.get(absolutePath);
    if (cached) return cached;
    try {
        const bytes = await fs.readFile(absolutePath);
        const uri = `data:font/ttf;base64,${bytes.toString("base64")}`;
        fontCache.set(absolutePath, uri);
        return uri;
    } catch (error) {
        console.error(`htmlPdf: could not read font ${absolutePath}:`, error);
        return null;
    }
}

/**
 * The Arabic face used by the colorful prescription, as inlinable CSS.
 *
 * Amiri is a naskh typeface under the OFL (public/fonts/Amiri-OFL.txt) — the
 * traditional look Algerian prescription letterheads use, and legible at the
 * small sizes a header block needs. Returns an empty string if the files are
 * absent, leaving the template's font-family fallbacks to cope.
 */
export async function arabicFontFaceCss(): Promise<string> {
    const dir = path.join(process.env.VITE_PUBLIC, "fonts");
    const regular = await fontDataUri(path.join(dir, "Amiri-Regular.ttf"));
    const bold = await fontDataUri(path.join(dir, "Amiri-Bold.ttf"));
    if (!regular || !bold) return "";

    // font-display: block keeps Chromium from painting a fallback face first;
    // printToPDF has no second chance to repaint.
    //
    // unicode-range is what lets a template name Amiri FIRST in its font stack
    // without Amiri also getting used for Latin: the face is only consulted for
    // these codepoints, so Latin falls straight through to the next family.
    // Naming it last instead would not work — Arial carries Arabic glyphs of its
    // own, so it would win every Arabic character before Amiri was reached.
    return `
@font-face {
  font-family: 'Amiri';
  font-style: normal;
  font-weight: 400;
  font-display: block;
  unicode-range: ${ARABIC_UNICODE_RANGE};
  src: url('${regular}') format('truetype');
}
@font-face {
  font-family: 'Amiri';
  font-style: normal;
  font-weight: 700;
  font-display: block;
  unicode-range: ${ARABIC_UNICODE_RANGE};
  src: url('${bold}') format('truetype');
}`;
}

/** The Arabic blocks Amiri is responsible for, as a CSS `unicode-range` list. */
const ARABIC_UNICODE_RANGE = [
    "U+0600-06FF", // Arabic
    "U+0750-077F", // Arabic Supplement
    "U+08A0-08FF", // Arabic Extended-A
    "U+FB50-FDFF", // Arabic Presentation Forms-A
    "U+FE70-FEFF", // Arabic Presentation Forms-B
].join(", ");

/**
 * Matches the same blocks, for deciding whether a document needs Amiri.
 *
 * Written with \u escapes rather than literal characters, for the reason
 * pdfLetterhead.ts spells out: the upper bound of the last range is U+FEFF, an
 * invisible zero-width no-break space. As a literal it is indistinguishable from
 * nothing at all, and any editor or formatter that trimmed it would silently
 * shrink the range with no visible diff.
 */
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * True when any of `values` contains Arabic script.
 *
 * Callers use this to skip embedding Amiri entirely — it is ~1.1 MB once
 * base64-encoded, and inlining that into a document with no Arabic in it is
 * pure cost. Deliberately checks the CONTENT rather than a "does this doctor
 * have Arabic header fields" flag: a patient or a drug can be recorded in
 * Arabic on an otherwise French prescription, and that still needs the font.
 */
export function containsArabic(values: (string | null | undefined)[]): boolean {
    return values.some((value) => typeof value === "string" && ARABIC_SCRIPT.test(value));
}

export type RenderPdfOptions = {
    /**
     * Honour the stylesheet's `@page` size instead of imposing A4 from here, so
     * page geometry lives beside the layout that depends on it. Templates that
     * declare no @page rule should pass false.
     */
    preferCSSPageSize?: boolean;
};

/**
 * Renders `html` to PDF bytes.
 *
 * The window is offscreen and never shown, and is destroyed before returning
 * even if printing throws — a leaked BrowserWindow keeps the whole app alive
 * after its last visible window closes.
 */
export async function renderHtmlToPdf(
    html: string,
    options: RenderPdfOptions = {}
): Promise<Buffer> {
    // Chromium refuses top-level navigation to data: URLs, so the page has to
    // come off disk. A random name keeps two concurrent renders apart.
    const tempFile = path.join(
        app.getPath("temp"),
        `ausculta-render-${crypto.randomUUID()}.html`
    );
    await fs.writeFile(tempFile, html, "utf-8");

    const win = new BrowserWindow({
        show: false,
        // Big enough that a media query or viewport unit never sees a phone-sized
        // viewport. Page geometry comes from @page, not from this.
        width: 1240,
        height: 1754,
        webPreferences: {
            // JavaScript stays on for one reason: document.fonts.ready is the
            // only reliable signal that the inlined Amiri has been decoded, and
            // printing early yields a fallback-font header.
            //
            // Safe because (a) every value interpolated into the template is run
            // through escapeHtml, so database text cannot become a <script>, and
            // (b) this window has no preload, no node integration and no IPC
            // surface, so there is nothing for script to reach even if it ran.
            javascript: true,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
        },
    });

    // A generated document has no business opening windows or navigating away.
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    try {
        await win.loadFile(tempFile);

        // Wait for the embedded fonts, but never hang a doctor's click on it:
        // after 5s, print with whatever face is available rather than leaving
        // the UI spinning forever.
        await win.webContents.executeJavaScript(
            `Promise.race([
                document.fonts.ready,
                new Promise((resolve) => setTimeout(resolve, 5000)),
            ]).then(() => true)`
        );

        return await win.webContents.printToPDF({
            pageSize: "A4",
            printBackground: true,
            margins: { marginType: "none" },
            preferCSSPageSize: options.preferCSSPageSize ?? true,
        });
    } finally {
        if (!win.isDestroyed()) win.destroy();
        // Best-effort: a stranded temp file is harmless, a throw here would mask
        // whatever the caller was actually reporting.
        await fs.rm(tempFile, { force: true }).catch(() => { });
    }
}
