-- Ausculta license/activation schema.
--
-- Run this ONCE in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- It is idempotent, so re-running it after a schema change is safe.
--
-- Security model: RLS is enabled on every table and NO policies are created.
-- That means the public `anon` key can read nothing, even though it ships in
-- any Supabase client. Only the `service_role` key -- which lives exclusively
-- in Vercel's environment variables and never touches the desktop app -- can
-- reach these rows.

create extension if not exists pgcrypto;

-- ─── Licenses ────────────────────────────────────────────────────────────
-- One row per key sold. The key itself is NEVER stored: we keep only its
-- SHA-256, so a database leak does not hand out working licenses.

create table if not exists licenses (
  id               uuid primary key default gen_random_uuid(),

  -- sha256(normalized key), hex. Normalization = uppercase, dashes stripped.
  key_hash         text not null unique,
  -- First group of the key ("AUSC-7K3M"), stored in clear so you can find a
  -- customer's row from the fragment they read out over the phone.
  key_prefix       text not null,

  customer_name    text,
  customer_email   text,
  notes            text,

  -- 'perpetual' today. 'subscription' once the ERP lands -- the client already
  -- understands both, so flipping this on an existing row is all it takes.
  plan             text not null default 'perpetual'
                   check (plan in ('perpetual', 'subscription')),

  status           text not null default 'active'
                   check (status in ('active', 'revoked')),

  -- How many distinct devices this key may be bound to at once.
  max_activations  int not null default 3 check (max_activations > 0),

  -- NULL = never expires. Set a timestamp to turn the key into a subscription.
  expires_at       timestamptz,

  -- Future ERP module flags, embedded verbatim into the activation token.
  features         jsonb not null default '[]'::jsonb,

  created_at       timestamptz not null default now()
);

create index if not exists licenses_key_prefix_idx on licenses (key_prefix);
create index if not exists licenses_customer_email_idx on licenses (customer_email);

-- ─── Activations ─────────────────────────────────────────────────────────
-- One row per (license, device). `released_at` is a soft delete: releasing a
-- device frees a slot but keeps the audit trail of who ran what, where.

create table if not exists activations (
  id                 uuid primary key default gen_random_uuid(),
  license_id         uuid not null references licenses(id) on delete cascade,

  -- sha256 of the device fingerprint, hex. Opaque to the server.
  fingerprint        text not null,

  app_version        text,
  os                 text,

  first_activated_at timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  released_at        timestamptz,

  -- A device that reactivates must reuse its existing row rather than burn a
  -- second slot, so reinstalling the app costs the customer nothing.
  unique (license_id, fingerprint)
);

create index if not exists activations_license_active_idx
  on activations (license_id) where released_at is null;

-- ─── Attempt log ─────────────────────────────────────────────────────────
-- Feeds the per-IP throttle in api/_lib/throttle.ts and doubles as the
-- support trail for "it says my key is invalid".

create table if not exists activation_attempts (
  id         bigserial primary key,
  ip         text,
  key_prefix text,
  outcome    text not null,
  created_at timestamptz not null default now()
);

create index if not exists activation_attempts_ip_time_idx
  on activation_attempts (ip, created_at desc);

-- ─── Lock everything down ────────────────────────────────────────────────

alter table licenses            enable row level security;
alter table activations         enable row level security;
alter table activation_attempts enable row level security;

-- ─── Grants ──────────────────────────────────────────────────────────────
-- RLS decides which ROWS a role may touch; grants decide whether it may touch
-- the table at all. They are separate gates, and a table created here is owned
-- by `postgres`, so the API roles start with no privileges — without this
-- block every request fails with "permission denied for table licenses"
-- (SQLSTATE 42501) no matter how the keys are configured.
--
-- Only `service_role` (which the secret key maps to, and which carries
-- BYPASSRLS) is granted anything. `anon` and `authenticated` are deliberately
-- left with nothing: no browser-side key can read a licence, ever.

grant usage on schema public to service_role;

grant select, insert, update, delete
  on licenses, activations, activation_attempts
  to service_role;

-- activation_attempts.id is a bigserial, so its sequence needs granting too.
grant usage, select on sequence activation_attempts_id_seq to service_role;

-- ─── Support view ────────────────────────────────────────────────────────
-- What you actually want to look at in the dashboard: who owns each key and
-- how many device slots they have left.

create or replace view license_overview as
select
  l.id,
  l.key_prefix,
  l.customer_name,
  l.customer_email,
  l.plan,
  l.status,
  l.expires_at,
  l.max_activations,
  count(a.id) filter (where a.released_at is null) as devices_in_use,
  l.max_activations - count(a.id) filter (where a.released_at is null) as slots_free,
  l.created_at
from licenses l
left join activations a on a.license_id = l.id
group by l.id
order by l.created_at desc;

grant select on license_overview to service_role;
