# Operator scripts

Command-line tools for running Ausculta as a product: issuing licences to
customers, unblocking them when they change computer, and shipping new versions.

None of this ships inside the app. These are the things you run from your own
machine, and they are the only way to do these jobs — there is no admin UI.

| Script | What it does | How often |
|---|---|---|
| [`generate-license-keypair.mjs`](#generate-license-keypairmjs) | Creates the signing keypair the whole licence system rests on | Once, ever |
| [`issue-license.mjs`](#issue-licensemjs) | Mints a licence key for a customer | Every sale |
| [`release-device.mjs`](#release-devicemjs) | Frees a customer's device slots | Support requests |
| [`publish-release.mjs`](#publish-releasemjs) | Uploads a built release so clients auto-update | Every release |

## Setup

All four read credentials from `license-server/.env.local` (the same file
`vercel dev` uses), falling back to real environment variables. Copy
`license-server/.env.example` and fill it in before using anything here.

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

## Related

- `license-server/README.md` — the activation server, Supabase schema, R2 setup
  and the endpoints these scripts call
- `license-server/schema.sql` — licence and activation tables
