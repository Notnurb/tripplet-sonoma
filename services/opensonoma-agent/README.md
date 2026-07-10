# OpenSonoma

Give Tripplet **Sonoma** full, owner-authorized access to a machine (macOS or
Linux). A local daemon dials **out** to the Tripplet relay over a secure
WebSocket — so it works behind NAT with no inbound ports — registers the device,
then waits for operations. Every `exec`/`unlock` carries a per-use password that
the daemon verifies against a **locally** stored scrypt hash before anything
runs. Output streams back live; every operation is appended to a local audit log.

```
  ┌──────────────┐      wss       ┌───────────┐      wss      ┌──────────────┐
  │  Your machine │ ───────────▶  │   Relay   │  ◀─────────── │  Tripplet     │
  │  opensonoma   │   register    │ (forwards │   pair/exec   │  /connect +   │
  │  daemon       │ ◀───────────  │   only)   │ ───────────▶  │  Sonoma Code  │
  └──────────────┘   exec/result  └───────────┘   stream      └──────────────┘
```

This directory is the OpenSonoma source, vendored into the Tripplet app so the
installer (`/installconnect`) and the relay can be built and served from one
repo. See [`../docs/opensonoma/OPENSONOMA.md`](../docs/opensonoma/OPENSONOMA.md) for how it plugs into the app.

## Install

```bash
curl -fsSL https://tripplet.lol/installconnect | bash
```

Then run the wizard:

```bash
opensonoma
```

The wizard sets a machine name, a per-use password, generates a pairing code +
verification emoji, and installs an always-on background service. Link the
machine in Tripplet at **/connect**: enter the code, then pick the emoji shown
on this screen.

## CLI

| Command | What it does |
|---------|--------------|
| `opensonoma` | Setup wizard (first run) or live status screen |
| `opensonoma setup` | Force the setup wizard |
| `opensonoma start` / `stop` / `restart` | Control the background daemon |
| `opensonoma status` | One-screen status summary |
| `opensonoma pair` | Show the pairing code + verification emoji |
| `opensonoma logs [-f] [-n N] [--daemon]` | Tail the operations (or daemon) log |
| `opensonoma service install` / `uninstall` | Manage the OS service |
| `opensonoma daemon` | Run the daemon in the foreground (service target) |

## Operations

The execution engine (`opensonoma/exec_engine.py`) understands these op kinds,
each its own process group so it can be cancelled and timed out:

- **bash** — `/bin/bash -lc <command>` (with `cwd`, `env`, `timeout`, `background`)
- **python** — runs `code` with the daemon's interpreter
- **cpp** — writes a temp project, builds with cmake / make / clang++ / g++, optionally runs it
- **web** — an `urllib` HTTP request (no API keys)
- **search** — DuckDuckGo HTML results
- **list_processes** — the engine's currently-running ops

## Layout

```
opensonoma/        the Python package (daemon, TUI wizard, exec engine, service)
relay/             the WebSocket relay (Node, forwards only — runs nothing)
supabase/          Postgres schema + RLS for the relay's persistence
sonoma-skill/      reference tool definition for the Sonoma model
pyproject.toml     packaging (console script: opensonoma)
install.sh         install from a local source tree
```

## Security model

- The per-use **password** is verified against a local scrypt hash
  (`~/.opensonoma/secret.json`, chmod 600). The plaintext is never written to
  disk and never persisted in the cloud.
- The relay **forwards only** — it executes nothing and never stores a plaintext
  password.
- Every operation is appended to `~/.opensonoma/operations.log` (and a cloud
  copy in `operation_logs` when Supabase is configured).
- Outbound WSS only — no inbound ports, NAT-friendly.
