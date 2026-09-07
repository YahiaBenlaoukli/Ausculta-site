// The national drug catalogue: ~5,350 products registered for sale in Algeria,
// built from two public sources by `scripts/build-drug-list.mjs` and bundled as
// `public/data/medications.json`. See `scripts/README.md` for provenance.
//
// This is reference data, not practice data. It never changes at runtime and it
// lives in no table — the main process reads the JSON once and answers lookups
// from memory (5,350 rows is ~2.5 MB, far too small to be worth indexing).

/**
 * Regulatory schedule. `I` and `II` are the two prescription-control lists;
 * `STUPEFIANT` is a narcotic, which in Algeria additionally requires a
 * carnet à souches rather than an ordinary prescription. `null` where the
 * source did not say.
 */
export type MedicationSchedule = 'I' | 'II' | 'STUPEFIANT';

/** Which source a catalogue row came from — see scripts/README.md. */
export type MedicationSource = 'dz' | 'dzpp2025' | 'both';

/** One product exactly as it appears in `public/data/medications.json`. */
export type CatalogMedication = {
    /** Commercial name, upper-case as both sources write it. */
    brand: string;
    /** International non-proprietary name (the DCI), as the source records it —
     *  which includes the full salt description. Searches match this. */
    inn: string | null;
    /** `inn` reduced to the molecule a doctor recognises, for display:
     *  "AMOXICILLINE SODIQUE EXPRIME EN AMOXICILLINE / ACIDE CLAVULANIQUE
     *  POTASSIQUE EXPRIME EN ACIDE CLAVULANIQUE" -> "AMOXICILLINE / ACIDE
     *  CLAVULANIQUE". Equal to `inn` where there was nothing to strip. */
    innShort: string | null;
    /** Galenic form, abbreviations expanded: "COMPRIME PELLICULE". */
    form: string;
    /** Coarse bucket of `form`, ~16 values, for grouping and short labels. */
    formGroup: string;
    /** The form as the source wrote it ("COMP. PELLI"), kept for audit. */
    formRaw: string | null;
    /** Strength as display text — never parse it, see `composition`. */
    dosage: string;
    /** Full formulation, when it was too long to sit in `dosage`. */
    composition: string | null;
    /** Pack sizes; "B/14 ET B/28" arrives as two entries. */
    packaging: string[];
    /** Algerian nomenclature class code, e.g. "13G050". */
    classCode: string | null;
    therapeutic: string | null;
    pharmacological: string | null;
    schedule: MedicationSchedule | null;
    /** CNAS refundability. `null` where the source did not say. */
    refundable: boolean | null;
    country: string | null;
    lab: string | null;
    registration: string | null;
    marketed: boolean;
    source: MedicationSource;
    /** "2025" when the product is on the current registration list. */
    listVersion: string | null;
    /** brand|strength|form — stable across rebuilds. */
    key: string;
};

/** The file's shape, so a malformed or half-written bundle fails loudly. */
export type MedicationCatalogFile = {
    $schema: string;
    generatedBy: string;
    sources: { id: string; name: string; snapshot: string; license: string }[];
    count: number;
    medications: CatalogMedication[];
};

/**
 * Filters for the catalogue browser. Every field is optional, an omitted one
 * means "any", and they combine with AND — which is what a doctor narrowing a
 * list expects.
 */
export type MedicationFilters = {
    /** Free text over brand, molecule and strength; folded like autocomplete. */
    query?: string;
    /** Coarse galenic bucket (`CatalogMedication.formGroup`), e.g. "COMPRIME". */
    formGroup?: string;
    /** Therapeutic class, exactly as the catalogue spells it. */
    therapeutic?: string;
    schedule?: MedicationSchedule;
    /** Keep only CNAS-refundable products. Rows the source is silent on are
     *  excluded rather than assumed either way — see `matchesFilters`. */
    refundable?: boolean;
    /** Keep only products on the 2025 registration list. */
    onCurrentList?: boolean;
};

/** One page of browse results, plus the unpaginated total for the count. */
export type MedicationPage = {
    items: CatalogMedication[];
    /** Matches before slicing — what the result count reports. */
    total: number;
    /** The page actually returned, which may be clamped from the one asked for. */
    page: number;
    pageSize: number;
};

/** One filter value and how many catalogue rows carry it. */
export type MedicationFacet = { value: string; count: number };

/**
 * The filter vocabulary, counted from the catalogue rather than hardcoded, so a
 * data refresh that adds a class or a galenic form shows up in the UI without a
 * code change.
 */
export type MedicationFacets = {
    formGroups: MedicationFacet[];
    therapeutic: MedicationFacet[];
    schedules: MedicationFacet[];
    total: number;
    /** How many of `total` are on the current registration list. */
    onCurrentList: number;
};

/**
 * A product sharing a molecule with a reference product — a substitution
 * candidate. The two flags say how safe the swap is, because only some of these
 * are a pure change of brand.
 */
export type MedicationAlternative = CatalogMedication & {
    /** Same strength. Swapping at a different strength is a dose change. */
    sameStrength: boolean;
    /** Same coarse form. A tablet may not substitute for a syrup. */
    sameForm: boolean;
};

/** A catalogue product together with what could be dispensed instead. */
export type MedicationDetail = {
    medication: CatalogMedication;
    /**
     * Other brands of the same molecule, best swap first. Empty when the
     * molecule is unknown (1.3% of rows carry no INN) — the catalogue cannot
     * offer a substitution for a product it cannot identify. Never truncated:
     * a shortened list of alternatives would read as "these are all of them".
     */
    alternatives: MedicationAlternative[];
};

/**
 * The subset of a catalogue product that travels to the renderer with an
 * autocomplete suggestion — enough to tell two products of the same brand apart
 * and to warn about a controlled drug, without shipping the whole record.
 */
export type MedicationCatalogInfo = {
    /** The display-length molecule name (`CatalogMedication.innShort`) — matching
     *  happens in the main process against the full string, so the renderer only
     *  ever needs the readable one. */
    inn: string | null;
    form: string;
    formGroup: string;
    packaging: string[];
    pharmacological: string | null;
    schedule: MedicationSchedule | null;
    refundable: boolean | null;
    lab: string | null;
    /** On the 2025 registration list — i.e. known to be currently registered. */
    onCurrentList: boolean;
    /** Catalogue identity, unique per product; safe as a React key. */
    key: string;
};
