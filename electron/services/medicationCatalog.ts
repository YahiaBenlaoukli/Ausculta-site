// Lookup over the national drug catalogue — the ~5,350 products registered for
// sale in Algeria, bundled as public/data/medications.json by
// scripts/build-drug-list.mjs.
//
// Deliberately not a database table. The whole catalogue is ~2.5 MB of read-only
// reference data that changes once a year when the ministry publishes a new
// registration list, so it is read once into memory and scanned. At 5,350 rows a
// linear scan with a scoring function costs well under a millisecond — an index
// (FTS5 or otherwise) would add a migration, a seeding step and a second source
// of truth to buy nothing measurable.
//
// What this file does NOT know: interactions, contraindications, paediatric
// dosing. Neither upstream source carries them. It is safe for name / strength /
// form lookup, generic substitution and schedule warnings, and unsafe as an
// input to anything that looks like a prescription safety check.
import fs from "node:fs";
import path from "node:path";
import { normalizeSearchText } from "../db/normalize";
import type {
    CatalogMedication,
    MedicationAlternative,
    MedicationCatalogFile,
    MedicationCatalogInfo,
    MedicationDetail,
    MedicationFacet,
    MedicationFacets,
    MedicationFilters,
    MedicationPage,
} from "../../types/medication";

/** Rows per page in the catalogue browser. */
const BROWSE_PAGE_SIZE = 50;

/**
 * One catalogue row plus the folded strings a query is compared against.
 *
 * Folding happens once at load, not per keystroke: doing it inside the scan
 * would mean re-normalising 5,350 brands and INNs on every character typed.
 */
type IndexedMedication = {
    med: CatalogMedication;
    /** Folded brand — the primary thing doctors type. */
    brand: string;
    /** Folded INN, so typing "amoxicilline" finds AUGMENTIN. */
    inn: string;
    /** Folded strength, so "amox 500" can match on the second term. */
    dosage: string;
    /** Folded display molecule — the substitution key, see getMedicationDetail. */
    molecule: string;
};

let index: IndexedMedication[] | null = null;
/** Set once loading has been attempted, so a missing bundle is not retried per keystroke. */
let loadAttempted = false;

/**
 * Resolve the bundled catalogue.
 *
 * VITE_PUBLIC is the project's `public/` in dev and the packaged renderer output
 * in production (Vite copies `public/` into it), which is the same indirection
 * htmlPdf.ts uses for the Amiri fonts.
 */
function catalogPath(): string {
    return path.join(process.env.VITE_PUBLIC ?? "", "data", "medications.json");
}

/**
 * Read and fold the catalogue, once per process.
 *
 * A missing or malformed bundle is not fatal: autocomplete falls back to the
 * doctor's own history, which is the more useful half anyway. It is logged once
 * rather than on every keystroke.
 */
function getIndex(): IndexedMedication[] {
    if (index) return index;
    if (loadAttempted) return [];
    loadAttempted = true;

    try {
        const raw = fs.readFileSync(catalogPath(), "utf8");
        const parsed = JSON.parse(raw) as MedicationCatalogFile;

        if (!Array.isArray(parsed?.medications)) {
            throw new Error("medications.json has no `medications` array");
        }

        index = parsed.medications.map((med) => ({
            med,
            brand: normalizeSearchText(med.brand),
            inn: normalizeSearchText(med.inn),
            dosage: normalizeSearchText(med.dosage),
            // innShort is the build script's salt-stripped name, so two brands of
            // the same drug fold to the same molecule even where their full INN
            // strings disagree about how to spell the salt.
            molecule: normalizeSearchText(med.innShort ?? med.inn),
        }));
        console.log(`medication catalogue: ${index.length} products loaded`);
        return index;
    } catch (error) {
        console.error("medication catalogue unavailable:", (error as Error).message);
        return [];
    }
}

/**
 * Score one product against a folded query. 0 means "no match, drop it".
 *
 * The tiers encode what a doctor typing into a prescription actually means: the
 * brand they are reaching for comes first, an exact hit beats a prefix, a prefix
 * beats a word start, and a word start beats a substring buried mid-name.
 * Shorter names win inside a tier, so "ARTIZ" precedes "ARTIZOL" for "arti".
 *
 * The INN tiers sit below the brand ones but above brand substrings, which is
 * what makes typing a molecule ("amoxicilline") surface the brands that contain
 * it without burying the brand whose own name starts that way.
 */
function scoreOf(entry: IndexedMedication, query: string, terms: string[]): number {
    const { brand, inn, dosage } = entry;
    let score = 0;

    if (brand === query) score = 1000;
    else if (brand.startsWith(query)) score = 900 - Math.min(brand.length, 60);
    else if (inn.startsWith(query)) score = 700 - Math.min(inn.length, 60);
    else if (brand.includes(` ${query}`)) score = 600;
    else if (brand.includes(query)) score = 400;
    else if (inn.includes(query)) score = 300;
    else if (terms.length > 1) {
        // "amox 500" — every term has to land somewhere, but they may land in
        // different fields. This is the tier that makes strength-narrowing work.
        const all = terms.every(
            (term) => brand.includes(term) || inn.includes(term) || dosage.includes(term)
        );
        if (all) score = 200;
    }

    if (!score) return 0;

    // Currency beats breadth. A product on the 2025 registration list is one the
    // pharmacy can actually dispense; a 2020-only row may have been withdrawn.
    if (entry.med.source !== "dz") score += 40;
    if (entry.med.marketed) score += 10;
    return score;
}

/** Trim a catalogue row down to what the renderer needs to draw a suggestion. */
function toInfo(med: CatalogMedication): MedicationCatalogInfo {
    return {
        // The short form: the full salt description is what searches match, but it
        // is unreadable in a dropdown row.
        inn: med.innShort ?? med.inn,
        form: med.form,
        formGroup: med.formGroup,
        packaging: med.packaging,
        pharmacological: med.pharmacological,
        schedule: med.schedule,
        refundable: med.refundable,
        lab: med.lab,
        onCurrentList: med.source !== "dz",
        key: med.key,
    };
}

/**
 * The catalogue products best matching `query`, best first.
 *
 * `excludeFolded` holds folded names already offered from the doctor's own
 * history, so the same drug is never listed twice — the history row is strictly
 * better, since it carries the posology.
 *
 * An empty query returns nothing on purpose: 5,350 products in no particular
 * order is noise. Focusing an empty field should show the doctor their own
 * shortlist, which is the history half of the caller's job.
 */
export function searchMedicationCatalog(
    query: string,
    limit: number,
    excludeFolded: Set<string> = new Set()
): { medicine: { medicineName: string; dosage: string }; catalog: MedicationCatalogInfo }[] {
    if (limit <= 0) return [];

    const folded = normalizeSearchText(query);
    if (folded.length < 2) return [];
    const terms = folded.split(" ").filter(Boolean);

    const hits: { entry: IndexedMedication; score: number }[] = [];
    for (const entry of getIndex()) {
        if (excludeFolded.has(entry.brand)) continue;
        const score = scoreOf(entry, folded, terms);
        if (score) hits.push({ entry, score });
    }

    hits.sort(
        (a, b) =>
            b.score - a.score ||
            a.entry.brand.length - b.entry.brand.length ||
            a.entry.med.brand.localeCompare(b.entry.med.brand, "fr")
    );

    return hits.slice(0, limit).map(({ entry }) => ({
        medicine: { medicineName: entry.med.brand, dosage: entry.med.dosage },
        catalog: toInfo(entry.med),
    }));
}

// ---------------------------------------------------------------------------
// The catalogue browser.
//
// Everything below is reached over IPC rather than from another service, so it
// follows the { status, data } convention the renderer branches on, unlike
// searchMedicationCatalog above which is called in-process by
// prescriptionLibrary and returns a bare array.
// ---------------------------------------------------------------------------

/** Does this row pass the non-text filters? Text is handled by `scoreOf`. */
function matchesFilters(entry: IndexedMedication, filters: MedicationFilters): boolean {
    const { med } = entry;

    if (filters.formGroup && med.formGroup !== filters.formGroup) return false;
    if (filters.therapeutic && med.therapeutic !== filters.therapeutic) return false;
    if (filters.schedule && med.schedule !== filters.schedule) return false;
    // Only `true` filters. `false` and `null` both mean "not known to be
    // refundable" — the source is silent on 27% of rows — and promising a refund
    // the patient does not get is the more damaging of the two mistakes.
    if (filters.refundable && med.refundable !== true) return false;
    if (filters.onCurrentList && med.source === "dz") return false;

    return true;
}

/**
 * One page of the catalogue, filtered and ranked.
 *
 * With a query of two characters or more the ranking is autocomplete's, so the
 * page and the dropdown agree about what "best match" means. Without one, the
 * catalogue's own order is kept: the build script sorts by brand and verify.mjs
 * asserts it, so leaving it alone is already alphabetical and — unlike a sort
 * over a filtered subset — keeps paging stable as the doctor walks the pages.
 */
export function browseMedications(
    filters: MedicationFilters = {},
    page: number = 1,
    pageSize: number = BROWSE_PAGE_SIZE
) {
    try {
        // Clamped rather than trusted: the page size arrives from the renderer and
        // a large one would serialise the whole catalogue over IPC.
        const size = Math.max(1, Math.min(Math.floor(pageSize) || BROWSE_PAGE_SIZE, 200));

        const folded = normalizeSearchText(filters.query ?? "");
        const terms = folded.split(" ").filter(Boolean);
        // Below two characters the query counts as absent rather than as a filter
        // almost nothing passes: the doctor is mid-word, and emptying the list on
        // the first keystroke reads as breakage.
        const ranked = folded.length >= 2;

        const hits: { entry: IndexedMedication; score: number }[] = [];
        for (const entry of getIndex()) {
            if (!matchesFilters(entry, filters)) continue;
            const score = ranked ? scoreOf(entry, folded, terms) : 1;
            if (score) hits.push({ entry, score });
        }

        if (ranked) {
            hits.sort(
                (a, b) =>
                    b.score - a.score ||
                    a.entry.brand.length - b.entry.brand.length ||
                    a.entry.med.brand.localeCompare(b.entry.med.brand, "fr")
            );
        }

        const total = hits.length;
        const lastPage = Math.max(1, Math.ceil(total / size));
        // Clamped so a filter change that shrinks the result set below the current
        // page shows the last page rather than an empty one.
        const current = Math.min(Math.max(1, Math.floor(page) || 1), lastPage);
        const start = (current - 1) * size;

        const data: MedicationPage = {
            items: hits.slice(start, start + size).map((hit) => hit.entry.med),
            total,
            page: current,
            pageSize: size,
        };
        return { status: "success", data };
    } catch (error) {
        console.error("browseMedications error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/** Count one field's distinct values, commonest first. */
function countBy(
    entries: IndexedMedication[],
    pick: (med: CatalogMedication) => string | null
): MedicationFacet[] {
    const counts = new Map<string, number>();
    for (const { med } of entries) {
        const value = pick(med);
        if (!value) continue;
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "fr"));
}

/** Memoised: the catalogue is read-only, so the counts can never go stale. */
let facets: MedicationFacets | null = null;

/**
 * The values worth offering as filters, counted from the data.
 *
 * Therapeutic class is included and pharmacological class is not, deliberately:
 * 101 therapeutic classes make a usable menu, 180 pharmacological ones do not,
 * and the finer split belongs on the detail panel where it is read rather than
 * chosen from.
 */
export function getMedicationFacets() {
    try {
        if (!facets) {
            const entries = getIndex();
            facets = {
                formGroups: countBy(entries, (med) => med.formGroup),
                therapeutic: countBy(entries, (med) => med.therapeutic),
                schedules: countBy(entries, (med) => med.schedule),
                total: entries.length,
                onCurrentList: entries.filter((entry) => entry.med.source !== "dz").length,
            };
        }
        return { status: "success", data: facets };
    } catch (error) {
        console.error("getMedicationFacets error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

/** Memoised key→row map, built on the first detail lookup. */
let byKey: Map<string, IndexedMedication> | null = null;

function keyIndex(): Map<string, IndexedMedication> {
    if (!byKey) byKey = new Map(getIndex().map((entry) => [entry.med.key, entry]));
    return byKey;
}

/**
 * One product, plus what could be dispensed in its place.
 *
 * Alternatives are every other row sharing the folded molecule, ordered
 * same-strength-and-form first, because that is the only swap that is purely a
 * change of brand — a different strength is a dose decision and a different form
 * may not suit the patient. Products on the current registration list are
 * preferred within a tier, since those are the ones a pharmacy can actually
 * supply.
 *
 * This answers "what else is this drug called", which is the question the
 * catalogue is good for. It cannot answer whether the swap is appropriate for
 * this patient: there is no interaction or contraindication data behind it.
 */
export function getMedicationDetail(key: string) {
    try {
        const entry = keyIndex().get(key);
        if (!entry) {
            return { status: "not_found", message: `no catalogue product with key ${key}` };
        }

        const alternatives: MedicationAlternative[] = [];
        if (entry.molecule) {
            for (const other of getIndex()) {
                if (other.med.key === key) continue;
                if (other.molecule !== entry.molecule) continue;
                alternatives.push({
                    ...other.med,
                    sameStrength: other.dosage === entry.dosage,
                    sameForm: other.med.formGroup === entry.med.formGroup,
                });
            }
            alternatives.sort(
                (a, b) =>
                    Number(b.sameStrength) - Number(a.sameStrength) ||
                    Number(b.sameForm) - Number(a.sameForm) ||
                    Number(b.source !== "dz") - Number(a.source !== "dz") ||
                    a.brand.localeCompare(b.brand, "fr")
            );
        }

        const data: MedicationDetail = { medication: entry.med, alternatives };
        return { status: "success", data };
    } catch (error) {
        console.error("getMedicationDetail error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}
