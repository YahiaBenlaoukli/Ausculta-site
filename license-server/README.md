# Ausculta activation server

Makes a license key usable on a limited number of machines instead of infinitely
many. Ausculta itself stays offline-first: the app talks to this server **once**,
at activation, and never again for a perpetual license.

```
Desktop app                    This server                Supabase
     |                              |                         |
     |-- key + device fingerprint ->|                         |
     |                              |-- key already used? --->|
     |                              |<-- 1 of 3 devices ------|
     |<-- Ed25519-signed token -----|                         |
     |                                                        |
   stores the token, verifies it offline on every launch
   from here on -- no network, ever
```

The private signing key lives only here. That is what stops someone pointing
`api.ausculta.site` at their own machine: they can serve any response they like,
but they cannot produce a signature the app accepts.

## What is enforced

| Situation | Result |
|---|---|
| Key used on a 2nd and 3rd machine | Allowed (default `max_activations = 3`) |
| Key used on a 4th machine | `limit_reached` |
| Reinstalling Ausculta on the same PC | Free — same fingerprint, no slot consumed |
| Reinstalling **Windows** | New fingerprint, consumes a slot |
| Copying `trial.enc` to another PC | `device_mismatch` — token is fingerprint-bound |
| Key revoked after a refund | Perpetual: no effect. Subscription: dead within 30 days |

Device fingerprint = SHA-256 of the OS machine id (`MachineGuid` on Windows).
It is deliberately **not** a value the app generates and stores, because such a
value would travel with a copied state file and defeat the binding.

## Deployment

### 1. Signing keypair

```bash
node scripts/generate-license-keypair.mjs     # from the repo root
```

Writes `scripts/keys/` (gitignored). Paste the **public** key into
`LICENSE_PUBLIC_KEY_PEM` in `electron/services/trial.ts`; the **private** key
becomes `LICENSE_PRIVATE_KEY` below.

> Replacing this keypair later invalidates every activation in the field, so
> back up `license_private.pem` somewhere safe and offline.

### 2. Supabase

Create a project, then run [`schema.sql`](./schema.sql) in the SQL editor.

RLS is enabled with **no policies**, so the public `anon` key can read nothing.
Only the `service_role` key — which lives in Vercel and never ships in the app —
can reach these tables.

### 3. Vercel

Import the repo and set **Root Directory** to `license-server`. Then add these
environment variables (Settings → Environment Variables):

| Name | Where it comes from |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → Data API |
| `SUPABASE_SECRET_KEY` | Supabase → API Keys → Secret keys → `sb_secret_…` |
| `LICENSE_PRIVATE_KEY` | `scripts/keys/license_private.pem`, whole PEM |
| `ADMIN_TOKEN` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

> **On Supabase API keys.** The old `service_role` JWT still works, and
> `SUPABASE_SERVICE_ROLE_KEY` is read as a fallback, but Supabase deprecates
> legacy keys at the **end of 2026** — use the new `sb_secret_…` key. One real
> difference: secret keys are not JWTs and are **rejected on the
> `Authorization: Bearer` header**; they must go on `apikey`. `supabase-js`
> handles this itself, and `scripts/issue-license.mjs` sends `apikey` only, so
> both key generations work here.
>
> `GET /api/health` reports `keyType: "secret" | "legacy_service_role"` so you
> can see which one a deployment is on.

### 4. Domain

Add `api.ausculta.site` to the Vercel project and point the DNS record at
Vercel. The app has this hostname compiled in, so **changing it later breaks
activation for every installed copy** — get it right before shipping.

Verify:

```bash
curl https://api.ausculta.site/api/health
# {"ok":true,"configured":{...all true...}}
```

## Day-to-day

Issue a key:

```bash
node scripts/issue-license.mjs "Dr. Yahia Benlaoukli" --email dr@mail.com
```

The key is printed once and never stored — only its SHA-256 goes to the
database. If a customer loses it, revoke the row and issue a new one.

Free a customer's device slots (they changed PC and used all three):

```bash
node scripts/release-device.mjs AUSC-7K3M-9QP2-XR4T-8WNZ
```

They then re-enter the **same** key on the new machine.

Revoke a license: set `status = 'revoked'` in the Supabase dashboard. Note this
only stops *future* activations for perpetual keys — a machine already holding a
valid token never checks in again. Revocation only truly bites for
subscriptions, which is by design.

The `license_overview` view shows every key with its customer and how many
device slots remain.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/activate` | none | Key + fingerprint → signed token |
| `POST` | `/api/refresh` | none | Renew a subscription token (needs a valid token) |
| `POST` | `/api/release` | `x-admin-token` | Free device slots |
| `GET` | `/api/health` | none | Deployment/config check |

Failures return `{ ok: false, code, message }`. `code` is a stable slug
(`invalid_key`, `limit_reached`, `revoked`, …) which the app maps onto its own
fr/en/ar translations — the server never sends user-facing prose.

## The subscription path

Everything needed for the future ERP subscription tier already ships in v1:
`plan`, `expires_at` and `features` on the license, `exp` in the token, and the
`/api/refresh` endpoint the client calls on its own.

Today every key is issued `plan = 'perpetual'` with `exp: null` — activate once,
offline forever, exactly as intended. To turn a customer into a subscriber you
change two columns in Postgres; no app update, no reinstall.

This matters because **it cannot be retrofitted**. A copy of the app already on
a doctor's PC only understands the protocol it shipped with. If v1 had no notion
of expiry, every license sold now would be permanently un-expirable.

## Local development

```bash
cd license-server
npm install
cp .env.example .env.local     # fill in the four values
npx vercel dev
```

Point the desktop app at it with `AUSCULTA_API_URL=http://localhost:3000`
before `npm run dev`.
