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

## Encryption

Two layers, so the relay is never a place secrets sit in the clear:

1. **Transport (always on): `wss://` TLS.** Both ends resolve the relay URL
   through a single policy — `src/lib/connect/relay-url.ts` (web) and
   `constants.relay_transport_ok()` (daemon). A plaintext `ws://` relay is
   **refused** for any non-loopback host, so the session token and pairing
   traffic are always TLS-encrypted in production. The web client fails closed
   rather than downgrade. The relay serves TLS natively when `TLS_CERT` +
   `TLS_KEY` are set (file paths or inline PEM), or you can terminate TLS at a
   proxy.
2. **End-to-end (per-use password): sealed box.** The relay terminates TLS, so
   to keep the exec/unlock password from it too, the device advertises an X25519
   public key (`e2e_pubkey`) at register. A client seals the password to that
   key (`src/lib/connect/e2e.ts` ⇄ `opensonoma/e2e.py`: X25519 → HKDF-SHA256 →
   AES-256-GCM). The relay forwards the opaque `enc` blob it cannot read; only
   the daemon's private key opens it. This is best-effort — it needs the
   optional `cryptography` dep (the `opensonoma[e2e]` extra); without it the
   daemon falls back to the password-over-TLS path. The two implementations are
   byte-compatible, checked by a known-answer vector (`python -m opensonoma.e2e`
   and `tests/unit/connect-e2e.test.ts`).

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

**Dependencies install automatically.** The installer detects the platform
package manager (Homebrew / apt / dnf / pacman) and installs any missing system
build tools — a C/C++ compiler, CMake, Make, and Git — non-interactively before
setting up the agent, and requests the `opensonoma[e2e]` extra (the
`cryptography` encryption dep). Every step is best-effort: a package it can't
install is warned about, never fatal. Opt out with `OPENSONOMA_SKIP_SYSTEM_DEPS=1`.
The first-run wizard (`opensonoma`) also auto-installs anything still missing on
its prerequisites screen, so both paths converge on a ready machine.

**Install from the web.** `/connect` step 1 has an **Install OpenSonoma &
dependencies** button that copies the one-liner and shows platform-aware paste
instructions (macOS / Linux / Windows Git Bash+WSL). Running it installs the
agent and all of the above dependencies in one shot.

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
