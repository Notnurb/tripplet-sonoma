-- =============================================================================
-- OpenSonoma — Supabase / Postgres schema
-- =============================================================================
-- This schema backs the Tripplet relay (relay/server.js). The relay connects to
-- Supabase using the SERVICE ROLE key and performs all writes; it bypasses Row
-- Level Security (RLS) by virtue of the `service_role` Postgres role having the
-- BYPASSRLS attribute. Signed-in end users (the `authenticated` role, e.g. a web
-- dashboard talking to PostgREST with a user JWT) may only READ rows they own,
-- enforced by RLS policies of the form `account_id = auth.uid()`.
--
-- Three tables:
--   * machines          — one row per linked device (the daemon install).
--   * machine_sessions   — one row per successful per-use unlock window.
--   * operation_logs     — append-only cloud copy of every executed operation.
--
-- The schema is idempotent: it can be applied repeatedly (CREATE ... IF NOT
-- EXISTS, DROP POLICY IF EXISTS before CREATE POLICY). Apply it via the Supabase
-- SQL editor, `supabase db push`, or psql. See README.md for instructions.
--
-- SECURITY NOTE on `machines.password_hash`: this is only a *reference copy* of
-- the scrypt hash. The device (~/.opensonoma/secret.json, chmod 600) is the
-- authoritative store and is what actually verifies the per-use password. The
-- relay NEVER receives or persists a plaintext password — the `password` carried
-- in `unlock`/`exec` frames is forwarded straight to the device and discarded.
-- =============================================================================

-- gen_random_uuid() is built into Postgres 13+ (Supabase runs newer); pgcrypto
-- also provides it. Creating the extension makes the schema portable.
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- machines
-- -----------------------------------------------------------------------------
create table if not exists public.machines (
    device_id     text        primary key,
    account_id    uuid        references auth.users (id) on delete cascade,
    machine_name  text        not null default '',
    pairing_code  text,
    password_hash text        not null default '',
    status        text        not null default 'offline'
                              check (status in ('online', 'offline', 'unpaired')),
    last_seen_at  timestamptz not null default now(),
    created_at    timestamptz not null default now()
);

-- pairing_code must be unique among machines that still advertise one. NULL codes
-- (a paired/retired machine may clear its code) are allowed to repeat.
create unique index if not exists machines_pairing_code_key
    on public.machines (pairing_code)
    where pairing_code is not null;

create index if not exists machines_account_id_idx
    on public.machines (account_id);

create index if not exists machines_last_seen_at_idx
    on public.machines (last_seen_at);

create index if not exists machines_status_idx
    on public.machines (status);

-- -----------------------------------------------------------------------------
-- machine_sessions
-- -----------------------------------------------------------------------------
-- One row per successful unlock (the daemon verified the per-use password and
-- returned unlock_result.ok = true). `session_id` is the opaque Sonoma session
-- identifier supplied by the client; it is stored as text since it is not
-- necessarily a canonical UUID.
create table if not exists public.machine_sessions (
    session_id  text        primary key,
    device_id   text        not null
                            references public.machines (device_id) on delete cascade,
    account_id  uuid        not null
                            references auth.users (id) on delete cascade,
    unlocked_at timestamptz not null default now(),
    expires_at  timestamptz not null
);

create index if not exists machine_sessions_device_id_idx
    on public.machine_sessions (device_id);

create index if not exists machine_sessions_account_id_idx
    on public.machine_sessions (account_id);

create index if not exists machine_sessions_expires_at_idx
    on public.machine_sessions (expires_at);

-- -----------------------------------------------------------------------------
-- operation_logs
-- -----------------------------------------------------------------------------
-- Append-only cloud audit copy. The relay inserts a row on `op_started` and
-- updates exit_code/finished_at on `result`. The device additionally keeps its
-- own authoritative append-only JSONL audit at ~/.opensonoma/operations.log.
create table if not exists public.operation_logs (
    log_id      uuid        primary key default gen_random_uuid(),
    device_id   text        not null
                            references public.machines (device_id) on delete cascade,
    account_id  uuid        not null
                            references auth.users (id) on delete cascade,
    kind        text        not null,
    command     text        not null default '',
    exit_code   integer,
    started_at  timestamptz not null default now(),
    finished_at timestamptz
);

create index if not exists operation_logs_device_id_idx
    on public.operation_logs (device_id);

create index if not exists operation_logs_account_id_idx
    on public.operation_logs (account_id);

-- Recent-first listings in a dashboard.
create index if not exists operation_logs_started_at_idx
    on public.operation_logs (started_at desc);

-- =============================================================================
-- Row Level Security
-- =============================================================================
-- Enable RLS on every table. With RLS enabled and no permissive policy for a
-- given command, that command is denied for `anon`/`authenticated`. We grant
-- owners SELECT on all three tables (and DELETE on machines so a user can unlink
-- a device from a dashboard). All inserts/updates/upserts come from the relay
-- via the service-role key, which bypasses RLS entirely.
alter table public.machines         enable row level security;
alter table public.machine_sessions enable row level security;
alter table public.operation_logs   enable row level security;

-- machines -------------------------------------------------------------------
drop policy if exists "Owners can view their machines" on public.machines;
create policy "Owners can view their machines"
    on public.machines
    for select
    to authenticated
    using (account_id = auth.uid());

drop policy if exists "Owners can delete their machines" on public.machines;
create policy "Owners can delete their machines"
    on public.machines
    for delete
    to authenticated
    using (account_id = auth.uid());

-- machine_sessions -----------------------------------------------------------
drop policy if exists "Owners can view their sessions" on public.machine_sessions;
create policy "Owners can view their sessions"
    on public.machine_sessions
    for select
    to authenticated
    using (account_id = auth.uid());

-- operation_logs (read-only for owners; append-only audit) -------------------
drop policy if exists "Owners can view their operation logs" on public.operation_logs;
create policy "Owners can view their operation logs"
    on public.operation_logs
    for select
    to authenticated
    using (account_id = auth.uid());

-- =============================================================================
-- Grants
-- =============================================================================
-- Supabase normally applies sensible default privileges to anon/authenticated/
-- service_role, but we state them explicitly so the schema is self-contained and
-- portable. RLS (above) is the row-level enforcement layer; these GRANTs are the
-- table-level privilege layer. Both are required for a request to succeed.
grant select on public.machines         to authenticated;
grant delete on public.machines         to authenticated;
grant select on public.machine_sessions to authenticated;
grant select on public.operation_logs   to authenticated;

-- The relay (service role) needs full write access; it bypasses RLS.
grant all on public.machines         to service_role;
grant all on public.machine_sessions to service_role;
grant all on public.operation_logs   to service_role;

-- =============================================================================
-- Column documentation
-- =============================================================================
comment on table  public.machines is
    'Linked OpenSonoma devices. Written by the relay (service role) on register/heartbeat/pair.';
comment on column public.machines.device_id is
    'Stable device install id (uuid4 string from crypto.new_device_id), primary key.';
comment on column public.machines.account_id is
    'Owning Supabase auth user (auth.uid()); NULL while unpaired.';
comment on column public.machines.pairing_code is
    'Human pairing code like A7K-3FQ (pairing.generate_pairing_code); unique while non-NULL.';
comment on column public.machines.password_hash is
    'REFERENCE COPY of the scrypt hash. The device (~/.opensonoma/secret.json) is authoritative; plaintext passwords are never stored here.';
comment on column public.machines.status is
    'online | offline | unpaired. Maintained by the relay from connection state and heartbeats.';

comment on table  public.machine_sessions is
    'One row per successful per-use unlock window (unlock_result.ok). Inserted by the relay.';
comment on column public.machine_sessions.session_id is
    'Opaque Sonoma session id supplied by the client (text; not necessarily a canonical UUID).';
comment on column public.machine_sessions.expires_at is
    'When the unlock window lapses (unlocked_at + UNLOCK_TTL_SECONDS).';

comment on table  public.operation_logs is
    'Append-only cloud audit copy of executed operations. Inserted on op_started, updated on result.';
comment on column public.operation_logs.exit_code is
    'Process exit code; NULL for still-running/background ops or auth failures.';
comment on column public.operation_logs.finished_at is
    'Set when the result frame arrives; NULL while the op is in flight.';
