# OpenSonoma — Supabase schema

This directory holds the Postgres schema that backs the Tripplet relay
(`relay/server.js`). The relay persists device, session, and operation state to
Supabase using the **service-role key** and forwards live traffic between a
Sonoma session and a paired machine. Nothing here ever executes operations or
stores plaintext passwords.

## What's in `schema.sql`

Three tables in the `public` schema:

| Table              | Purpose                                                                 |
|--------------------|-------------------------------------------------------------------------|
| `machines`         | One row per linked device (daemon install): id, owner, name, pairing code, reference password hash, online status, last-seen. |
| `machine_sessions` | One row per successful per-use unlock window (the daemon verified the password and returned `unlock_result.ok`). |
| `operation_logs`   | Append-only cloud audit copy of every executed operation (inserted on `op_started`, completed on `result`). |

The script also creates foreign keys, helpful indexes (on `account_id`,
`device_id`, `last_seen_at`, `status`, `expires_at`, `started_at`, and a unique
partial index on `pairing_code`), Row Level Security policies, grants, and column
documentation. It is **idempotent** — safe to run more than once.

## How to apply

You only need to do this once per Supabase project (re-running is harmless).

### Option A — Supabase SQL Editor (quickest)

1. Open your project at <https://supabase.com/dashboard>.
2. Go to **SQL Editor → New query**.
3. Paste the entire contents of [`schema.sql`](./schema.sql) and click **Run**.

### Option B — Supabase CLI (`supabase db push`)

`supabase db push` applies the migrations in `supabase/migrations/`. To use it,
copy this schema into a timestamped migration first:

```bash
# from the repo root, with the Supabase CLI installed and the project linked
supabase login
supabase link --project-ref <your-project-ref>

mkdir -p supabase/migrations
cp supabase/schema.sql "supabase/migrations/$(date -u +%Y%m%d%H%M%S)_opensonoma_init.sql"

supabase db push
```

(If you prefer not to create a migration, you can also pipe it straight to the
remote database with psql — see Option C.)

### Option C — psql / connection string

```bash
# Project → Settings → Database → Connection string (URI), then:
psql "$SUPABASE_DB_URL" -f supabase/schema.sql
```

## Wiring the relay to this database

After the schema is applied, point the relay at the same project. The relay reads
(see `relay/.env.example`):

```
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # Project → Settings → API
```

The service-role key is required so the relay can write all tables. Keep it
server-side only — never ship it to the daemon, the browser, or the Sonoma
client.

## Security model

- **RLS is on for all three tables.** A signed-in end user (the `authenticated`
  role, e.g. a web dashboard authenticating to PostgREST with a user JWT) can
  only `SELECT` rows where `account_id = auth.uid()`, i.e. machines and history
  they own. Owners may additionally `DELETE` their own `machines` rows (to unlink
  a device); cascading FKs clean up that machine's sessions and logs.
- **The relay bypasses RLS.** It uses the service-role key, which maps to the
  `service_role` Postgres role (which has `BYPASSRLS`), so every insert/update/
  upsert the relay performs succeeds regardless of policy.
- **`operation_logs` is read-only for owners** — there is no owner update/delete
  policy, preserving the append-only audit trail. (The device keeps its own
  authoritative append-only JSONL audit at `~/.opensonoma/operations.log`.)
- **`account_id` is `auth.uid()`** — a `uuid` referencing `auth.users(id)` with
  `on delete cascade`, so deleting a user removes their cloud rows.

## About `machines.password_hash`

This column is a **reference copy** of the scrypt password hash, useful for
operational visibility. It is **not** the source of truth:

- The **device** holds the authoritative hash in `~/.opensonoma/secret.json`
  (chmod 600) and is what actually verifies each per-use password.
- The relay **never** receives or persists a plaintext password. The `password`
  field carried in `unlock`/`exec` frames is forwarded straight to the device,
  verified locally against the on-device hash, and discarded.

So even if this row were exposed, an attacker would still face the device's
scrypt hash, never a plaintext credential.
