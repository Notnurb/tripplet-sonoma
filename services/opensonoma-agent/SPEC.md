# OpenSonoma — Build Spec (canonical contract)

OpenSonoma gives Tripplet Sonoma full, owner-authorized access to a machine
(macOS or Linux). A local daemon connects **out** to the Tripplet relay over a
secure WebSocket (works behind NAT, no inbound ports). Sonoma sends operations;
the daemon verifies the per-use password against a **locally** stored hash, then
executes with full machine access and streams output back live.

The contract-bearing Python modules are **already written** — read them, do not
recreate them:

- `opensonoma/constants.py` — paths, names, tuning. Key: `CONFIG_DIR`,
  `CONFIG_FILE`, `SECRET_FILE`, `OPERATIONS_LOG`, `DAEMON_LOG`, `STATUS_FILE`,
  `PID_FILE`, `WORK_DIR`, `DEFAULT_RELAY_URL`, `HEARTBEAT_INTERVAL`,
  `RECONNECT_BASE_DELAY`, `RECONNECT_MAX_DELAY`, `UNLOCK_TTL_SECONDS`,
  `STATUS_WRITE_INTERVAL`, `RECENT_OPS_KEPT`, `VERSION`, `BUNDLE_ID`,
  `SERVICE_LABEL`, `SYSTEMD_UNIT_NAME`, `APP_NAME`, `ensure_config_dir()`.
- `opensonoma/crypto.py` — `hash_password`, `verify_password`, `new_device_id`,
  `new_device_token`.
- `opensonoma/pairing.py` — `generate_pairing_code`, `normalize_pairing_code`,
  `is_valid_pairing_code`, `PAIRING_ALPHABET`.
- `opensonoma/config.py` — `Config` (dataclass: device_id, machine_name,
  pairing_code, relay_url, paired, account_id, version, created_at, updated_at;
  classmethods `load()`, `exists()`; method `save()`), `Secret` (password_hash,
  device_token; `load()`, `save()`, `set_password(pt)`, `verify(pt)`,
  `ensure_device_token()`), `is_first_run()`.
- `opensonoma/protocol.py` — all message `type` constants (`T_*`), role/stream/
  kind constants, builders (`register_msg`, `heartbeat_msg`, `op_started_msg`,
  `stream_msg`, `result_msg`, `unlock_result_msg`, `error_msg`), `new_id()`,
  `now_iso()`, `now_ms()`. **The module docstring is the authoritative wire
  protocol — read it.**

**Hard constraints**
- Target **Python 3.9** syntax (no `match`, no `X | Y` runtime unions, no
  `tomllib`). Use `from __future__ import annotations` where helpful.
- Third-party deps allowed in the daemon: **`textual`**, **`websockets`** only.
  Everything else must be stdlib (subprocess, asyncio, urllib, hashlib, json…).
- Do **not** add safety gates / approval prompts / sandboxes / op-count limits
  beyond what is specified (the password gate and audit log ARE specified — keep
  them). Full machine access is the intended behavior.
- Disjoint files only — each builder writes the files assigned to it and no
  others. Import the already-written core modules; never redefine them.

---

## Project layout (final)

```
OS/
  opensonoma/
    __init__.py            (done)
    constants.py           (done)
    crypto.py              (done)
    pairing.py             (done)
    config.py              (done)
    protocol.py            (done)
    exec_engine.py         <-- builder: EXEC
    daemon.py              <-- builder: DAEMON
    cli.py                 <-- builder: DAEMON
    __main__.py            <-- builder: DAEMON
    tui.py                 <-- builder: TUI
    service.py             <-- builder: SERVICE
  pyproject.toml           <-- builder: PACKAGING
  install.sh               <-- builder: PACKAGING
  relay/
    server.js              <-- builder: RELAY
    package.json           <-- builder: RELAY
    .env.example           <-- builder: RELAY
    README.md              <-- builder: RELAY
  supabase/
    schema.sql             <-- builder: SUPABASE
    README.md              <-- builder: SUPABASE
  sonoma-skill/
    SKILL.md               <-- builder: SKILL
    skill.json             <-- builder: SKILL
    opensonoma-tool.ts     <-- builder: SKILL
  README.md                <-- builder: README
```

---

## EXEC builder — `opensonoma/exec_engine.py`

Implement exactly this public interface (the daemon depends on it):

```python
class ExecutionEngine:
    def __init__(self) -> None: ...

    async def run(self, op_id: str, op: dict, emit) -> dict:
        """Execute `op`, streaming live output via `await emit(stream, text)`
        where stream is "stdout" or "stderr". Returns a result dict:
          {"ok": bool, "exit_code": int|None, "duration_ms": int,
           "started_at": iso, "finished_at": iso, "error": str|None,
           "command": str, "data": any|None}
        Appends a JSONL record (start and finish) to constants.OPERATIONS_LOG.
        Must NOT build protocol messages — only call emit(stream, text)."""

    async def cancel(self, op_id: str) -> bool:
        """Kill the process group for op_id if running. True if found."""

    def list_running(self) -> list:
        """[{op_id, kind, pid, started_at, command}] for live ops."""

    async def shutdown(self) -> None:
        """Terminate all tracked processes (daemon shutdown)."""
```

Use `asyncio.create_subprocess_exec` with `start_new_session=True` so each op is
its own process group and `cancel()` can `os.killpg(pgid, SIGTERM)` then SIGKILL.
Read stdout and stderr concurrently and call `emit` as chunks arrive. Track
running ops in a dict keyed by op_id (store the Process + pgid + metadata).

Operation kinds and params (`op["kind"]`):

- **bash**: `{kind, command, cwd?, env?, timeout?, background?}` — run via
  `/bin/bash -lc <command>`. If `background` true, return immediately after the
  process starts (ok=True, exit_code=None) and keep streaming until it exits or
  is cancelled (the daemon tolerates a result that arrives later). Honor
  `timeout` (seconds) by killing the group and setting error="timeout".
- **python**: `{kind, code, cwd?, timeout?, args?}` — write `code` to a temp file
  under `WORK_DIR` and run with `sys.executable <file> [args...]`.
- **cpp**: `{kind, files:{relpath:content,...}, build_system:"cmake"|"make"|
  "clang"|"g++", build_args?, sources?, output?, run?, run_args?, target?,
  timeout?}` — make a temp project dir under `WORK_DIR`, write every file
  (create parent dirs), then build:
    - cmake: `cmake -S . -B build [build_args]` then
      `cmake --build build [--target target]`; binary at `build/<target or output>`.
    - make: `make [build_args]`.
    - clang/g++: `clang++`/`g++ -O2 -std=c++17 -o <output or app> <sources...> [build_args]`.
  Stream build output. If `run` is true and the build succeeded, run the produced
  binary (`./<output>` or `build/<target>`) with `run_args` and stream that too.
  Put a marker line on stderr like `=== build ===` / `=== run ===` so output is
  legible. exit_code reflects the last stage (build failure short-circuits run).
- **web**: `{kind, method?, url, headers?, body?, timeout?}` — perform the HTTP
  request with `urllib.request` inside `asyncio.to_thread`. Emit the status line
  and headers on stdout, then the body (decode utf-8, errors="replace"). Put the
  parsed result in result `data` = {status, headers, body_len}. No external deps,
  no API keys.
- **search**: `{kind, query, max_results?}` — HTTP GET DuckDuckGo HTML
  (`https://html.duckduckgo.com/html/?q=<query>`) via the same threaded urllib
  path, extract result titles + urls with a regex, emit them on stdout, and
  return them in `data` = {results:[{title,url}]}. Best-effort; never raise.
- **list_processes**: `{kind}` — return `data` = list_running(); emit a short
  human summary on stdout; exit_code 0.

Never let an op crash the daemon: wrap execution, and on unexpected exceptions
return ok=False with error set and a non-None exit_code (e.g. -1).

OPERATIONS_LOG record shape (one JSON object per line):
`{"ts": iso, "event":"start"|"finish", "op_id", "kind", "command",
  "exit_code"?, "duration_ms"?, "error"?}`.

---

## DAEMON builder — `opensonoma/daemon.py`, `cli.py`, `__main__.py`

### `daemon.py`
Public: `async def run_daemon() -> None` and `def main() -> None`
(`main` = `asyncio.run(run_daemon())` with signal handling + pidfile).

Behavior:
- Load `Config` and `Secret`. If `is_first_run()` (no device_id / password_hash),
  print a message telling the user to run `opensonoma setup`, write nothing, and
  exit non-zero.
- Write `PID_FILE` on start; remove on exit. Install SIGTERM/SIGINT handlers for
  graceful shutdown (cancel tasks, `engine.shutdown()`, close ws, remove pidfile).
- Maintain link_state in {"connecting","online","offline"} and write
  `STATUS_FILE` every `STATUS_WRITE_INTERVAL`s with:
  `{machine_name, pairing_code, paired, account_id, link_state,
    connected_since, version, pid, recent_ops:[{op_id,kind,command,exit_code,
    started_at,finished_at}]}` (keep last `RECENT_OPS_KEPT`).
- Connect loop: connect to `config.relay_url` with `websockets.connect`
  (ssl for wss). On connect → send `protocol.register_msg(...)` using
  `secret.ensure_device_token()` (save Secret if a token was created). Set state
  "online" on `register_ack`. Backoff reconnect between
  `RECONNECT_BASE_DELAY`..`RECONNECT_MAX_DELAY`. Heartbeat every
  `HEARTBEAT_INTERVAL`s.
- Handle inbound:
  - `exec`: verify `msg["auth"]["password"]` with `secret.verify(...)`. On fail →
    send `result_msg(ok=False, exit_code=None, error="authentication failed")`
    (and an `op_started`? no — only on success). On success → send
    `op_started_msg`, run as its own asyncio task via `engine.run(op_id, op,
    emit)` where `emit(stream, text)` builds `stream_msg` with a per-op seq
    counter and sends it; finally send `result_msg`. Multiple execs run
    concurrently. Record into recent_ops.
  - `unlock`: verify password → send `unlock_result_msg(ok, expires_at=
    now+UNLOCK_TTL)`; on fail ok=False error="invalid password".
  - `cancel`: `await engine.cancel(target_id)`; the running op's result (with
    error="cancelled") is what the client receives.
  - `paired`: set `config.paired=True`, `config.account_id=...`, save.
  - `register_ack`: adopt account_id/paired if present.
- All sends go through one `send(ws, obj)` that `json.dumps` + handles closed
  socket. Never crash the loop on a single bad message; log to DAEMON_LOG.

### `cli.py`
Public: `def main(argv=None) -> int`. Subcommands (argparse):
- (no args): if `is_first_run()` → launch wizard (`tui.run_wizard()`); else open
  status screen (`tui.run_status()`).
- `setup` → `tui.run_wizard()`.
- `daemon` (the service entry; may be hidden from help) → `daemon.main()`.
- `start` → if `service.is_installed()`: `service.start()`; else spawn
  `[sys.executable, "-m", "opensonoma", "daemon"]` detached
  (`start_new_session=True`, stdout/stderr → DAEMON_LOG) and print pid.
- `stop` → if service installed `service.stop()`; else read PID_FILE, SIGTERM it.
- `restart` → stop then start.
- `status` → read STATUS_FILE + check pid/service liveness; print a clear summary
  (machine name, pairing code, link state, online/offline, recent ops count).
- `logs [-f] [-n N] [--daemon]` → print last N lines of OPERATIONS_LOG (or
  DAEMON_LOG with --daemon); `-f` follows.
- `pair` → print the pairing code in a large clear ASCII box + linking
  instructions (reads Config; error if not set up).
- `service install` → `service.install_service()`; `service uninstall` →
  `service.uninstall_service()`.

Keep CLI imports lazy where they pull in `textual` (only import `tui` inside the
handlers that need it) so `daemon`/`status`/`logs` work without a TTY.

### `__main__.py`
`from .cli import main; raise SystemExit(main())`.

---

## TUI builder — `opensonoma/tui.py`  (Textual)

Public: `def run_wizard() -> None`, `def run_status() -> None`.

Keyboard-driven, no mouse required, clean layout. Wizard screens in order:
1. **Welcome + prerequisites** — detect OS; check for python3, a C/C++ compiler
   (clang++ or g++), cmake, make, git; show ✓/✗ table. Offer to install missing
   via the platform manager (macOS: `brew install ...`; Linux: detect apt/dnf/
   pacman) — run in a Textual worker, stream result; allow Skip.
2. **Machine name** — text input (default to hostname).
3. **Password** — two masked inputs (create + confirm) with a strength hint;
   reject empty/mismatch. Store via `Secret.set_password()`.
4. **Pairing code** — call `pairing.generate_pairing_code()`, show it BIG in an
   ASCII/box layout with a "copy this into Tripplet → Sonoma → OpenSonoma" hint.
5. **Install service** — call `service.install_service()` then `service.start()`
   in a worker; show progress + confirm it started.
6. **Status screen** — same as `run_status()`.

On completion persist: `Config` (device_id via `crypto.new_device_id()` if empty,
machine_name, pairing_code, relay_url default), `Secret` (password hash +
`ensure_device_token()`), then `save()` both before installing the service.

`run_status()` shows: machine name, pairing code, link state (read live from
`STATUS_FILE`), paired/online, and a live tail of recent operations
(`OPERATIONS_LOG`), refreshing on a timer. Footer shows key bindings (q=quit,
etc.). Must not crash if STATUS_FILE/OPERATIONS_LOG are absent yet.

Use Textual ≥0.50 APIs (App, Screen, compose, Input, Button, DataTable/Static,
work/worker). Bind sensible keys. Do real work via `crypto`, `pairing`, `config`,
`service` — no placeholders.

---

## SERVICE builder — `opensonoma/service.py`

Public: `is_installed() -> bool`, `install_service() -> str`,
`uninstall_service() -> str`, `start_service()` (alias `start`),
`stop_service()` (alias `stop`), `service_status() -> dict`, `platform_name()`.

Run target = `[sys.executable, "-m", "opensonoma", "daemon"]` (reliable
regardless of PATH). Logs → `constants.DAEMON_LOG`.

- **macOS (darwin)**: LaunchAgent plist at
  `~/Library/LaunchAgents/ai.tripplet.opensonoma.plist` with `Label`,
  `ProgramArguments`, `RunAtLoad`=true, `KeepAlive`=true (restart on crash),
  `StandardOutPath`/`StandardErrorPath`=DAEMON_LOG, `WorkingDirectory`=home.
  Load with `launchctl unload` (ignore error) then `launchctl load -w <plist>`.
  start/stop via `launchctl start/stop ai.tripplet.opensonoma`. status via
  `launchctl list | grep`.
- **Linux**: systemd **user** unit at
  `~/.config/systemd/user/opensonoma.service` with `[Unit] Description`,
  `[Service] ExecStart=...`, `Restart=always`, `RestartSec=3`,
  `[Install] WantedBy=default.target`. Run `systemctl --user daemon-reload`,
  `systemctl --user enable --now opensonoma.service`. Mention
  `loginctl enable-linger $USER` (run it best-effort) so it survives logout.
  start/stop/status via `systemctl --user`.

Return human-readable strings describing what happened. Never raise on a missing
service manager — return an explanatory message. Detect platform via `sys.platform`.

---

## PACKAGING builder — `pyproject.toml`, `install.sh`

- `pyproject.toml`: PEP 621 project named `opensonoma`, version from spec
  (1.0.0), `requires-python = ">=3.9"`, deps `textual>=0.50`, `websockets>=12`.
  `[project.scripts] opensonoma = "opensonoma.cli:main"`. Build backend:
  setuptools. Include the `opensonoma` package. Add a short description + readme
  pointer.
- `install.sh`: POSIX-ish bash, `set -euo pipefail`. One command that: checks
  python3 ≥3.9, creates a venv at `~/.opensonoma/venv` (or uses pipx if present),
  installs the package from the current directory (`pip install .`), symlinks/
  hints the `opensonoma` entry point onto PATH (e.g. into `~/.local/bin`), and
  prints "Run: opensonoma" to open the wizard. Must work on macOS and Linux.
  Print clear next-step instructions at the end.

---

## RELAY builder — `relay/server.js`, `package.json`, `.env.example`, `README.md`

Node WebSocket relay (uses `ws` and `@supabase/supabase-js`). **Forwards only;
executes nothing.** Implements the protocol in `opensonoma/protocol.py`
(read its docstring). Plain Node service (no framework needed); also document how
it slots beside Next.js.

- Single WS endpoint (path `/ws`). On connection, first message must be
  `register` with `role`.
  - role `device`: validate device_token (on first registration, store it; on
    later ones, require match), upsert the `machines` row (device_id,
    machine_name, pairing_code, password_hash, status='online', last_seen_at).
    Keep an in-memory map `deviceSockets[device_id] = ws`. On `paired` binding,
    send the device a `paired` message. Forward device→client messages (`stream`,
    `result`, `unlock_result`, `op_started`) to the socket of the session/account
    that targeted it; add `device_id`. Persist `operation_logs` (insert on
    `op_started`, update exit_code/finished_at on `result`) and `machine_sessions`
    (on `unlock_result.ok`). On disconnect set status='offline', notify clients.
  - role `client`: validate `auth_jwt` against Supabase (account_id). Keep
    `clientSockets[session_id] = ws`. Handle `pair` (look up machine by
    pairing_code, set account_id, reply `pair_result`, notify device `paired`),
    `list_machines` (reply `machines_list`), and forward `exec`/`unlock`/`cancel`
    to `deviceSockets[device_id]` (tagging session_id so replies route back).
- Heartbeats: update `last_seen_at`; mark stale devices offline.
- Config from env (`.env.example`): `PORT`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `RELAY_PUBLIC_URL`.
- Use only the service-role key server-side; the relay must never persist a
  plaintext password (the `password` field in `unlock`/`exec` is forwarded to the
  device and never written to the DB).
- `package.json` with deps + `start` script (Node ≥18, ESM or CJS — pick one and
  be consistent). `README.md`: how to run locally and deploy alongside Tripplet.

---

## SUPABASE builder — `supabase/schema.sql`, `README.md`

Postgres schema for Supabase. Tables (exact columns):
- `machines`: `device_id` (text/uuid pk), `account_id`, `machine_name`,
  `pairing_code` (text, e.g. 'A7K-3FQ'), `password_hash`, `status`
  ('online'/'offline'/'unpaired'), `last_seen_at` timestamptz, `created_at`
  timestamptz default now(). Unique index on `pairing_code` (where not null).
- `machine_sessions`: `session_id` (pk), `device_id` fk, `account_id`,
  `unlocked_at`, `expires_at`.
- `operation_logs`: `log_id` (pk, uuid default), `device_id` fk, `account_id`,
  `kind`, `command`, `exit_code`, `started_at`, `finished_at`.
Add FKs, helpful indexes (account_id, device_id, last_seen_at), and **RLS
policies** so a signed-in user only sees their own `account_id = auth.uid()` rows;
the relay uses the service-role key to bypass RLS for writes. `README.md`:
how to apply (`supabase db push` or paste into SQL editor) + notes on the
password_hash column being a reference copy (device is authoritative).

---

## SKILL builder — `sonoma-skill/SKILL.md`, `skill.json`, `opensonoma-tool.ts`

The OpenSonoma skill exposed to the Sonoma model when ≥1 machine is linked.

- `skill.json`: the tool/skill definition (name `opensonoma`, description,
  parameter JSON-schema). Tool inputs should let the model: choose a `device_id`,
  pick an operation `kind` (bash/python/cpp/web/search/list_processes), pass the
  op params (mirroring the EXEC op shapes), and stream output back. Include a
  separate `unlock`/password capability or a `password` field flow. Model-facing
  description must explain the per-use password gate.
- `opensonoma-tool.ts`: reference TypeScript integration that (1) lists linked
  machines, (2) prompts the user for the machine password each invocation (smooth
  + fast), (3) opens/uses the relay client connection, sends `unlock` then `exec`
  (or `exec` carrying `auth.password`), and (4) streams `stream`/`result` frames
  back into the chat. Show the exact message shapes from `protocol.py`. It is a
  reference module to drop into Tripplet's tool layer — say so clearly.
- `SKILL.md`: human/model documentation — what it does, the password gate, the
  op kinds, examples, safety/audit notes (every op is logged).

---

## README builder — `README.md` (repo root)

The top-level doc: what OpenSonoma is, architecture diagram (device ⇄ relay ⇄
Sonoma), the **one-command install** then `opensonoma` to open the wizard, the
full setup→pair→use flow, all CLI commands, where files live, the security model
(local password hash, per-use gate, audit log, NAT-friendly outbound WSS), and
pointers to `relay/`, `supabase/`, `sonoma-skill/`. Accurate to the real CLI
surface and file layout above.
