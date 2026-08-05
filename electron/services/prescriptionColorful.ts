// The "colorful" prescription: a bilingual French/Arabic letterhead in the
// house blue, built as HTML and printed through Chromium by htmlPdf.ts.
//
// Why HTML and not pdf-lib, like the classic template: the header carries the
// doctor's name and the clinic's name in Arabic script, and pdf-lib does no
// glyph shaping or bidi reordering. See the header comment in htmlPdf.ts.
//
// Layout follows the letterhead convention used by Algerian private practices:
//
//   ┌──────────────────────────────────────────────┐
//   │  Dr Name (fr)      ☤       Name (ar)         │
//   │  Speciality (fr)  N° d'ordre  Speciality (ar)│
//   │  Diploma (fr)              Diploma (ar)      │
//   ├──────────────────────────────────────────────┤  ─┐ omitted together
//   │              CLINIC NAME (fr)                │   │ when the practice
//   │              CLINIC NAME (ar)                │  ─┘ has no clinic
//   ╞══════════════════════════════════════════════╡
//   │                 ORDONNANCE                   │
//   │                 ──────────                   │
//   │ Nom / Prénom / Age            City, le date  │
//   │ 1 - DRUG ................... qty             │
//   │      dosage × frequency — duration           │
//   ├──────────────────────────────────────────────┤
//   │      Tél · address · email  (every page)     │
//   └──────────────────────────────────────────────┘
//
// The two scripts sit in equal-basis columns either side of the emblem so each
// reads as the other's mirror, which is how these letterheads are set.
//
// Everything below ORDONNANCE flows, so a long prescription continues onto a
// second page instead of being truncated with "+N autre(s) médicament(s)" the
// way the classic template does.
//
// The letterhead is a <thead> so Chromium repeats it on every printed page. A
// continuation sheet listing drugs with no prescriber on it is not a valid
// prescription, and a pre-printed pad has the letterhead on every sheet anyway.
// That is the only reason there is a table here; nothing about this layout is
// tabular.
import type {
    DoctorProfile,
    Prescription,
    PrescriptionLanguage,
} from "../../types/doctor";
import type { Patient } from "../../types/patient";
import { arabicFontFaceCss, containsArabic, escapeHtml } from "./htmlPdf";

/** The letterhead blue, and the washes derived from it. */
const INK_BLUE = "#1b4f8f";
const RULE_BLUE = "#2b6cb0";
const WATERMARK_BLUE = "#dbe8f5";

const COLORFUL_LABELS = {
    fr: {
        title: "ORDONNANCE",
        lastName: "Nom :",
        firstName: "Prénom :",
        age: "Age :",
        ageSuffix: "Ans",
        orderNumber: "N° d'ordre :",
        phone: "Tél :",
        // "Alger, le 06/01/2023" — the connector between place and date.
        dateConnector: "le",
        notes: "Remarques :",
        signature: "Signature",
    },
    en: {
        title: "PRESCRIPTION",
        lastName: "Last name:",
        firstName: "First name:",
        age: "Age:",
        ageSuffix: "Yrs",
        orderNumber: "Reg. no.:",
        phone: "Tel:",
        dateConnector: "on",
        notes: "Notes:",
        signature: "Signature",
    },
} as const;

/**
 * A caduceus, the emblem centred between the French and Arabic names.
 *
 * Drawn as SVG rather than shipped as an image so it stays sharp at print
 * resolution and takes the letterhead colour without a second asset: winged
 * staff, knop, and two serpents twined around it.
 */
const CADUCEUS_SVG = `
<svg class="emblem" viewBox="0 0 120 158" role="presentation" aria-hidden="true">
  <g stroke="${INK_BLUE}" fill="none" stroke-linecap="round">
    <!-- staff and its knop -->
    <line x1="60" y1="20" x2="60" y2="152" stroke-width="5" />
    <circle cx="60" cy="13" r="7" fill="${INK_BLUE}" stroke="none" />

    <!-- Wings as layered feather strokes rather than one filled shape: at
         26mm wide a solid silhouette collapses into a dark blob. -->
    <g stroke-width="3.4">
      <path d="M57 33 C42 24 25 24 10 32" />
      <path d="M57 40 C43 32 28 32 15 39" />
      <path d="M57 47 C45 40 32 41 21 47" />
      <path d="M63 33 C78 24 95 24 110 32" />
      <path d="M63 40 C77 32 92 32 105 39" />
      <path d="M63 47 C75 40 88 41 99 47" />
    </g>

    <!-- Two serpents twined about the staff. Kept thin so the crossings read
         as separate bodies instead of one beaded chain. -->
    <g stroke-width="3.2">
      <path d="M60 58 C41 69 79 86 60 97 C41 108 79 125 60 136" />
      <path d="M60 58 C79 69 41 86 60 97 C79 108 41 125 60 136" />
      <!-- heads, rearing away from the staff -->
      <path d="M60 58 C54 51 48 49 43 51" />
      <path d="M60 58 C66 51 72 49 77 51" />
    </g>
    <circle cx="41" cy="51" r="2.6" fill="${INK_BLUE}" stroke="none" />
    <circle cx="79" cy="51" r="2.6" fill="${INK_BLUE}" stroke="none" />
  </g>
</svg>`;

/**
 * The stethoscope watermark. `position: fixed` puts it on every printed page,
 * behind the content, at an opacity that photocopies without obscuring text.
 */
const STETHOSCOPE_SVG = `
<svg class="watermark" viewBox="0 0 320 380" role="presentation" aria-hidden="true">
  <g fill="none" stroke="${WATERMARK_BLUE}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
    <!-- binaural: both ear tubes meeting at the yoke, as one stroke -->
    <path d="M95 48 L95 124 C95 163 124 190 160 190 C196 190 225 163 225 124 L225 48" />
    <!-- ear tips, angled outward off the tube ends -->
    <path d="M95 48 C95 36 88 29 78 27" stroke-width="13" />
    <path d="M225 48 C225 36 232 29 242 27" stroke-width="13" />
    <!-- stem, then the sweep out to the chest piece -->
    <path d="M160 190 L160 252 C160 302 192 328 230 331" />
    <!-- chest piece: bell plus diaphragm ring -->
    <circle cx="262" cy="333" r="34" />
    <circle cx="262" cy="333" r="19" />
  </g>
</svg>`;

/** Age in whole years, matching the classic template's calculation. */
function ageInYears(birthDate: string): number {
    const birth = new Date(birthDate);
    const today = new Date();
    let years = today.getFullYear() - birth.getFullYear();
    const months = today.getMonth() - birth.getMonth();
    if (months < 0 || (months === 0 && today.getDate() < birth.getDate())) {
        years--;
    }
    return years;
}

/**
 * Splits a patient's stored `fullName` into surname and given name for the
 * separate Nom / Prénom rows the form has.
 *
 * The database keeps one name field, so this is a presentation guess: the first
 * word is taken as the surname, the rest as given names, which is how names are
 * entered in practice here. When there is only one word it goes on the Nom row
 * and Prénom is left blank rather than duplicating it.
 */
function splitName(fullName: string): { lastName: string; firstName: string } {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) {
        return { lastName: parts[0] ?? "", firstName: "" };
    }
    return { lastName: parts[0], firstName: parts.slice(1).join(" ") };
}

/**
 * One `label: value` row in the patient block.
 *
 * An empty value normally drops the whole row — a prescription should not print
 * "Prénom :" for a patient recorded under a single name. `blank` overrides that
 * for the Settings preview, where the point is to show the form's empty fields.
 */
function metaRow(label: string, value: string, blank = false): string {
    if (!value && !blank) return "";
    return `
      <div class="meta-row">
        <span class="meta-label">${escapeHtml(label)}</span>
        <span class="meta-value${blank && !value ? " meta-blank" : ""}">${escapeHtml(value)}</span>
      </div>`;
}

/** A right-to-left header line, dropped when the doctor has not filled it in. */
function arabicLine(text: string | undefined, className: string): string {
    if (!text?.trim()) return "";
    return `<div class="${className}" dir="rtl" lang="ar">${escapeHtml(text)}</div>`;
}

/** A left-to-right header line, dropped when empty. */
function latinLine(text: string | undefined, className: string): string {
    if (!text?.trim()) return "";
    return `<div class="${className}">${escapeHtml(text)}</div>`;
}

/**
 * The clinic band under the doctor's identity, with the rule that separates the
 * two.
 *
 * Returns nothing at all when the doctor has no clinic details — most private
 * practices are not attached to a clinic, and an empty band would leave two
 * rules stacked on top of each other with a gap between them. The rule is part
 * of this block precisely so it disappears along with the content it divides.
 */
function clinicBlock(doctor: DoctorProfile): string {
    // Latin name first, then Arabic — the reverse of the identity row above,
    // where Arabic sits on the right because that row is a mirrored pair.
    //
    // No order number here: it registers the DOCTOR with the medical council,
    // not the clinic, so it belongs to the identity block above and would be
    // wrong to print under a clinic name the doctor merely rents a room in.
    const rows = [
        latinLine(doctor.clinicName, "clinic-name"),
        arabicLine(doctor.clinicNameAr, "clinic-name-ar"),
    ].filter(Boolean);

    if (rows.length === 0) return "";

    return `
      <div class="rule"></div>
      <div class="clinic">${rows.join("")}</div>`;
}

/**
 * Practice contact details, printed as a footer strip.
 *
 * Lives in the table's <tfoot> so Chromium repeats it on every page and — the
 * part that matters — reserves vertical space for it on every page, which a
 * `position: fixed` footer would not, leaving the last drug on a full page to
 * print straight through it.
 *
 * Returns nothing when the profile carries no contact details, so a doctor who
 * has filled in none of them gets no empty strip and no orphaned rule.
 */
function contactFooter(
    doctor: DoctorProfile,
    labels: (typeof COLORFUL_LABELS)[PrescriptionLanguage]
): string {
    const parts = [
        doctor.phoneNumber?.trim() && `${labels.phone} ${doctor.phoneNumber.trim()}`,
        doctor.address?.trim(),
        doctor.email?.trim(),
    ].filter((part): part is string => Boolean(part));

    if (parts.length === 0) return "";

    return `
      <div class="contact">
        ${parts.map((part) => `<span class="contact-item">${escapeHtml(part)}</span>`).join("")}
      </div>`;
}

/**
 * The drug list.
 *
 * Field semantics match the classic template exactly, so the same prescription
 * reads identically whichever style the doctor picked: the quantity sits at the
 * right end of the leader dots, and dosage/frequency/duration go on the
 * indented sub-line. Only the typography differs.
 */
function medicineList(prescriptions: Prescription[]): string {
    const medicines = prescriptions.flatMap((p) => p.medicines);
    if (medicines.length === 0) return "";

    const items = medicines
        .map((med, index) => {
            // Joined with an en dash only between the parts that exist, so a drug
            // with no recorded duration does not print a dangling separator.
            const detail = [
                med.dosage?.trim(),
                med.frequency?.trim(),
                med.duration?.trim(),
            ]
                .filter(Boolean)
                .join("  ×  ");

            return `
        <li class="med">
          <div class="med-head">
            <span class="med-index">${index + 1} -</span>
            <span class="med-name">${escapeHtml(med.medicineName)}</span>
            <span class="med-leader"></span>
            <span class="med-qty">${escapeHtml(med.quantity ?? "")}</span>
          </div>
          ${detail ? `<div class="med-detail">${escapeHtml(detail)}</div>` : ""}
        </li>`;
        })
        .join("");

    // `start` is absent because the index is drawn as text: the form's numbering
    // has a trailing hyphen ("1 -") that a CSS marker cannot reproduce.
    return `<ol class="med-list">${items}</ol>`;
}

/** Prescription-level advice, printed under the drugs when present. */
function notesBlock(
    prescriptions: Prescription[],
    labels: (typeof COLORFUL_LABELS)[PrescriptionLanguage]
): string {
    const notes = prescriptions
        .map((p) => p.notes?.trim())
        .filter((note): note is string => Boolean(note));
    if (notes.length === 0) return "";

    return `
    <section class="notes">
      <div class="notes-label">${escapeHtml(labels.notes)}</div>
      ${notes.map((note) => `<p class="notes-text">${escapeHtml(note)}</p>`).join("")}
    </section>`;
}

export type ColorfulPrescriptionInput = {
    /**
     * Null renders the letterhead with an empty form below it — that is the
     * Settings preview, and reusing this builder for it is what stops the
     * preview from drifting away from the document it is previewing.
     */
    patient: Patient | null;
    prescriptions: Prescription[];
    doctor: DoctorProfile;
    language: PrescriptionLanguage;
};

/**
 * Builds the complete, self-contained HTML document for one prescription.
 *
 * Self-contained matters: htmlPdf.ts loads it from a temp file with an opaque
 * origin, so there is no base URL to resolve anything against. Fonts arrive as
 * data URIs and the artwork is inline SVG.
 */
export async function buildColorfulPrescriptionHtml(
    input: ColorfulPrescriptionInput
): Promise<string> {
    const { patient, prescriptions, doctor, language } = input;
    const labels = COLORFUL_LABELS[language];
    const { lastName, firstName } = splitName(patient?.fullName ?? "");
    const isPreview = patient === null;

    // Embed Amiri only if something on the page is actually written in Arabic —
    // the doctor's header, or a patient/drug/note recorded in Arabic script.
    const needsArabic = containsArabic([
        doctor.fullNameAr, doctor.specialityAr, doctor.diplomaAr,
        doctor.clinicName, doctor.clinicNameAr, doctor.fullName,
        doctor.speciality, doctor.diploma, doctor.city,
        patient?.fullName,
        ...prescriptions.flatMap((p) => [
            p.notes,
            ...p.medicines.flatMap((m) => [
                m.medicineName, m.dosage, m.frequency, m.duration, m.quantity,
            ]),
        ]),
    ]);
    const fontFaces = needsArabic ? await arabicFontFaceCss() : "";

    const dateText = new Date().toLocaleDateString("en-GB");
    // "Alger, le 06/01/2023" when a city is set, otherwise just the date —
    // inventing a city on a medical document is not the renderer's call.
    const dateline = doctor.city?.trim()
        ? `${doctor.city.trim()}, ${labels.dateConnector} ${dateText}`
        : dateText;

    const ageText = patient?.dateOfBirth
        ? `${ageInYears(patient.dateOfBirth)} ${labels.ageSuffix}`
        : "";

    return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(labels.title)}</title>
<style>
${fontFaces}

/* Geometry lives here, and htmlPdf passes preferCSSPageSize so Chromium honours
   it. The margin MUST be on @page rather than as padding on .sheet: padding
   applies once to the whole block, so on a second page the repeated letterhead
   would sit flush against the paper edge. */
@page {
  size: A4;
  margin: 14mm 13mm 18mm;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  /* 100% resolves against the page box in print, which is what lets the table
     below stretch to fill a short page and carry the contact footer down to the
     bottom of the paper. Verified not to emit a trailing blank page — if that
     ever regresses, this is the first thing to suspect. */
  height: 100%;
}

/* Body text — the patient block, the drug list, notes — is a plain grotesque.
   This started as Courier to echo the typewritten pads these forms replaced,
   but a monospace face sets drug names loose and wide, and "MAXILASE SIROP
   20 000 U CEIP/100ML" is hard enough to read without it.

   Arial is named alongside Helvetica because Windows has no Helvetica and would
   otherwise fall back unpredictably; Liberation Sans covers Linux with the same
   metrics. All three are safe to rely on because the PDF embeds whatever face
   Chromium actually used, so the output does not depend on the reader's fonts. */
/* Amiri leads the stack but is restricted to Arabic codepoints by the
   unicode-range on its @font-face, so Latin skips it and lands on Helvetica.
   That is what makes an Arabic patient name or drug name render in the bundled
   naskh face instead of whatever the host machine happens to have. */
body {
  font-family: 'Amiri', Helvetica, Arial, 'Liberation Sans', sans-serif;
  color: #16233f;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* Same stack as body, and that is deliberate. Naming a system Arabic face here
   ('Traditional Arabic', 'Segoe UI') looked like a sensible fallback but pulled
   one into every bilingual PDF: Amiri's unicode-range covers Arabic only, so the
   ASCII quotes in a name like العيادة "الاسم" fell past it and embedded a whole
   extra font for two punctuation marks. Falling back to the Latin faces already
   in the document costs nothing and keeps the file to four faces.

   The Arabic header sizes below are deliberately a point or two LARGER than
   their French counterparts: Amiri is a naskh face with a small apparent
   x-height, so matching the point sizes would leave the Arabic column
   looking lighter than the French one it is supposed to mirror. */
[lang="ar"] {
  font-family: 'Amiri', Helvetica, Arial, 'Liberation Sans', sans-serif;
}

/* On screen (the Settings preview is a PDF too, but the probe renders this in a
   window) @page does nothing, so mirror the print margins here. In print this
   padding is harmless: it applies once, inside the @page margin. */
/* height, not min-height: .page's own height: 100% only resolves against a
   parent with a definite height. box-sizing: border-box above keeps the screen
   padding inside it. */
.sheet {
  position: relative;
  padding: 0;
  height: 100%;
}

@media screen {
  .sheet { padding: 14mm 13mm 18mm; }
}

/* ── Watermark ─────────────────────────────────────────────────────────── */

/* Fixed rather than absolute so Chromium repeats it on every printed page;
   an absolutely positioned watermark appears on page one only.
   Centred at 62% of the page height, which sits it below the letterhead and the
   ORDONNANCE rule — overlapping those made the header hard to read. */
.watermark {
  position: fixed;
  width: 104mm;
  height: 124mm;
  left: 53%;
  top: 62%;
  transform: translate(-50%, -50%);
  z-index: 0;
  opacity: 0.9;
}

/* Everything real sits above the watermark. */
.sheet > *:not(.watermark) {
  position: relative;
  z-index: 1;
}

/* ── Page scaffold ─────────────────────────────────────────────────────── */

/* A table purely so the letterhead in <thead> repeats on every printed page —
   display: table-header-group is what Chromium acts on. Reset the table's own
   spacing so it behaves like the plain block flow it is standing in for. */
/* height: 100% makes the body row absorb the leftover space on a page that is
   not full, which pushes <tfoot> to the bottom of the paper instead of leaving
   the contact strip floating just under the last drug. A table treats height as
   a minimum, so a prescription that overflows still paginates normally. */
.page {
  width: 100%;
  height: 100%;
  border-collapse: collapse;
}

.page > thead {
  display: table-header-group;
}

.page > tbody {
  display: table-row-group;
}

/* Repeats the contact strip on every page, and reserves room for it so flowed
   content stops short of it rather than printing over it. */
.page > tfoot {
  display: table-footer-group;
}

.page td {
  padding: 0;
  vertical-align: top;
  text-align: left;
}

/* ── Letterhead ────────────────────────────────────────────────────────── */

/* French identity, emblem, Arabic identity — one row, the emblem centred
   between the two names so each script reads as the other's mirror. */
.identity {
  display: flex;
  align-items: center;
  gap: 5mm;
}

/* Equal basis with no grow, so the emblem stays on the page's centre line
   however unequal the two names are in width. */
.identity-col {
  flex: 1 1 0;
  min-width: 0;
  text-align: center;
}

/* Height matters beyond looks: the emblem is taller than the French text block
   beside it, so it sets the whole letterhead's height — and Chromium only
   repeats a <thead> that fits in 25% of the page. See the note on .page. */
.emblem {
  width: 20mm;
  height: 25mm;
  flex-shrink: 0;
}

.doc-name {
  font-family: 'Times New Roman', Georgia, serif;
  font-size: 16pt;
  font-weight: 700;
  color: ${INK_BLUE};
  letter-spacing: 0.2pt;
  line-height: 1.15;
}

.doc-speciality {
  font-family: 'Times New Roman', Georgia, serif;
  font-size: 10.5pt;
  color: ${INK_BLUE};
  margin-top: 1.5mm;
}

.doc-diploma {
  font-family: 'Times New Roman', Georgia, serif;
  font-size: 8pt;
  color: ${INK_BLUE};
  margin-top: 1mm;
}

.doc-name-ar {
  font-size: 17pt;
  font-weight: 700;
  color: ${INK_BLUE};
  line-height: 1.35;
}

.doc-speciality-ar {
  font-size: 11.5pt;
  color: ${INK_BLUE};
  line-height: 1.45;
}

.doc-diploma-ar {
  font-size: 9pt;
  color: ${INK_BLUE};
  line-height: 1.45;
}

.rule {
  height: 0.7mm;
  background: ${RULE_BLUE};
  margin: 2.2mm 0;
  border-radius: 0.4mm;
}

/* The heavy rule that closes the letterhead. */
.rule-strong {
  height: 1.6mm;
  background: ${INK_BLUE};
  margin: 2.8mm 0 3mm;
  border-radius: 0.5mm;
}

/* Emblem plus the doctor's council registration number, stacked in the middle
   column. Putting the number here keeps the French and Arabic columns the same
   number of lines, so they stay mirrored. */
.identity-emblem {
  flex: 0 0 auto;
  text-align: center;
}

.doc-order {
  font-family: 'Times New Roman', Georgia, serif;
  font-size: 8pt;
  color: ${INK_BLUE};
  margin-top: 1mm;
  white-space: nowrap;
}

/* Clinic band, centred across the full width — it belongs to neither script's
   column, so it gets the whole row and is set larger than the identity lines
   above it. Absent entirely for a practice with no clinic; see clinicBlock(). */
.clinic { text-align: center; }

.clinic-name-ar {
  font-size: 18pt;
  font-weight: 700;
  color: ${INK_BLUE};
  line-height: 1.35;
}

.clinic-name {
  font-family: 'Times New Roman', Georgia, serif;
  font-size: 15pt;
  font-weight: 700;
  color: ${INK_BLUE};
  letter-spacing: 0.2pt;
}

/* ── Title ─────────────────────────────────────────────────────────────── */

.title {
  font-size: 17pt;
  font-weight: 400;
  text-align: center;
  margin: 4mm 0 6mm;
}

/* The rule under the title is a border on an inline-block, so it measures the
   word rather than the page — a full-width rule here read as a third letterhead
   divider and fought with the heavy one just above it. */
.title-text {
  display: inline-block;
  font-family: 'Times New Roman', Georgia, serif;
  color: #16233f;
  letter-spacing: 1pt;
  border-bottom: 0.25mm solid ${RULE_BLUE};
  padding-bottom: 1.2mm;
}

/* ── Patient block ─────────────────────────────────────────────────────── */

.patient {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10mm;
  margin-bottom: 7mm;
}

.patient-fields { flex: 1; }

.meta-row {
  display: flex;
  align-items: baseline;
  gap: 3mm;
  margin-bottom: 2.4mm;
  font-size: 10.5pt;
}

.meta-label {
  min-width: 17mm;
  color: #16233f;
}

.meta-value { font-weight: 700; }

/* Preview only: an empty field still needs a line to read as a form. */
.meta-blank {
  display: inline-block;
  min-width: 55mm;
  border-bottom: 0.25mm dotted #16233f;
  opacity: 0.45;
}

.dateline {
  font-size: 10.5pt;
  white-space: nowrap;
  padding-top: 0.5mm;
}

/* ── Drug list ─────────────────────────────────────────────────────────── */

.med-list {
  list-style: none;
  margin: 0;
  padding: 0 0 0 6mm;
}

.med {
  margin-bottom: 5.5mm;
  /* A drug's name and its posology must never be split across a page. */
  break-inside: avoid;
  page-break-inside: avoid;
}

.med-head {
  display: flex;
  align-items: baseline;
  font-size: 10.5pt;
  font-weight: 700;
}

.med-index {
  flex-shrink: 0;
  margin-right: 2mm;
}

.med-name { flex-shrink: 0; }

/* The leader dots. A dotted bottom border stretched by flex-grow tracks the
   name's width automatically, which a run of literal '.' characters cannot. */
.med-leader {
  flex: 1 1 auto;
  min-width: 6mm;
  margin: 0 2.5mm;
  border-bottom: 1.1pt dotted #16233f;
  /* Lift the dots off the descender line onto the visual baseline. */
  transform: translateY(-1mm);
}

.med-qty {
  flex-shrink: 0;
  white-space: nowrap;
}

.med-detail {
  font-size: 9.5pt;
  margin-top: 1.6mm;
  margin-left: 7mm;
}

/* ── Notes and signature ───────────────────────────────────────────────── */

.notes {
  margin-top: 8mm;
  break-inside: avoid;
  page-break-inside: avoid;
}

.notes-label {
  font-size: 10pt;
  font-weight: 700;
  color: ${INK_BLUE};
  margin-bottom: 1.5mm;
}

.notes-text {
  font-size: 9.5pt;
  margin: 0 0 1.5mm;
  white-space: pre-wrap;
}

.signature {
  margin-top: 16mm;
  text-align: right;
  break-inside: avoid;
  page-break-inside: avoid;
}

/* ── Contact footer ────────────────────────────────────────────────────── */

.contact {
  border-top: 0.4mm solid ${RULE_BLUE};
  padding-top: 2mm;
  margin-top: 6mm;
  text-align: center;
  font-family: 'Times New Roman', Georgia, serif;
  font-size: 8.5pt;
  color: ${INK_BLUE};
  line-height: 1.5;
}

/* A middle dot before every item but the first, so the separators come from the
   list itself and a doctor with only a phone number gets no stray bullet. The
   gap is a margin, not spaces inside content: CSS collapses those to nothing. */
.contact-item + .contact-item::before {
  content: '·';
  margin: 0 2.5mm;
  opacity: 0.55;
}

.signature-label {
  font-size: 10pt;
  font-weight: 700;
  display: inline-block;
  border-top: 0.4mm solid ${RULE_BLUE};
  padding-top: 2mm;
  min-width: 45mm;
}
</style>
</head>
<body>
  <div class="sheet">
    ${STETHOSCOPE_SVG}

    <table class="page">
    <thead>
    <tr><td>
      <div class="identity">
        <div class="identity-col">
          ${latinLine(`Dr ${doctor.fullName}`, "doc-name")}
          ${latinLine(doctor.speciality, "doc-speciality")}
          ${latinLine(doctor.diploma, "doc-diploma")}
        </div>
        <div class="identity-emblem">
          ${CADUCEUS_SVG}
          ${doctor.orderNumber?.trim()
            ? `<div class="doc-order">${escapeHtml(labels.orderNumber)} ${escapeHtml(doctor.orderNumber.trim())}</div>`
            : ""}
        </div>
        <div class="identity-col" dir="rtl" lang="ar">
          ${arabicLine(doctor.fullNameAr, "doc-name-ar")}
          ${arabicLine(doctor.specialityAr, "doc-speciality-ar")}
          ${arabicLine(doctor.diplomaAr, "doc-diploma-ar")}
        </div>
      </div>
      ${clinicBlock(doctor)}
      <div class="rule-strong"></div>
    </td></tr>
    </thead>
    <tfoot>
    <tr><td>${contactFooter(doctor, labels)}</td></tr>
    </tfoot>
    <tbody>
    <tr><td>
    <h1 class="title"><span class="title-text">${escapeHtml(labels.title)}</span></h1>

    <section class="patient">
      <div class="patient-fields">
        ${metaRow(labels.lastName, lastName, isPreview)}
        ${metaRow(labels.firstName, firstName, isPreview)}
        ${metaRow(labels.age, ageText, isPreview)}
      </div>
      <div class="dateline">${escapeHtml(dateline)}</div>
    </section>

    ${medicineList(prescriptions)}
    ${notesBlock(prescriptions, labels)}

    <div class="signature">
      <div class="signature-label">${escapeHtml(labels.signature)}</div>
    </div>
    </td></tr>
    </tbody>
    </table>
  </div>
</body>
</html>`;
}
