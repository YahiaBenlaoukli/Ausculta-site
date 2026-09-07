// Builds `public/data/medications.json` — the drug list that backs prescription
// autocomplete — by merging two sources:
//
//   1. scripts/sources/dz-pharma-meds.json   (~5150 products, broad but a 2020 snapshot)
//      From https://github.com/fennecinspace/DZ-Pharma-Data (data/meds.json), itself
//      scraped from pharmnet-dz.com. NOT committed: the repo declares no license, so
//      re-download it yourself before running this script. Every row it contributes is
//      tagged `source: "dz"`, so it can be filtered back out if the licence forces it.
//
//   2. scripts/sources/dzpp-2025.xlsx        (560 products, narrow but current)
//      "Liste des produits pharmaceutiques enregistrés 2025", Ministère de l'Industrie
//      Pharmaceutique. Committed — it is a public ministry document.
//
// Source 2 wins on conflict (it is five years newer) and contributes 200+ brands that
// source 1 has never heard of. Source 1 contributes the fields the ministry sheet lacks:
// human-readable therapeutic/pharmacological classes, the Liste I/II/Stupéfiants
// schedule, and CNAS refundability.
//
// Run:  node scripts/build-drug-list.mjs [--dz PATH] [--xlsx PATH] [--out PATH] [--report PATH]
//
// Zero dependencies on purpose — this repo's node_modules carries native modules
// (better-sqlite3, bcrypt) that are painful to rebuild, and a once-a-year data script is
// not worth a devDependency. The xlsx reader below is a minimal ZIP + XML scanner; it
// handles the narrow subset of SpreadsheetML that Excel actually emits for this file.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DZ_PATH = resolve(ROOT, arg("dz", "scripts/sources/dz-pharma-meds.json"));
const XLSX_PATH = resolve(ROOT, arg("xlsx", "scripts/sources/dzpp-2025.xlsx"));
const OUT_PATH = resolve(ROOT, arg("out", "public/data/medications.json"));
const REPORT_PATH = resolve(ROOT, arg("report", "scripts/sources/build-report.md"));

// ---------------------------------------------------------------------------
// minimal xlsx reader (ZIP central directory walk + inflate)
// ---------------------------------------------------------------------------

/** Read one named entry out of a ZIP archive buffer. */
function unzipEntry(buf, wanted) {
  // Locate End Of Central Directory: signature 0x06054b50, scanned backwards
  // because it is followed by a variable-length comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a zip file (no EOCD record)");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // offset of first central-directory entry

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory entry");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    if (name === wanted) {
      // Re-read the local header: its own extra field can differ in length from
      // the central directory's, so the data offset must come from here.
      if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error("bad local header");
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return data; // stored
      if (method === 8) return inflateRawSync(data); // deflate
      throw new Error(`unsupported zip compression method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`entry not found in archive: ${wanted}`);
}

const XML_ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function xmlDecode(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m]);
}

/** Concatenate the text of every <t> element inside an XML fragment. */
function textOf(fragment) {
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m;
  while ((m = re.exec(fragment)) !== null) out += m[1] ? xmlDecode(m[1]) : "";
  return out;
}

/**
 * Read the ministry sheet as an array of row objects keyed by column letter.
 * Only the first worksheet is read — the workbook has exactly one ("Feuil1").
 */
function readXlsx(path) {
  const buf = readFileSync(path);

  // Shared strings: cells with t="s" hold an index into this table.
  let shared = [];
  try {
    const xml = unzipEntry(buf, "xl/sharedStrings.xml").toString("utf8");
    shared = [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  } catch {
    /* a sheet can legitimately have no shared strings */
  }

  const sheet = unzipEntry(buf, "xl/worksheets/sheet1.xml").toString("utf8");
  const rows = [];

  for (const rowMatch of sheet.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowNum = Number(rowMatch[1]);
    const cells = {};

    for (const c of rowMatch[2].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const body = c[2] ?? "";
      const ref = /r="([A-Z]+)\d+"/.exec(attrs);
      if (!ref) continue;
      const type = /t="([^"]+)"/.exec(attrs)?.[1];

      let value = "";
      if (type === "s") {
        const idx = /<v>(\d+)<\/v>/.exec(body);
        if (idx) value = shared[Number(idx[1])] ?? "";
      } else if (type === "inlineStr") {
        value = textOf(body);
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (v) value = xmlDecode(v[1]);
      }

      if (value !== "") cells[ref[1]] = value;
    }

    if (Object.keys(cells).length) rows.push({ row: rowNum, cells });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// cleaning
// ---------------------------------------------------------------------------

/**
 * Repair double-encoded UTF-8 ("StupÃ©fiants" -> "Stupéfiants"). The scraper that
 * produced dz-pharma-meds.json read UTF-8 bytes as latin-1, so re-encoding to
 * latin-1 and decoding as UTF-8 reverses it exactly. Affects ~0.8% of strings.
 * Bails out unless the result round-trips, so already-correct text is untouched.
 */
function fixMojibake(s) {
  if (typeof s !== "string" || !/[ÃÂÅËÐ]|â€/.test(s)) return s;
  const bytes = Buffer.from(s, "latin1");
  if (bytes.toString("latin1") !== s) return s; // had characters outside latin-1
  const decoded = bytes.toString("utf8");
  return decoded.includes("�") ? s : decoded;
}

/** Trim, collapse runs of whitespace, drop soft hyphens and stray control chars. */
function tidy(s) {
  if (typeof s !== "string") return "";
  return fixMojibake(s)
    .replace(/[­​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip accents and non-alphanumerics — used for matching, never for display. */
function normKey(s) {
  return tidy(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

// Both sources abbreviate galenic forms heavily and inconsistently: "COMP. PELLI",
// "CP PELL" and "COMPRIME PELLICULE" are one form written three ways, and DZ-Pharma
// contracts words past recognition ("GLES" = gélules, "COLLY" = collyre, "SEC" =
// sécable). Expanding token by token collapses 255 raw spellings onto a far smaller
// canonical vocabulary. `formRaw` keeps the original for audit.
//
// This table is derived from the actual token frequencies of both sources, not
// guessed — regenerate the frequency list with scripts/sources/tokens.mjs after a
// data refresh and add whatever new abbreviations appear.
const FORM_TOKENS = new Map(Object.entries({
  // dosage forms
  COMP: "COMPRIME", CP: "COMPRIME", CPR: "COMPRIME", COMPR: "COMPRIME", COMPRIMES: "COMPRIME",
  DRG: "COMPRIME ENROBE", ENRO: "ENROBE",
  PELLI: "PELLICULE", PELL: "PELLICULE", PELLIC: "PELLICULE", PELLICULES: "PELLICULE",
  GLES: "GELULE", GELULES: "GELULE", GELLULE: "GELULE", GELU: "GELULE",
  CAPS: "CAPSULE", CAPSULES: "CAPSULE",
  SUPPO: "SUPPOSITOIRE", SUPP: "SUPPOSITOIRE",
  SOL: "SOLUTION", SOLUT: "SOLUTION", BUVALE: "BUVABLE",
  SUSP: "SUSPENSION", BUV: "BUVABLE", BUVAB: "BUVABLE",
  PDRE: "POUDRE", PDE: "POUDRE", PDR: "POUDRE",
  GRLES: "GRANULE", GRANULES: "GRANULE",
  MICROG: "MICROGRANULE", MICROGRLES: "MICROGRANULE", MICROGRANULES: "MICROGRANULE",
  "MICRO-GRANULES": "MICROGRANULE",
  LYOPH: "LYOPHILISAT", LYOPHILISEE: "LYOPHILISAT", LYOPHIULISAT: "LYOPHILISAT",
  CRAME: "CREME", CREM: "CREME", CR: "CREME",
  POM: "POMMADE", POMM: "POMMADE",
  SIR: "SIROP",
  COLLY: "COLLYRE",
  COLLU: "COLLUTOIRE",
  AERO: "AEROSOL",
  AMP: "AMPOULE", AMPOULES: "AMPOULE",
  SERING: "SERINGUE",
  // qualifiers
  SEC: "SECABLE", SECABLES: "SECABLE",
  DISPERS: "DISPERSIBLE", DISP: "DISPERSIBLE",
  ORODISPERS: "ORODISPERSIBLE",
  EFFERV: "EFFERVESCENT", EFFERVESSANT: "EFFERVESCENT", EFF: "EFFERVESCENT",
  GASTRORESIST: "GASTRO-RESISTANT", "GASTRO-RESIST": "GASTRO-RESISTANT",
  "GASTRO-RESISTANTS": "GASTRO-RESISTANT", GASTRORESISTANT: "GASTRO-RESISTANT",
  LP: "LIBERATION PROLONGEE", LIBER: "LIBERATION", PROLONG: "PROLONGEE",
  MOLLE: "MOLLE",
  PREREMPL: "PREREMPLIE", "PRE-REMPLIE": "PREREMPLIE", PREREMLIE: "PREREMPLIE",
  REMLIE: "PREREMPLIE", REMPLIE: "PREREMPLIE",
  GTTES: "GOUTTES",
  CROQ: "CROQUER",
  SOLV: "SOLVANT",
  // routes / sites
  INJ: "INJECTABLE", INJECT: "INJECTABLE", INJECTION: "INJECTABLE",
  PERF: "PERFUSION", PERFEUSION: "PERFUSION",
  INHAL: "INHALATION", INHA: "INHALATION",
  DERM: "DERMIQUE", CUTANE: "DERMIQUE", CUTANEE: "DERMIQUE",
  OPHT: "OPHTALMIQUE",
  AURIC: "AURICULAIRE", AURC: "AURICULAIRE",
  NAS: "NASAL", ENDONASALE: "NASAL",
  VAG: "VAGINAL", VAGINALE: "VAGINAL",
  RECT: "RECTAL", RECTALE: "RECTAL",
  "SUB-LING": "SUBLINGUAL",
  EXT: "EXTERNE", EXTER: "EXTERNE",
  APP: "APPLICATION",
  "SOUS-CUTANEE": "SC", PARENT: "PARENTERAL",
}));

// Filler that carries no distinguishing information once abbreviations are expanded,
// plus the single letters left behind by splitting "S/C", "I.V." and similar.
const FORM_STOPWORDS = new Set(["A", "AU", "AUX", "DE", "DU", "DES", "DS", "EN", "ET",
  "LA", "LE", "OU", "PAR", "POUR", "PR", "P", "SUR", "USAGE", "USAG", "UNIDOSE", "DOSE",
  "NON", "DANS", "UN", "UNE", "VOIE", "OR", "S", "C", "I", "V", "A¦", "PRE"]);

function canonicalForm(raw) {
  const cleaned = tidy(raw)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[.,;:()\[\]/\\+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";

  const out = [];
  for (const token of cleaned.split(" ")) {
    if (!token || FORM_STOPWORDS.has(token)) continue;
    const word = FORM_TOKENS.get(token) ?? token;
    for (const part of word.split(" ")) {
      if (!out.includes(part)) out.push(part); // each qualifier once, first position wins
    }
  }
  return out.join(" ");
}

// A coarse bucket for grouping and for the short label an autocomplete row shows.
// Order matters: the first pattern that matches wins, so the more specific galenic
// forms are tested before the generic "SOLUTION"/"POUDRE" catch-alls.
const FORM_GROUPS = [
  ["COMPRIME", /\bCOMPRIME\b/],
  ["GELULE", /\bGELULE\b/],
  ["CAPSULE", /\bCAPSULE\b/],
  ["SUPPOSITOIRE", /\bSUPPOSITOIRE\b/],
  ["OVULE", /\bOVULE\b/],
  ["SIROP", /\bSIROP\b/],
  ["COLLYRE", /\bCOLLYRE\b/],
  ["PATCH", /\bPATCH\b|\bIMPLANT\b|\bDISPOSITIF\b/],
  ["INHALATION", /\bINHALATION\b|\bAEROSOL\b|\bSPRAY\b/],
  ["INJECTABLE", /\bINJECTABLE\b|\bPERFUSION\b|\bDIALYSE\b|\bHEMODIALYSE\b/],
  ["TOPIQUE", /\bCREME\b|\bPOMMADE\b|\bGEL\b|\bLOTION\b|\bBAUME\b|\bSHAMPOING\b|\bPATE\b|\bDERMIQUE\b/],
  ["GRANULE", /\bGRANULE\b|\bMICROGRANULE\b|\bPELLETS\b|\bSACHET\b/],
  ["BUVABLE", /\bBUVABLE\b|\bORALE?\b|\bSUCER\b|\bPASTILLE\b/],
  ["POUDRE", /\bPOUDRE\b|\bLYOPHILISAT\b/],
  ["SOLUTION", /\bSOLUTION\b|\bSUSPENSION\b|\bEMULSION\b/],
];

function formGroup(canonical) {
  for (const [name, re] of FORM_GROUPS) if (re.test(canonical)) return name;
  return canonical ? "AUTRE" : "";
}

// Packaging that leaked into the strength column: "1G/SACH.-DOSE", "500MG/FL. DE
// PDRE.", "4MG/FLACON". 254 rows carry it, and it both looks wrong in an autocomplete
// row and blocks the merge against a source that wrote the strength alone.
const PACKAGING_IN_DOSAGE =
  /\/\s*(?:FL|FLACON|SACH|SACHET|AMP|AMPOULE|CUIL\w*|COMP\w*|CP|GELULE|PDRE|POUDRE|PILULIER|BOUTEILLE|CART\w*|SERINGUE|STYLO)\b[^/]*/gi;

/**
 * Dosage is display text, not a number: 90 rows use comma decimals, a handful run to
 * 227 characters of full formulation with embedded newlines. Normalise the separator
 * and spacing; hand anything oversized to `composition` so it cannot blow up an
 * autocomplete row.
 */
function splitDosage(raw) {
  const cleaned = tidy(raw)
    // "O,1%" — a capital O typed for a zero, in the source. Only before a decimal.
    .replace(/\bO(?=[.,]\d)/g, "0")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/\s*\/\s*/g, "/")
    .replace(/(\d)\s+(MG|G|ML|UI|MCG|µG|%)\b/gi, "$1$2")
    .replace(PACKAGING_IN_DOSAGE, "")
    // DZ-Pharma truncates some cells mid-parenthesis ("0.4% ("), leaving orphan
    // punctuation that would otherwise break the merge key.
    .replace(/[(\[{\-–/,;:]+$/, "")
    .trim();
  if (!cleaned) return { dosage: "", composition: null };
  if (cleaned.length > 60 || /…|\.{3}/.test(cleaned)) {
    // A full formulation (dialysis concentrates, infusion bags). Keep a short label.
    const head = cleaned.split(/[…,;]/)[0].trim().slice(0, 40);
    return { dosage: head, composition: cleaned };
  }
  return { dosage: cleaned, composition: null };
}

// Everything reduced to one unit per dimension, so "1G" and "1000MG" are one strength.
const UNIT_TO_BASE = {
  G: ["MG", 1000], MG: ["MG", 1], MCG: ["MG", 0.001], "µG": ["MG", 0.001],
  UG: ["MG", 0.001], L: ["ML", 1000], ML: ["ML", 1],
  UI: ["UI", 1], IU: ["UI", 1], U: ["UI", 1], "%": ["%", 1],
};

/**
 * Reduce a dosage to the set of strengths it states, so the same product matches
 * across sources that write it differently: "1G/SACH.-DOSE" and "1000MG" both reduce
 * to "1000MG", and a combination written "150MG/10MG" matches "10MG/150MG".
 *
 * A bare unit in the denominator is kept as a marker ("10MG/ML" -> "10MG+PERML"), so a
 * concentration is never confused with the plain strength of the same number — without
 * it, ARTIZ 10MG tablets and ARTIZ 10MG/ML oral solution collide.
 */
function dosageKey(dosage) {
  const s = tidy(dosage).toUpperCase().replace(/,/g, ".");
  const parts = [];

  for (const [, num, unit] of s.matchAll(/(\d+(?:\.\d+)?)\s*(MG|MCG|µG|UG|G|ML|L|UI|IU|U|%)\b/g)) {
    const [base, factor] = UNIT_TO_BASE[unit];
    parts.push(`${Number((Number(num) * factor).toFixed(6))}${base}`);
  }
  // "/ML", "/DOSE" — a denominator with no number of its own.
  for (const [, unit] of s.matchAll(/\/\s*(?![\d.])([A-Zµ]+)/g)) {
    parts.push(`PER${UNIT_TO_BASE[unit]?.[0] ?? unit}`);
  }

  if (!parts.length) return normKey(dosage); // no parseable strength — fall back
  return [...new Set(parts)].sort().join("+");
}

/** "B/10 B/15 B/30" and "B/14 ET B/28" are several pack sizes in one cell. */
function splitPackaging(raw) {
  const cleaned = tidy(raw);
  if (!cleaned) return [];
  return cleaned
    .split(/\s+(?:ET|OU|\/OU)\s+|\s*[,;]\s*|(?<=\d)\s+(?=B\/)/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Ministry codes read "01 A 003"; DZ-Pharma writes the same thing as "01A003". */
const normCode = (s) => tidy(s).toUpperCase().replace(/[^A-Z0-9]/g, "") || null;

/**
 * A display-length INN.
 *
 * Both sources record the pharmacopoeia's full salt description — "AMOXICILLINE
 * SODIQUE EXPRIME EN AMOXICILLINE / ACIDE CLAVULANIQUE POTASSIQUE EXPRIME EN ACIDE
 * CLAVULANIQUE" — which is correct and completely unreadable in a dropdown row.
 * "X exprimé en Y" means the product contains salt X delivering Y of active
 * molecule, so Y is the name a doctor recognises. Parenthesised salt forms go the
 * same way: "AMOXICILLINE (TRIHYDRATE)" -> "AMOXICILLINE".
 *
 * The full string is kept in `inn` and stays the thing searches match against —
 * only display uses this.
 */
function shortenInn(inn) {
    if (!inn) return null;
    const parts = inn
        .split("/")
        .map((part) => {
            const cleaned = part
                .replace(/\([^)]*\)/g, " ") // salt form in parentheses
                .replace(/\s+/g, " ")
                .trim();
            // "... EXPRIME EN <molecule>" — keep only what it is expressed as.
            const expressedAs = /\bEXPRIMES?\s+EN\s+(.+)$/i.exec(cleaned);
            return (expressedAs ? expressedAs[1] : cleaned).trim();
        })
        .filter(Boolean);

    // "AMOXICILLINE / AMOXICILLINE" collapses to one name.
    const unique = [...new Set(parts)];
    const short = unique.join(" / ");
    return short && short.length < inn.length ? short : inn;
}

function parseSchedule(raw) {
  const s = tidy(raw).toUpperCase();
  if (/STUP/.test(s)) return "STUPEFIANT";
  if (/\bII\b|LISTE\s*2/.test(s)) return "II";
  if (/\bI\b|LISTE\s*1/.test(s)) return "I";
  return null; // covers "N/D"
}

// ---------------------------------------------------------------------------
// merge keys
// ---------------------------------------------------------------------------

// Registration numbers look like the obvious join key but are written too differently
// across the two sources to use (only 2 of 558 match after normalisation), and 69 are
// duplicated inside DZ-Pharma itself. So a product is identified by brand + strength,
// with the galenic form as an optional third component.
//
// Two keys, because the sources disagree about form far more often than about
// strength: "ARTIZ 10MG COMPRIME" and "ARTIZ 10MG COMPRIME PELLICULE SECABLE" are the
// same product described at different levels of detail. Matching on the strict key
// first and falling back to the loose one keeps genuinely distinct strengths apart
// while still collapsing that kind of disagreement.
const strictKey = (r) => [normKey(r.brand), dosageKey(r.dosage), normKey(r.form)].join("|");
const looseKey = (r) => [normKey(r.brand), dosageKey(r.dosage)].join("|");

// ---------------------------------------------------------------------------
// source 1 — DZ-Pharma
// ---------------------------------------------------------------------------

function loadDzPharma(path) {
  const byLetter = JSON.parse(readFileSync(path, "utf8"));
  const out = [];

  for (const letter of Object.keys(byLetter)) {
    for (const m of byLetter[letter]) {
      // `m.dci` is NOT the INN despite the name — it holds the nomenclature class
      // code ("14B215"). The real international name is in `m.generic`.
      const brand = tidy(m.commercial_name) || tidy(m.name).split(/\s+/)[0];
      if (!brand) continue;

      const form = canonicalForm(m.form);
      const { dosage, composition } = splitDosage(m.dosage);
      const cls = m.class ?? {};

      out.push({
        brand,
        inn: tidy(m.generic) || null,
        form,
        formGroup: formGroup(form),
        formRaw: tidy(m.form) || null,
        dosage,
        composition,
        packaging: splitPackaging(m.conditioning),
        classCode: normCode(m.dci),
        therapeutic: tidy(cls.therapeutic) || null,
        pharmacological: tidy(cls.pharmacological) || null,
        schedule: parseSchedule(m.list),
        refundable: typeof m.refundable === "boolean" ? m.refundable : null,
        country: tidy(m.country) || null,
        lab: tidy(m.lab?.name) || null,
        registration: tidy(m.registration) || null,
        marketed: m.commercialisation !== false,
        source: "dz",
        listVersion: null,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// source 2 — ministry xlsx
// ---------------------------------------------------------------------------

// Columns, from the header at row 17:
//   A N · B N°ENREGISTREMENT · C CODE · D DCI · E NOM DE MARQUE
//   F FORME · G DOSAGE · H CONDITIONNEMENT
function loadMinistrySheet(path) {
  const rows = readXlsx(path);
  const header = rows.find((r) => /N.?ENREGISTREMENT/i.test(Object.values(r.cells).join("|")));
  const firstDataRow = header ? header.row + 1 : 18;
  const out = [];

  for (const { row, cells } of rows) {
    if (row < firstDataRow) continue;
    const brand = tidy(cells.E);
    const inn = tidy(cells.D);
    if (!brand || !inn) continue; // title/banner rows carry only column A

    const { dosage, composition } = splitDosage(cells.G);
    const form = canonicalForm(cells.F);
    out.push({
      brand,
      inn,
      form,
      formGroup: formGroup(form),
      formRaw: tidy(cells.F) || null,
      dosage,
      composition,
      packaging: splitPackaging(cells.H),
      classCode: normCode(cells.C),
      therapeutic: null, // backfilled from DZ-Pharma via classCode below
      pharmacological: null,
      schedule: null, // the ministry sheet does not carry Liste I/II
      refundable: null,
      country: null,
      lab: null,
      registration: tidy(cells.B) || null,
      marketed: true, // it is on the current registration list
      source: "dzpp2025",
      listVersion: "2025",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

for (const [label, p] of [["DZ-Pharma", DZ_PATH], ["ministry sheet", XLSX_PATH]]) {
  if (!existsSync(p)) {
    console.error(`\n  Missing ${label}: ${p}`);
    if (label === "DZ-Pharma") {
      console.error("  Download it with:");
      console.error("    curl -L -o scripts/sources/dz-pharma-meds.json \\");
      console.error("      https://raw.githubusercontent.com/fennecinspace/DZ-Pharma-Data/master/data/meds.json\n");
    }
    process.exit(1);
  }
}

const dz = loadDzPharma(DZ_PATH);
const ministry = loadMinistrySheet(XLSX_PATH);

const stats = {
  dzRaw: dz.length,
  ministryRaw: ministry.length,
  dzDuplicatesCollapsed: 0,
  matchedStrict: 0,
  matchedLoose: 0,
  inserted: 0,
  classBackfilledExact: 0,
  classBackfilledPrefix: 0,
  innBackfilled: 0,
};

// Deduplicate DZ-Pharma against itself (26 repeated names, 69 repeated registrations).
const merged = new Map();
const score = (r) =>
  [r.inn, r.therapeutic, r.pharmacological, r.schedule, r.registration, r.lab]
    .filter(Boolean).length;

for (const rec of dz) {
  const key = strictKey(rec);
  const existing = merged.get(key);
  if (!existing) {
    merged.set(key, rec);
    continue;
  }
  stats.dzDuplicatesCollapsed++;
  if (score(rec) > score(existing)) merged.set(key, rec); // keep the fuller copy
}

// Secondary index for the loose (form-insensitive) pass. A brand+strength that maps to
// more than one product is ambiguous — usually two genuinely different galenic forms of
// the same strength — so those are excluded and left to insert as separate rows.
const byLoose = new Map();
for (const rec of merged.values()) {
  const k = looseKey(rec);
  if (byLoose.has(k)) byLoose.set(k, null); // ambiguous: more than one candidate
  else byLoose.set(k, rec);
}

// classCode -> class labels, learned from DZ-Pharma, used to backfill ministry rows.
const classByCode = new Map();
const classByPrefix = new Map();
const innByCode = new Map();
for (const r of merged.values()) {
  if (!r.classCode) continue;
  if (r.therapeutic || r.pharmacological) {
    if (!classByCode.has(r.classCode)) {
      classByCode.set(r.classCode, { therapeutic: r.therapeutic, pharmacological: r.pharmacological });
    }
    const prefix = r.classCode.slice(0, 3); // "14B" — the therapeutic family
    if (!classByPrefix.has(prefix)) {
      classByPrefix.set(prefix, { therapeutic: r.therapeutic, pharmacological: null });
    }
  }
  if (r.inn && !innByCode.has(r.classCode)) innByCode.set(r.classCode, r.inn);
}

/** Fold a matched ministry row into the DZ record it describes. */
function enrich(existing, rec, viaLooseKey) {
  existing.registration = rec.registration ?? existing.registration;
  existing.classCode = existing.classCode ?? rec.classCode;
  existing.inn = existing.inn ?? rec.inn;
  existing.marketed = true;
  existing.listVersion = "2025";
  existing.source = "both";
  // The ministry spells forms out in full where DZ-Pharma contracts them, so prefer
  // its description when the loose key matched (i.e. when the two disagreed).
  if (viaLooseKey && rec.form && rec.form.length > (existing.form?.length ?? 0)) {
    existing.form = rec.form;
    existing.formGroup = rec.formGroup;
    existing.formRaw = rec.formRaw;
  }
  if (rec.packaging.length > existing.packaging.length) existing.packaging = rec.packaging;
}

// Overlay the ministry sheet. It is five years newer, so where the two describe the
// same product the ministry's registration number and marketed flag win, while the
// DZ record's classes / schedule / refundability are retained — the sheet has none.
for (const rec of ministry) {
  const exact = merged.get(strictKey(rec));
  if (exact) {
    stats.matchedStrict++;
    enrich(exact, rec, false);
    continue;
  }

  const loose = byLoose.get(looseKey(rec));
  if (loose) {
    stats.matchedLoose++;
    enrich(loose, rec, true);
    continue;
  }

  stats.inserted++;
  if (rec.classCode) {
    const byCode = classByCode.get(rec.classCode);
    if (byCode) {
      rec.therapeutic = byCode.therapeutic;
      rec.pharmacological = byCode.pharmacological;
      stats.classBackfilledExact++;
    } else {
      const byPrefix = classByPrefix.get(rec.classCode.slice(0, 3));
      if (byPrefix) {
        rec.therapeutic = byPrefix.therapeutic;
        stats.classBackfilledPrefix++;
      }
    }
  }
  merged.set(strictKey(rec), rec);
  // Register the insert so a second ministry row for the same product folds into this
  // one instead of becoming a third entry.
  const lk = looseKey(rec);
  if (byLoose.has(lk)) byLoose.set(lk, null);
  else byLoose.set(lk, rec);
}

// Backfill a missing INN from another product sharing the same class code.
for (const r of merged.values()) {
  if (!r.inn && r.classCode && innByCode.has(r.classCode)) {
    r.inn = innByCode.get(r.classCode);
    stats.innBackfilled++;
  }
}

// Stable output order: brand, then strength, then form. Independent of input order,
// so re-running the script produces a byte-identical file and a clean git diff.
const records = [...merged.values()].sort((a, b) =>
  a.brand.localeCompare(b.brand, "fr") ||
  a.dosage.localeCompare(b.dosage, "fr") ||
  a.form.localeCompare(b.form, "fr"));

// A stable natural key for upserting on re-seed, so SQLite row ids survive a rebuild
// and foreign keys from prescription_medicines keep pointing at the right product.
// Derived last, once every backfill above has settled.
for (const r of records) {
  r.key = strictKey(r);
  r.innShort = shortenInn(r.inn);
}

const payload = {
  $schema: "ausculta/medications@1",
  generatedBy: "scripts/build-drug-list.mjs",
  sources: [
    { id: "dz", name: "DZ-Pharma-Data (pharmnet-dz.com scrape)", snapshot: "2020-03", license: "unspecified" },
    { id: "dzpp2025", name: "Liste des produits pharmaceutiques enregistrés 2025 — Ministère de l'Industrie Pharmaceutique", snapshot: "2025", license: "public ministry document" },
  ],
  count: records.length,
  medications: records,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(payload, null, 0) + "\n", "utf8");

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const count = (pred) => records.filter(pred).length;
const distinct = (pick) => new Set(records.map(pick).filter(Boolean)).size;
const pct = (n) => `${((100 * n) / records.length).toFixed(1)}%`;

const bySource = {};
for (const r of records) bySource[r.source] = (bySource[r.source] ?? 0) + 1;

const fieldRows = [
  ["brand", count((r) => r.brand)],
  ["inn", count((r) => r.inn)],
  ["form", count((r) => r.form)],
  ["dosage", count((r) => r.dosage)],
  ["packaging", count((r) => r.packaging.length)],
  ["classCode", count((r) => r.classCode)],
  ["therapeutic", count((r) => r.therapeutic)],
  ["pharmacological", count((r) => r.pharmacological)],
  ["schedule", count((r) => r.schedule)],
  ["refundable", count((r) => r.refundable !== null)],
  ["lab", count((r) => r.lab)],
  ["registration", count((r) => r.registration)],
];

const scheduleCounts = {};
for (const r of records) scheduleCounts[r.schedule ?? "unknown"] = (scheduleCounts[r.schedule ?? "unknown"] ?? 0) + 1;

const groupCounts = {};
for (const r of records) groupCounts[r.formGroup || "(none)"] = (groupCounts[r.formGroup || "(none)"] ?? 0) + 1;

// Rows sharing a brand and a strength but differing in form. Mostly genuine (a 500mg
// tablet and a 500mg injection are different products), but where the two sources
// disagree it can also mean the same product was described twice and the merge refused
// to guess which DZ row the ministry row referred to. Worth eyeballing after a refresh.
const byBrandStrength = new Map();
for (const r of records) {
  const k = `${normKey(r.brand)}|${dosageKey(r.dosage)}`;
  if (!byBrandStrength.has(k)) byBrandStrength.set(k, []);
  byBrandStrength.get(k).push(r);
}
const ambiguous = [...byBrandStrength.values()]
  .filter((g) => g.length > 1 && new Set(g.map((r) => r.source)).size > 1);

const bytes = Buffer.byteLength(JSON.stringify(payload));
const report = `# Drug list build report

Generated by \`scripts/build-drug-list.mjs\`. Regenerate with \`npm run build:drugs\`.

- **${records.length}** medications, ${(bytes / 1024 / 1024).toFixed(2)} MB of JSON
- Sources: DZ-Pharma ${stats.dzRaw} rows, ministry sheet ${stats.ministryRaw} rows
- ${stats.dzDuplicatesCollapsed} duplicate DZ-Pharma rows collapsed
- Ministry overlay: ${stats.matchedStrict} matched on brand+strength+form, ${stats.matchedLoose} on brand+strength only, ${stats.inserted} inserted as new
- Class labels backfilled onto new rows: ${stats.classBackfilledExact} by exact code, ${stats.classBackfilledPrefix} by code prefix
- ${stats.innBackfilled} missing INNs recovered from a sibling product
- ${ambiguous.length} brand+strength groups still span both sources — possible unmerged duplicates${ambiguous.length ? ` (${ambiguous.slice(0, 6).map((g) => g[0].brand).join(", ")}${ambiguous.length > 6 ? ", …" : ""})` : ""}

## Provenance

| source | rows | meaning |
|---|---|---|
${Object.entries(bySource).map(([k, v]) => `| \`${k}\` | ${v} | ${
  k === "dz" ? "DZ-Pharma only — not on the 2025 registration list"
  : k === "both" ? "in both sources"
  : "2025 registration list only — unknown to DZ-Pharma"}  |`).join("\n")}

## Field coverage

| field | populated | % |
|---|---|---|
${fieldRows.map(([k, v]) => `| ${k} | ${v} | ${pct(v)} |`).join("\n")}

## Regulatory schedule

| schedule | rows |
|---|---|
${Object.entries(scheduleCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`).join("\n")}

## Form groups

| group | rows |
|---|---|
${Object.entries(groupCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`).join("\n")}

## Vocabulary size

- distinct brands: ${distinct((r) => r.brand)}
- distinct INNs: ${distinct((r) => r.inn)}
- distinct canonical forms: ${distinct((r) => r.form)} (from ${distinct((r) => r.formRaw)} raw spellings)
- distinct therapeutic classes: ${distinct((r) => r.therapeutic)}
- distinct pharmacological classes: ${distinct((r) => r.pharmacological)}
- distinct labs: ${distinct((r) => r.lab)}
`;

writeFileSync(REPORT_PATH, report, "utf8");

console.log(`\n  ${records.length} medications -> ${OUT_PATH.replace(ROOT + "\\", "").replace(ROOT + "/", "")}`);
console.log(`  ${(bytes / 1024 / 1024).toFixed(2)} MB   report -> ${REPORT_PATH.replace(ROOT + "\\", "").replace(ROOT + "/", "")}`);
console.log(`  matched ${stats.matchedStrict} strict + ${stats.matchedLoose} loose, new ${stats.inserted}, deduped ${stats.dzDuplicatesCollapsed}`);
console.log(`  forms: ${distinct((r) => r.formRaw)} raw spellings -> ${distinct((r) => r.form)} canonical, ${distinct((r) => r.formGroup)} groups\n`);
