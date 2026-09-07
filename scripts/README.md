# Operator scripts

Command-line tools for running Ausculta as a product: issuing licences to
customers, unblocking them when they change computer, shipping new versions, and
rebuilding the bundled drug list.

None of this ships inside the app. These are the things you run from your own
machine, and they are the only way to do these jobs — there is no admin UI.

| Script | What it does | How often |
|---|---|---|
| [`generate-license-keypair.mjs`](#generate-license-keypairmjs) | Creates the signing keypair the whole licence system rests on | Once, ever |
| [`issue-license.mjs`](#issue-licensemjs) | Mints a licence key for a customer | Every sale |
| [`release-device.mjs`](#release-devicemjs) | Frees a customer's device slots | Support requests |
| [`publish-release.mjs`](#publish-releasemjs) | Uploads a built release so clients auto-update | Every release |
| [`build-drug-list.mjs`](#build-drug-listmjs) | Rebuilds `public/data/medications.json` | When a new registration list is published |

## Setup

The four licence and release scripts read credentials from
`license-server/.env.local` (the same file `vercel dev` uses), falling back to
real environment variables. Copy `license-server/.env.example` and fill it in
before using anything here. `build-drug-list.mjs` needs no credentials.

Which variables each script needs is listed below. Nothing here is committed —
`.env.local` and `scripts/keys/` are both gitignored.

---

## `generate-license-keypair.mjs`

Creates the Ed25519 keypair used to sign activation tokens.

```bash
node scripts/generate-license-keypair.mjs
```

Writes `scripts/keys/license_private.pem` and `license_public.pem`. Then:

- paste the **public** key into `LICENSE_PUBLIC_KEY_PEM` in
  `electron/services/trial.ts`
- set the **private** key as `LICENSE_PRIVATE_KEY` in Vercel

The private key signs activation tokens on the server; the public key, compiled
into the app, verifies them offline on every launch. That split is what lets an
activated copy run forever without internet while making tokens unforgeable —
someone who redirects `api.ausculta.site` at their own machine still cannot
produce a signature the app accepts.

> **You should never need to run this again.** The keypair already exists.
> Replacing it invalidates every activation in the field, and every customer
> would have to re-activate. The script refuses to overwrite without `--force`
> for that reason.
>
> **Back up `license_private.pem` somewhere outside this repo.** It is
> gitignored, so a fresh clone or a stray `git clean -xdf` destroys it, and with
> it your ability to sign for anyone.

---

## `issue-license.mjs`

Mints a licence key and registers it in Supabase. This is what you run when
somebody pays.

```bash
node scripts/issue-license.mjs "Dr. Yahia Benlaoukli"
node scripts/issue-license.mjs "Dr. X" --email dr.x@mail.com --devices 3
node scripts/issue-license.mjs "Clinique Y" --plan subscription --expires 2027-01-01
```

| Option | Default | Meaning |
|---|---|---|
| `--email <address>` | none | Stored for support lookup |
| `--devices <n>` | `3` | Machines the key may be active on at once |
| `--plan <perpetual\|subscription>` | `perpetual` | Subscription requires `--expires` |
| `--expires <YYYY-MM-DD>` | none | When a subscription lapses |
| `--notes <text>` | none | Free-form note on the row |

Needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.

Prints a key like `AUSC-7K3M-9QP2-XR4T-8WNZ` — 80 bits of entropy, in an
alphabet with no `I`, `L`, `O` or `U`, so it survives being read out over the
phone or typed from a photo.

> **The key is printed once and is not stored.** Only its SHA-256 goes to the
> database, so a leaked database hands out nothing usable. If a customer loses
> their key you cannot recover it — revoke the row in Supabase and issue a new
> one.

Why three devices by default: reinstalling Ausculta on the same PC costs
nothing (the fingerprint is unchanged), but reinstalling *Windows* does. Three
absorbs that without a support call.

---

## `release-device.mjs`

Frees the device slots on a licence, for the customer who has used all three
and bought a new computer.

```bash
node scripts/release-device.mjs AUSC-7K3M-9QP2-XR4T-8WNZ
node scripts/release-device.mjs AUSC-... --fingerprint <sha256>
```

Without `--fingerprint` every device on the key is released, which is the usual
"just reset me" request. The customer then re-enters the **same** key on the new
machine — they do not need a new one.

Needs `ADMIN_TOKEN`, and calls the live `/api/release` endpoint. Set
`AUSCULTA_API_URL` to point somewhere other than production.

Released rows are kept rather than deleted, so the history of which machines ran
a licence survives the reset.

---

## `publish-release.mjs`

Uploads a built release to Cloudflare R2, where `/api/updates` serves it to the
auto-updater through signed URLs.

```bash
npm run release                            # build, then upload
node scripts/publish-release.mjs           # upload a build that already exists
node scripts/publish-release.mjs --dry-run  # show what would upload
```

Needs `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

Reads the version from `package.json` and uploads from `release/<version>/`:

- `Ausculta-Windows-<version>-Setup.exe` — the installer
- `...Setup.exe.blockmap` — lets later updates fetch only changed chunks
- `latest.yml` — the manifest clients poll

`builder-debug.yml` is skipped.

Installers upload **first** and `latest.yml` **last**, deliberately.
`latest.yml` is what announces a release to every running copy, so publishing it
before the file it names would send clinics chasing something still uploading.

### Releasing checklist

1. Bump `version` in `package.json` — **never reuse a number**. Clients key on
   version, and a changed installer under an old number fails the SHA-512 check
   in `latest.yml`.
2. `npm run release`
3. `curl -I https://api.ausculta.site/api/updates/latest.yml` → expect `302`

The website picks the new version up on its own: `/api/download_link` reads the
filename out of `latest.yml`, so there is nothing to update by hand.

> Electron builds are not reproducible — rebuilding the same source produces a
> different hash. Once a version is published, treat R2 as authoritative and do
> not re-upload it. If you need the exact published installer, download it
> rather than rebuilding.

---

## `build-drug-list.mjs`

Rebuilds `public/data/medications.json`, the ~5,350-product Algerian drug list
that backs prescription autocomplete. Zero dependencies — it reads the `.xlsx`
with a small inline ZIP reader rather than pulling in SheetJS, because this repo's
`node_modules` carries native modules that are painful to rebuild.

```
npm run build:drugs      # build, then run the invariant + autocomplete smoke test
```

### Inputs

Both live in `scripts/sources/`:

| File | Rows | Committed | Notes |
|---|---|---|---|
| `dzpp-2025.xlsx` | 560 | yes | *Liste des produits pharmaceutiques enregistrés 2025*, Ministère de l'Industrie Pharmaceutique. A public document. Narrow, but current. |
| `dz-pharma-meds.json` | 5,151 | **no** | [DZ-Pharma-Data](https://github.com/fennecinspace/DZ-Pharma-Data), itself scraped from pharmnet-dz.com. Broad, but a March 2020 snapshot. |

The DZ-Pharma dump is gitignored because **the upstream repo declares no
licence**. Re-download it before building:

```
curl -L -o scripts/sources/dz-pharma-meds.json \
  https://raw.githubusercontent.com/fennecinspace/DZ-Pharma-Data/master/data/meds.json
```

Every row it contributes is tagged `source: "dz"`, so if the licence question ever
forces it out, those rows can be dropped without rebuilding anything else. Rows
from the ministry sheet are tagged `dzpp2025`, and `both` where the two agree.

### What the merge does

The ministry sheet is five years newer and wins on conflict; DZ-Pharma supplies the
fields the sheet has no column for — therapeutic and pharmacological class, the
Liste I/II/Stupéfiants schedule, CNAS refundability, and the manufacturer.

Registration numbers look like the obvious join key but are unusable: only 2 of 558
match across the two sources, and 69 are duplicated inside DZ-Pharma. So products
are matched on **brand + strength**, strictly (form included) and then loosely (form
ignored), because the sources disagree about form far more often than about strength
— `ARTIZ 10MG COMPRIME` and `ARTIZ 10MG COMPRIME PELLICULE SECABLE` are one product
written at two levels of detail. Where a brand+strength has more than one candidate,
the merge refuses to guess and leaves both rows; the build report counts those.

Strengths are normalised to one unit per dimension so `1G` matches `1000MG`, and a
bare denominator is kept as a marker (`10MG/ML` → `10MG+PERML`) so a concentration is
never confused with a plain strength of the same number.

### Cleaning

- **Encoding.** ~0.8% of DZ-Pharma strings are double-encoded UTF-8
  (`StupÃ©fiants`, `CRÃˆME`). One latin-1→UTF-8 round-trip repairs all of them; the
  smoke test asserts none survive.
- **Forms.** Both sources abbreviate galenic forms past recognition and
  inconsistently — `GLES` for gélules, `COLLY` for collyre, `SEC` for sécable,
  `COMP. PELLI` for comprimé pelliculé. Tokens are expanded from a dictionary
  **derived from real token frequencies**, not guessed: 248 raw spellings collapse to
  186 canonical forms plus a coarse 16-value `formGroup` for grouping and short
  labels. `formRaw` keeps the original. After a data refresh, regenerate the
  frequency list with `node scripts/sources/tokens.mjs` and add whatever new
  abbreviations show up.
- **Strengths.** Comma decimals → dots, `O,1%` → `0.1%` (a capital O typed for a
  zero, in the source), and packaging that leaked into the strength column stripped
  (`1G/SACH.-DOSE` → `1G`, 254 rows). Formulations too long for an autocomplete row —
  dialysis concentrates run to 227 characters — move to a separate `composition`
  field.
- **Packaging.** `B/14 ET B/28` and `B/10 B/15 B/30` split into an array.

### Outputs

- `public/data/medications.json` — bundled into the app by `electron-builder.json`'s
  `extraResources` (`public/` → `public/`), so it resolves under
  `process.resourcesPath` in production and `public/` in dev. ~2.5 MB, sorted
  deterministically so a rebuild produces a byte-identical file and a clean diff.
- `scripts/sources/build-report.md` — row counts, field coverage, vocabulary sizes,
  and the list of brand+strength groups that stayed ambiguous. Read this after every
  refresh.

Each record carries a `key` (brand|strength|form) intended as the natural key for
upserting into SQLite, so row ids survive a rebuild and any foreign key from
`prescription_medicines` keeps pointing at the right product.

### Refreshing next year

1. Drop the new ministry sheet in as `scripts/sources/dzpp-2025.xlsx` (or pass
   `--xlsx`), re-download the DZ dump if you still want it.
2. `npm run build:drugs`
3. Read `build-report.md`. Watch the ambiguous-group count and the raw→canonical form
   ratio — a jump in either means new spellings need adding to `FORM_TOKENS`.

### Caveats

- The list has **no interactions, contraindications, or posology**. It is good for
  name/strength/form lookup, generic substitution and schedule warnings; it cannot
  support prescription safety checking.
- DZ-Pharma's `ppa` price field is dropped: only 24% populated and six years stale.
- DZ-Pharma's field named `dci` is *not* the INN — it holds the nomenclature class
  code (`14B215`). The real international name is in `generic`. The output calls
  these `classCode` and `inn` respectively.

---

## Related

- `license-server/README.md` — the activation server, Supabase schema, R2 setup
  and the endpoints these scripts call
- `license-server/schema.sql` — licence and activation tables
