"""The OpenSonoma daemon.

The daemon is the long-lived process that runs on the user's machine. It dials
*out* to the Tripplet relay over a secure WebSocket (so it works behind NAT with
no inbound ports), registers this device, then waits for operations from a Sonoma
session. Each ``exec``/``unlock`` carries the per-use password, which the daemon
verifies against the *local* scrypt hash before doing anything. Output streams
back live; every operation is recorded to an append-only audit log by the
execution engine.

Public surface (used by ``cli.py`` and the service runner):

  * ``async def run_daemon() -> None`` — the async entry point.
  * ``def main() -> None`` — sync wrapper that manages the pidfile and runs
    ``run_daemon()`` under ``asyncio.run`` with signal-driven shutdown.

Heavy / optional imports (``websockets`` and ``opensonoma.exec_engine``) are done
lazily inside the run path so this module stays importable for ``status``/``logs``
on hosts where those are unavailable, and so importing it never pulls in Textual.
"""

from __future__ import annotations

import asyncio
import collections
import json
import os
import signal
import ssl
import sys
import tempfile
import time

from . import constants
from . import protocol
from .config import Config, Secret, is_first_run


# ---------------------------------------------------------------------------
# Small module-level helpers (also used by main())
# ---------------------------------------------------------------------------
def _write_daemon_log(message: str) -> None:
    """Append a single timestamped line to the daemon log (best effort)."""
    line = "{} [daemon] {}\n".format(protocol.now_iso(), message)
    try:
        constants.CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        with open(constants.DAEMON_LOG, "a") as fh:
            fh.write(line)
    except OSError:
        pass


def _atomic_write_json(path, obj) -> None:
    """Write *obj* as pretty JSON to *path* atomically (tmp + rename)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-status-")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(obj, fh, indent=2)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


def _iso_after(seconds: float) -> str:
    """UTC ISO-8601 timestamp *seconds* in the future (matches now_iso format)."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + seconds))


def _write_pidfile() -> None:
    constants.ensure_config_dir()
    try:
        constants.PID_FILE.write_text(str(os.getpid()))
    except OSError:
        pass


def _remove_pidfile() -> None:
    try:
        constants.PID_FILE.unlink()
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Daemon
# ---------------------------------------------------------------------------
class Daemon:
    """Owns the relay connection, the execution engine, and live status."""

    def __init__(self, config: Config, secret: Secret, engine) -> None:
        self.config = config
        self.secret = secret
        self.engine = engine

        # link_state is one of: "connecting", "online", "offline"
        self.link_state = "connecting"
        self.connected_since = None  # type: ignore[assignment]

        # Most-recent operations, op_id -> record, capped to RECENT_OPS_KEPT.
        self.recent_ops = collections.OrderedDict()

        self.ws = None
        self._stop = asyncio.Event()
        self._op_tasks = set()
        self._send_lock = asyncio.Lock()

    # -- logging ------------------------------------------------------------
    def _log(self, message: str) -> None:
        _write_daemon_log(message)

    # -- status -------------------------------------------------------------
    def _status_payload(self) -> dict:
        return {
            "machine_name": self.config.machine_name,
            "pairing_code": self.config.pairing_code,
            "paired": bool(self.config.paired),
            "account_id": self.config.account_id,
            "link_state": self.link_state,
            "connected_since": self.connected_since,
            "version": constants.VERSION,
            "pid": os.getpid(),
            "recent_ops": list(self.recent_ops.values()),
        }

    def _write_status_now(self) -> None:
        try:
            _atomic_write_json(constants.STATUS_FILE, self._status_payload())
        except Exception as exc:  # noqa: BLE001 - status must never crash us
            self._log("status write failed: {!r}".format(exc))

    async def _status_loop(self) -> None:
        while not self._stop.is_set():
            self._write_status_now()
            try:
                await asyncio.wait_for(
                    self._stop.wait(), timeout=constants.STATUS_WRITE_INTERVAL
                )
            except asyncio.TimeoutError:
                pass

    # -- recent-ops bookkeeping --------------------------------------------
    def _record_start(self, op_id: str, kind: str, command: str) -> None:
        self.recent_ops[op_id] = {
            "op_id": op_id,
            "kind": kind,
            "command": command,
            "exit_code": None,
            "started_at": protocol.now_iso(),
            "finished_at": None,
        }
        while len(self.recent_ops) > constants.RECENT_OPS_KEPT:
            self.recent_ops.popitem(last=False)

    def _record_finish(self, op_id: str, result: dict) -> None:
        rec = self.recent_ops.get(op_id)
        if rec is None:
            return
        rec["exit_code"] = result.get("exit_code")
        rec["started_at"] = result.get("started_at") or rec.get("started_at")
        rec["finished_at"] = result.get("finished_at") or protocol.now_iso()

    # -- sending ------------------------------------------------------------
    async def _send(self, ws, obj: dict) -> bool:
        """Serialize and send one frame. Never raises; logs and returns False."""
        if ws is None:
            return False
        try:
            data = json.dumps(obj)
        except (TypeError, ValueError) as exc:
            self._log("refusing to send unserializable frame: {!r}".format(exc))
            return False
        try:
            async with self._send_lock:
                await ws.send(data)
            return True
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - socket closed / errored
            self._log("send failed: {!r}".format(exc))
            return False

    # -- connection ---------------------------------------------------------
    async def _connect_loop(self) -> None:
        delay = constants.RECONNECT_BASE_DELAY
        while not self._stop.is_set():
            connected = await self._connect_once()
            if self._stop.is_set():
                break
            self.link_state = "offline"
            self.connected_since = None
            self._write_status_now()
            if connected:
                # A real session ended; reset backoff for the next attempt.
                delay = constants.RECONNECT_BASE_DELAY
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=delay)
            except asyncio.TimeoutError:
                pass
            if not connected:
                delay = min(delay * 2, constants.RECONNECT_MAX_DELAY)

    async def _connect_once(self) -> bool:
        """Open one relay session. Returns True if the socket opened at all."""
        import websockets  # lazy: keeps module importable without the dep

        url = self.config.relay_url
        self.link_state = "connecting"
        self._write_status_now()

        ssl_ctx = None
        if url.lower().startswith("wss://"):
            ssl_ctx = ssl.create_default_context()

        try:
            ws = await websockets.connect(
                url,
                ssl=ssl_ctx,
                open_timeout=15,
                ping_interval=constants.HEARTBEAT_INTERVAL,
                ping_timeout=constants.HEARTBEAT_INTERVAL,
                close_timeout=5,
                max_size=None,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - DNS/TLS/refused/etc.
            self._log("connect to {} failed: {!r}".format(url, exc))
            return False

        self._log("connected to relay {}".format(url))
        self.ws = ws
        hb_task = None
        try:
            await self._register(ws)
            hb_task = asyncio.create_task(self._heartbeat_loop(ws))
            async for raw in ws:
                if self._stop.is_set():
                    break
                await self._handle_raw(ws, raw)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - connection closed/errored
            self._log("relay connection ended: {!r}".format(exc))
        finally:
            if hb_task is not None:
                hb_task.cancel()
                try:
                    await hb_task
                except asyncio.CancelledError:
                    pass
                except Exception:  # noqa: BLE001
                    pass
            self.ws = None
            try:
                await ws.close()
            except Exception:  # noqa: BLE001
                pass
        return True

    async def _register(self, ws) -> None:
        had_token = bool(self.secret.device_token)
        token = self.secret.ensure_device_token()
        if not had_token:
            try:
                self.secret.save()
            except OSError as exc:
                self._log("could not persist device token: {!r}".format(exc))
        msg = protocol.register_msg(
            self.config.device_id,
            token,
            self.config.machine_name,
            self.config.pairing_code,
            self.secret.password_hash,
            constants.VERSION,
        )
        await self._send(ws, msg)
        self._log("sent register for device {}".format(self.config.device_id))

    async def _heartbeat_loop(self, ws) -> None:
        try:
            while True:
                await asyncio.sleep(constants.HEARTBEAT_INTERVAL)
                ok = await self._send(ws, protocol.heartbeat_msg())
                if not ok:
                    break
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            pass

    # -- inbound dispatch ---------------------------------------------------
    async def _handle_raw(self, ws, raw) -> None:
        try:
            msg = json.loads(raw)
        except (ValueError, TypeError):
            self._log("dropping non-JSON frame")
            return
        if not isinstance(msg, dict):
            self._log("dropping non-object frame")
            return
        mtype = msg.get("type")
        try:
            if mtype == protocol.T_REGISTER_ACK:
                await self._on_register_ack(msg)
            elif mtype == protocol.T_EXEC:
                await self._on_exec(ws, msg)
            elif mtype == protocol.T_UNLOCK:
                await self._on_unlock(ws, msg)
            elif mtype == protocol.T_CANCEL:
                await self._on_cancel(ws, msg)
            elif mtype == protocol.T_PAIRED:
                await self._on_paired(msg)
            elif mtype == protocol.T_HEARTBEAT:
                pass  # relay keepalive, nothing to do
            elif mtype == protocol.T_ERROR:
                self._log("relay error: {}".format(msg.get("message")))
            else:
                self._log("ignoring unknown message type: {!r}".format(mtype))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - one bad msg must not kill us
            self._log("handler error for {!r}: {!r}".format(mtype, exc))

    async def _on_register_ack(self, msg: dict) -> None:
        self.link_state = "online"
        self.connected_since = protocol.now_iso()
        changed = False
        account_id = msg.get("account_id")
        if account_id and account_id != self.config.account_id:
            self.config.account_id = account_id
            changed = True
        paired = msg.get("paired")
        if paired is not None and bool(paired) != bool(self.config.paired):
            self.config.paired = bool(paired)
            changed = True
        if changed:
            try:
                self.config.save()
            except OSError as exc:
                self._log("could not persist config: {!r}".format(exc))
        self._log("registered; link is online")
        self._write_status_now()

    async def _on_paired(self, msg: dict) -> None:
        self.config.paired = True
        account_id = msg.get("account_id")
        if account_id:
            self.config.account_id = account_id
        try:
            self.config.save()
        except OSError as exc:
            self._log("could not persist config on pair: {!r}".format(exc))
        self._log("paired with account {}".format(self.config.account_id))
        self._write_status_now()

    async def _on_unlock(self, ws, msg: dict) -> None:
        req_id = msg.get("id")
        session_id = msg.get("session_id")
        password = msg.get("password", "") or ""
        if self.secret.verify(password):
            expires_at = _iso_after(constants.UNLOCK_TTL_SECONDS)
            await self._send(
                ws,
                protocol.unlock_result_msg(
                    req_id, session_id, True, expires_at=expires_at, error=None
                ),
            )
            self._log("unlock ok for session {}".format(session_id))
        else:
            await self._send(
                ws,
                protocol.unlock_result_msg(
                    req_id, session_id, False, expires_at=None,
                    error="invalid password",
                ),
            )
            self._log("unlock rejected for session {}".format(session_id))

    async def _on_cancel(self, ws, msg: dict) -> None:
        target_id = msg.get("target_id")
        found = await self.engine.cancel(target_id)
        self._log("cancel {} -> {}".format(target_id, "killed" if found else "not found"))

    async def _on_exec(self, ws, msg: dict) -> None:
        op_id = msg.get("id")
        session_id = msg.get("session_id")
        auth = msg.get("auth") or {}
        password = auth.get("password", "") or ""
        op = msg.get("op") or {}

        if not self.secret.verify(password):
            stamp = protocol.now_iso()
            await self._send(
                ws,
                protocol.result_msg(
                    op_id, session_id, ok=False, exit_code=None, duration_ms=0,
                    started_at=stamp, finished_at=stamp,
                    error="authentication failed",
                ),
            )
            self._log("exec auth failed for op {}".format(op_id))
            return

        kind = op.get("kind", "")
        command = self._op_command(op)
        await self._send(ws, protocol.op_started_msg(op_id, session_id, kind, command))
        self._record_start(op_id, kind, command)
        self._write_status_now()

        task = asyncio.create_task(self._run_op(ws, op_id, session_id, op))
        self._op_tasks.add(task)
        task.add_done_callback(self._op_tasks.discard)

    async def _run_op(self, ws, op_id, session_id, op: dict) -> None:
        seq = {"n": 0}

        async def emit(stream, text):
            # Single-threaded asyncio: read/increment is atomic (no await between).
            n = seq["n"]
            seq["n"] = n + 1
            await self._send(ws, protocol.stream_msg(op_id, session_id, stream, n, text))

        try:
            result = await self.engine.run(op_id, op, emit)
        except asyncio.CancelledError:
            # Daemon is shutting down; let the cancellation propagate.
            raise
        except Exception as exc:  # noqa: BLE001 - engine must never kill the daemon
            stamp = protocol.now_iso()
            result = {
                "ok": False,
                "exit_code": -1,
                "duration_ms": 0,
                "started_at": stamp,
                "finished_at": stamp,
                "error": "internal error: {!r}".format(exc),
                "command": self._op_command(op),
                "data": None,
            }
            self._log("op {} crashed: {!r}".format(op_id, exc))

        self._record_finish(op_id, result)
        self._write_status_now()
        await self._send(
            ws,
            protocol.result_msg(
                op_id,
                session_id,
                result.get("ok", False),
                result.get("exit_code"),
                result.get("duration_ms", 0),
                result.get("started_at"),
                result.get("finished_at"),
                result.get("error"),
            ),
        )

    @staticmethod
    def _op_command(op: dict) -> str:
        """A short human-readable summary of an op for op_started / status."""
        kind = op.get("kind", "")
        if kind == protocol.KIND_BASH:
            return str(op.get("command", "") or "")
        if kind == protocol.KIND_PYTHON:
            code = str(op.get("code", "") or "")
            first = code.strip().splitlines()[0] if code.strip() else "<empty>"
            return "python: {}".format(first)
        if kind == protocol.KIND_CPP:
            return "cpp build ({})".format(op.get("build_system", "?"))
        if kind == protocol.KIND_WEB:
            return "{} {}".format(op.get("method", "GET"), op.get("url", ""))
        if kind == protocol.KIND_SEARCH:
            return "search: {}".format(op.get("query", ""))
        if kind == protocol.KIND_LIST_PROCESSES:
            return "list_processes"
        return str(kind or "")

    # -- lifecycle ----------------------------------------------------------
    def _request_stop(self) -> None:
        if not self._stop.is_set():
            self._log("stop requested")
        self._stop.set()

    async def run(self) -> None:
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, self._request_stop)
            except (NotImplementedError, RuntimeError, ValueError):
                # Signal handlers may be unavailable (e.g. non-main thread).
                pass

        self._log("daemon starting (pid {})".format(os.getpid()))
        self._write_status_now()

        status_task = asyncio.create_task(self._status_loop())
        conn_task = asyncio.create_task(self._connect_loop())

        try:
            await self._stop.wait()
        finally:
            self._log("daemon stopping")
            for task in (conn_task, status_task):
                task.cancel()
            for task in (conn_task, status_task):
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                except Exception as exc:  # noqa: BLE001
                    self._log("task shutdown error: {!r}".format(exc))

            for task in list(self._op_tasks):
                task.cancel()
            if self._op_tasks:
                await asyncio.gather(*self._op_tasks, return_exceptions=True)

            try:
                await self.engine.shutdown()
            except Exception as exc:  # noqa: BLE001
                self._log("engine shutdown error: {!r}".format(exc))

            if self.ws is not None:
                try:
                    await self.ws.close()
                except Exception:  # noqa: BLE001
                    pass
                self.ws = None

            self.link_state = "offline"
            self.connected_since = None
            self._write_status_now()
            self._log("daemon stopped")


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------
async def run_daemon() -> None:
    """Async entry point: build the engine + daemon and run until stopped."""
    from .exec_engine import ExecutionEngine  # lazy: engine is a sibling builder

    config = Config.load()
    secret = Secret.load()
    engine = ExecutionEngine()
    daemon = Daemon(config, secret, engine)
    await daemon.run()


def main() -> None:
    """Synchronous entry point used by the CLI/service to run the daemon."""
    constants.ensure_config_dir()

    if is_first_run():
        sys.stderr.write(
            "OpenSonoma is not set up yet. Run: opensonoma setup\n"
        )
        raise SystemExit(1)

    _write_pidfile()
    try:
        asyncio.run(run_daemon())
    except KeyboardInterrupt:
        pass
    finally:
        _remove_pidfile()


if __name__ == "__main__":
    main()
