# OpenSonoma — integrated into Tripplet

OpenSonoma (the device-pairing "Connect" agent) is vendored into this repo under
[`services/opensonoma-agent/`](./services/opensonoma-agent). It lets Sonoma Code get
owner-authorized terminal access to a paired machine. Three moving parts:

| Part | Where | What it is |
|------|-------|-----------|
| **Daemon** | `services/opensonoma-agent/opensonoma/` | Python CLI + TUI + exec engine that runs on the user's machine. Console command: `opensonoma`. |
| **Relay** | `services/opensonoma-agent/relay/` | Node WebSocket forwarder between the web (role `client`) and the daemon (role `device`). Executes nothing. |
| **Web** | `src/app/(app)/connect`, `src/app/api/connect`, `src/lib/connect` | The pairing UI + API. Connects to the relay as a client to bind a device to the signed-in account. |

## The pairing flow

1. User installs + runs `opensonoma` on their computer → it shows a `XXX-XXX`
   pairing code **and** a verification emoji (derived from the code).
2. In the app at **/connect**: enter the code → pick the matching emoji from 5 →
   the server binds the device through the relay → **connected**.
3. Sonoma Code can now drive the machine via the relay's password-gated `exec`
   protocol.

The emoji is derived identically on both sides (`opensonoma/pairing.py` ⇄
`src/lib/connect/pairing.ts`) so they always agree.

## Run it locally

```bash
# 1) Install the relay's deps and start it (defaults to ws://localhost:8080/ws)
cd services/opensonoma-agent/relay && npm install && npm start
# (no Supabase env => in-memory dev mode: account_id trusted, no persistence)

# 2) Install + run the daemon on this machine
cd ../.. && curl -fsSL http://localhost:3000/installconnect | bash   # or: pip install ./opensonoma-agent
opensonoma            # setup wizard → code + emoji

# 3) Point the app's relay client at the local relay, then pair at /connect
#    (env, read by src/lib/connect/relay.ts)
export OPENSONOMA_RELAY_URL=ws://localhost:8080/ws
npm run dev
```

npm scripts (root `package.json`):

- `npm run opensonoma:relay` — start the relay from the repo
- `npm run bundle:opensonoma` — rebuild `public/opensonoma.tar.gz` (also runs on `prebuild`)

## The installer

`curl -fsSL https://tripplet.lol/installconnect | bash` →
[`public/installconnect.sh`](./public/installconnect.sh), served at
`/installconnect`. It downloads `public/opensonoma.tar.gz` (built from
`services/opensonoma-agent/` by `scripts/bundle-opensonoma.mjs`), pip-installs it into an
isolated venv, and puts the `opensonoma` command on PATH (zsh/bash/profile +
Windows User PATH).

## Auth bridge (production)

The relay verifies the **Tripplet app's own session JWT** — no Supabase user
needed. Set `TRIPPLET_JWT_SECRET` on the relay to the **same value** as the Next
app's `JWT_SECRET`:

```bash
# relay/.env  (or the relay's process env)
TRIPPLET_JWT_SECRET=<same as the Next app's JWT_SECRET>
```

Then `/api/connect/verify` forwards the user's `auth_token` cookie to the relay,
which verifies it (HS256), extracts `userId`, and uses it as the account id. A
client can only pair and drive devices bound to its own `userId`. With the secret
unset the relay falls back to Supabase JWT verification (if configured) or, as a
last resort, dev-trust memory mode (logged loudly at boot).
