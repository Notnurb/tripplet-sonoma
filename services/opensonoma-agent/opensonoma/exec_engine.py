"""The execution engine — where operations actually run.

The daemon owns the relay connection and the password gate; this module owns
*running things*. It receives an already-authorized op, runs it in its own
process group, streams stdout/stderr back via an ``emit`` callback, records the
operation to the append-only audit log, and returns a structured result.

Public interface (the daemon depends on exactly this):

    class ExecutionEngine:
        async def run(self, op_id, op, emit) -> dict
        async def cancel(self, op_id) -> bool
        def list_running(self) -> list
        async def shutdown(self) -> None

It builds NO protocol messages — it only calls ``await emit(stream, text)`` where
``stream`` is ``"stdout"`` or ``"stderr"``. Message framing is the daemon's job.

Target Python 3.9: no ``match`` statement, no ``X | Y`` runtime unions.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import signal
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

from . import constants
from . import protocol

EmitFn = Callable[[str, str], Awaitable[None]]

# How long to wait between SIGTERM and SIGKILL when killing a process group.
_KILL_GRACE = 3.0
# Chunk size for streaming reads.
_READ_CHUNK = 4096
# Cap how much output we decode per read to keep memory bounded on huge dumps.
_USER_AGENT = "OpenSonoma/{} (+https://tripplet.ai)".format(constants.VERSION)


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------
def _append_log(record: Dict[str, Any]) -> None:
    """Append one JSON object as a line to the operations audit log."""
    try:
        constants.ensure_config_dir()
        with open(constants.OPERATIONS_LOG, "a") as fh:
            fh.write(json.dumps(record) + "\n")
    except OSError:
        pass


def _ms_since(t0: float) -> int:
    return int((time.monotonic() - t0) * 1000)


def _summary(op: Dict[str, Any]) -> str:
    """Short human-readable description of an op (for logs + op_started)."""
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


class ExecutionEngine:
    """Runs operations, streams their output, and tracks live processes."""

    def __init__(self) -> None:
        # op_id -> record: {op_id, kind, command, process, pgid, started_at,
        #                   cancelled}
        self._running: Dict[str, Dict[str, Any]] = {}

    # -- public API ---------------------------------------------------------
    async def run(self, op_id: str, op: Dict[str, Any], emit: EmitFn) -> Dict[str, Any]:
        kind = str(op.get("kind", "") or "")
        command = _summary(op)
        started_at = protocol.now_iso()
        t0 = time.monotonic()

        _append_log(
            {"ts": started_at, "event": "start", "op_id": op_id, "kind": kind, "command": command}
        )

        ok = False
        exit_code: Optional[int] = -1
        error: Optional[str] = None
        data: Any = None

        try:
            if kind == protocol.KIND_BASH:
                ok, exit_code, error, data = await self._run_bash(op_id, op, emit)
            elif kind == protocol.KIND_PYTHON:
                ok, exit_code, error, data = await self._run_python(op_id, op, emit)
            elif kind == protocol.KIND_CPP:
                ok, exit_code, error, data = await self._run_cpp(op_id, op, emit)
            elif kind == protocol.KIND_WEB:
                ok, exit_code, error, data = await self._run_web(op, emit)
            elif kind == protocol.KIND_SEARCH:
                ok, exit_code, error, data = await self._run_search(op, emit)
            elif kind == protocol.KIND_LIST_PROCESSES:
                ok, exit_code, error, data = await self._run_list_processes(emit)
            else:
                error = "unknown operation kind: {!r}".format(kind)
                exit_code = -1
                try:
                    await emit(protocol.STREAM_STDERR, error + "\n")
                except Exception:  # noqa: BLE001
                    pass
        except asyncio.CancelledError:
            # Propagate so the daemon can shut us down cleanly.
            raise
        except Exception as exc:  # noqa: BLE001 - never let an op kill the daemon
            ok = False
            exit_code = -1
            error = "internal error: {!r}".format(exc)
        finally:
            self._running.pop(op_id, None)

        finished_at = protocol.now_iso()
        duration_ms = _ms_since(t0)
        _append_log(
            {
                "ts": finished_at,
                "event": "finish",
                "op_id": op_id,
                "kind": kind,
                "command": command,
                "exit_code": exit_code,
                "duration_ms": duration_ms,
                "error": error,
            }
        )

        return {
            "ok": ok,
            "exit_code": exit_code,
            "duration_ms": duration_ms,
            "started_at": started_at,
            "finished_at": finished_at,
            "error": error,
            "command": command,
            "data": data,
        }

    async def cancel(self, op_id: str) -> bool:
        info = self._running.get(op_id)
        if not info:
            return False
        info["cancelled"] = True
        self._terminate(info, signal.SIGTERM)
        return True

    def list_running(self) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for info in self._running.values():
            proc = info.get("process")
            out.append(
                {
                    "op_id": info.get("op_id"),
                    "kind": info.get("kind"),
                    "pid": proc.pid if proc is not None else None,
                    "started_at": info.get("started_at"),
                    "command": info.get("command"),
                }
            )
        return out

    async def shutdown(self) -> None:
        for info in list(self._running.values()):
            info["cancelled"] = True
            self._terminate(info, signal.SIGKILL)
        self._running.clear()

    # -- process plumbing ---------------------------------------------------
    def _terminate(self, info: Dict[str, Any], sig: int) -> None:
        """Signal the whole process group for an op (best effort)."""
        proc = info.get("process")
        pgid = info.get("pgid")
        if proc is None or proc.returncode is not None:
            return
        try:
            if pgid is not None and hasattr(os, "killpg"):
                os.killpg(pgid, sig)
            else:
                proc.send_signal(sig)
        except (ProcessLookupError, PermissionError, OSError):
            pass

    async def _pump(self, reader: Optional[asyncio.StreamReader], stream: str, emit: EmitFn) -> None:
        if reader is None:
            return
        while True:
            try:
                chunk = await reader.read(_READ_CHUNK)
            except (asyncio.CancelledError, GeneratorExit):
                raise
            except Exception:  # noqa: BLE001 - reader closed mid-read
                break
            if not chunk:
                break
            text = chunk.decode("utf-8", errors="replace")
            try:
                await emit(stream, text)
            except Exception:  # noqa: BLE001 - downstream send failure
                # Keep draining the pipe so the process isn't blocked on a full
                # buffer, but stop trying to forward.
                continue

    async def _spawn(
        self,
        op_id: str,
        kind: str,
        command: str,
        argv: List[str],
        emit: EmitFn,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Spawn a subprocess in its own process group and stream it to exit.

        Returns {exit_code, timed_out, cancelled}.
        """
        full_env = dict(os.environ)
        if env:
            full_env.update({str(k): str(v) for k, v in env.items()})

        kwargs: Dict[str, Any] = {
            "stdout": asyncio.subprocess.PIPE,
            "stderr": asyncio.subprocess.PIPE,
            "cwd": cwd or None,
            "env": full_env,
        }
        # Own process group so cancel()/timeout can kill children too.
        if hasattr(os, "setsid"):
            kwargs["start_new_session"] = True

        proc = await asyncio.create_subprocess_exec(*argv, **kwargs)

        pgid: Optional[int] = None
        try:
            pgid = os.getpgid(proc.pid)
        except (OSError, AttributeError):
            pgid = None

        info = self._running.get(op_id)
        if info is None:
            info = {"op_id": op_id, "kind": kind, "command": command, "cancelled": False}
            self._running[op_id] = info
        info["process"] = proc
        info["pgid"] = pgid
        info.setdefault("started_at", protocol.now_iso())

        out_task = asyncio.create_task(self._pump(proc.stdout, protocol.STREAM_STDOUT, emit))
        err_task = asyncio.create_task(self._pump(proc.stderr, protocol.STREAM_STDERR, emit))

        timed_out = False
        try:
            if timeout and timeout > 0:
                try:
                    await asyncio.wait_for(proc.wait(), timeout)
                except asyncio.TimeoutError:
                    timed_out = True
                    self._terminate(info, signal.SIGTERM)
                    try:
                        await asyncio.wait_for(proc.wait(), _KILL_GRACE)
                    except asyncio.TimeoutError:
                        self._terminate(info, signal.SIGKILL)
                        await proc.wait()
            else:
                await proc.wait()
        except asyncio.CancelledError:
            # Daemon shutdown / op cancellation — kill hard and re-raise.
            self._terminate(info, signal.SIGKILL)
            raise
        finally:
            await asyncio.gather(out_task, err_task, return_exceptions=True)

        return {
            "exit_code": proc.returncode,
            "timed_out": timed_out,
            "cancelled": bool(info.get("cancelled")),
        }

    @staticmethod
    def _outcome(res: Dict[str, Any]) -> "tuple":
        """Map a _spawn result to (ok, exit_code, error)."""
        if res.get("cancelled"):
            return False, res.get("exit_code"), "cancelled"
        if res.get("timed_out"):
            return False, res.get("exit_code"), "timeout"
        code = res.get("exit_code")
        return (code == 0), code, (None if code == 0 else "exit code {}".format(code))

    # -- op kinds -----------------------------------------------------------
    async def _run_bash(self, op_id: str, op: Dict[str, Any], emit: EmitFn) -> "tuple":
        command = str(op.get("command", "") or "")
        if not command.strip():
            await emit(protocol.STREAM_STDERR, "no command provided\n")
            return False, -1, "empty command", None

        cwd = op.get("cwd")
        env = op.get("env")
        timeout = op.get("timeout")
        background = bool(op.get("background"))
        argv = ["/bin/bash", "-lc", command]

        if background:
            # Spawn, then detach: stream + reap in a background task and return
            # immediately so a long-running server doesn't block the session.
            self._running[op_id] = {
                "op_id": op_id,
                "kind": protocol.KIND_BASH,
                "command": command,
                "cancelled": False,
                "started_at": protocol.now_iso(),
            }
            asyncio.create_task(
                self._spawn(op_id, protocol.KIND_BASH, command, argv, emit, cwd, env, None)
            )
            await emit(protocol.STREAM_STDERR, "=== started in background ===\n")
            return True, None, None, {"background": True}

        res = await self._spawn(
            op_id, protocol.KIND_BASH, command, argv, emit, cwd, env,
            float(timeout) if timeout else None,
        )
        ok, code, err = self._outcome(res)
        return ok, code, err, None

    async def _run_python(self, op_id: str, op: Dict[str, Any], emit: EmitFn) -> "tuple":
        code = str(op.get("code", "") or "")
        if not code.strip():
            await emit(protocol.STREAM_STDERR, "no code provided\n")
            return False, -1, "empty code", None

        constants.ensure_config_dir()
        fd, path = tempfile.mkstemp(suffix=".py", prefix="op-", dir=str(constants.WORK_DIR))
        try:
            with os.fdopen(fd, "w") as fh:
                fh.write(code)
            args = [str(a) for a in (op.get("args") or [])]
            argv = [sys.executable, path] + args
            res = await self._spawn(
                op_id, protocol.KIND_PYTHON, _summary(op), argv, emit,
                op.get("cwd"), None, float(op.get("timeout")) if op.get("timeout") else None,
            )
            ok, ec, err = self._outcome(res)
            return ok, ec, err, None
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    async def _run_cpp(self, op_id: str, op: Dict[str, Any], emit: EmitFn) -> "tuple":
        files = op.get("files") or {}
        build_system = str(op.get("build_system", "") or "g++").lower()
        timeout = float(op.get("timeout")) if op.get("timeout") else None

        constants.ensure_config_dir()
        proj = Path(tempfile.mkdtemp(prefix="cpp-", dir=str(constants.WORK_DIR)))
        try:
            # Write every supplied source file (creating parent dirs).
            for rel, content in files.items():
                dest = proj / str(rel)
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(content if isinstance(content, str) else str(content))

            output = str(op.get("output", "") or "app")
            target = op.get("target")
            sources = [str(s) for s in (op.get("sources") or [])]
            build_args = [str(a) for a in (op.get("build_args") or [])]

            await emit(protocol.STREAM_STDERR, "=== build ===\n")
            if build_system == "cmake":
                cfg = await self._spawn(
                    op_id, protocol.KIND_CPP, "cmake -S . -B build",
                    ["cmake", "-S", ".", "-B", "build"] + build_args, emit, str(proj), None, timeout,
                )
                ok, ec, err = self._outcome(cfg)
                if ok:
                    build_cmd = ["cmake", "--build", "build"]
                    if target:
                        build_cmd += ["--target", str(target)]
                    res = await self._spawn(op_id, protocol.KIND_CPP, " ".join(build_cmd), build_cmd, emit, str(proj), None, timeout)
                    ok, ec, err = self._outcome(res)
                binary = str(proj / "build" / (str(target) if target else output))
            elif build_system == "make":
                res = await self._spawn(op_id, protocol.KIND_CPP, "make", ["make"] + build_args, emit, str(proj), None, timeout)
                ok, ec, err = self._outcome(res)
                binary = str(proj / output)
            else:
                compiler = "clang++" if build_system == "clang" else "g++"
                if not sources:
                    sources = sorted(
                        str(p.relative_to(proj)) for p in proj.rglob("*")
                        if p.suffix in (".cpp", ".cc", ".cxx", ".c")
                    )
                cmd = [compiler, "-O2", "-std=c++17", "-o", output] + sources + build_args
                res = await self._spawn(op_id, protocol.KIND_CPP, " ".join(cmd), cmd, emit, str(proj), None, timeout)
                ok, ec, err = self._outcome(res)
                binary = str(proj / output)

            if not ok:
                return ok, ec, err, {"stage": "build"}

            if op.get("run"):
                await emit(protocol.STREAM_STDERR, "=== run ===\n")
                run_args = [str(a) for a in (op.get("run_args") or [])]
                if not os.path.exists(binary):
                    await emit(protocol.STREAM_STDERR, "built binary not found: {}\n".format(binary))
                    return False, -1, "binary missing after build", {"stage": "run"}
                res = await self._spawn(op_id, protocol.KIND_CPP, binary, [binary] + run_args, emit, str(proj), None, timeout)
                ok, ec, err = self._outcome(res)
                return ok, ec, err, {"stage": "run"}

            return ok, ec, err, {"stage": "build"}
        finally:
            # Leave artifacts in WORK_DIR for debugging? No — clean up to bound disk.
            try:
                import shutil
                shutil.rmtree(proj, ignore_errors=True)
            except Exception:  # noqa: BLE001
                pass

    async def _run_web(self, op: Dict[str, Any], emit: EmitFn) -> "tuple":
        url = str(op.get("url", "") or "")
        if not url:
            await emit(protocol.STREAM_STDERR, "no url provided\n")
            return False, -1, "missing url", None
        method = str(op.get("method", "GET") or "GET").upper()
        headers = {str(k): str(v) for k, v in (op.get("headers") or {}).items()}
        headers.setdefault("User-Agent", _USER_AGENT)
        body = op.get("body")
        data = body.encode("utf-8") if isinstance(body, str) else body
        timeout = float(op.get("timeout")) if op.get("timeout") else 30.0

        def do_request() -> Dict[str, Any]:
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    raw = resp.read()
                    return {
                        "status": resp.status,
                        "reason": resp.reason,
                        "headers": dict(resp.headers.items()),
                        "body": raw.decode("utf-8", errors="replace"),
                    }
            except urllib.error.HTTPError as exc:
                raw = exc.read()
                return {
                    "status": exc.code,
                    "reason": exc.reason,
                    "headers": dict(exc.headers.items()) if exc.headers else {},
                    "body": raw.decode("utf-8", errors="replace"),
                }

        try:
            result = await asyncio.to_thread(do_request)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            await emit(protocol.STREAM_STDERR, "request failed: {}\n".format(exc))
            return False, -1, "request failed: {}".format(exc), None

        await emit(protocol.STREAM_STDOUT, "{} {} {}\n".format(method, result["status"], result.get("reason", "")))
        for hk, hv in result["headers"].items():
            await emit(protocol.STREAM_STDOUT, "{}: {}\n".format(hk, hv))
        await emit(protocol.STREAM_STDOUT, "\n" + result["body"])

        status = int(result["status"])
        ok = 200 <= status < 400
        return ok, status, (None if ok else "HTTP {}".format(status)), {
            "status": status,
            "headers": result["headers"],
            "body_len": len(result["body"]),
        }

    async def _run_search(self, op: Dict[str, Any], emit: EmitFn) -> "tuple":
        query = str(op.get("query", "") or "")
        if not query.strip():
            await emit(protocol.STREAM_STDERR, "no query provided\n")
            return False, -1, "empty query", None
        max_results = int(op.get("max_results", 8) or 8)
        url = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(query)

        def fetch() -> str:
            req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
            with urllib.request.urlopen(req, timeout=20) as resp:
                return resp.read().decode("utf-8", errors="replace")

        try:
            html = await asyncio.to_thread(fetch)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            await emit(protocol.STREAM_STDERR, "search failed: {}\n".format(exc))
            return False, -1, "search failed: {}".format(exc), {"results": []}

        results: List[Dict[str, str]] = []
        pattern = re.compile(r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)
        for m in pattern.finditer(html):
            href = m.group(1)
            title = re.sub(r"<[^>]+>", "", m.group(2))
            title = re.sub(r"\s+", " ", title).strip()
            # DuckDuckGo wraps the real URL in a redirect; pull out uddg=.
            parsed = urllib.parse.urlparse(href)
            qs = urllib.parse.parse_qs(parsed.query)
            real = qs.get("uddg", [href])[0]
            results.append({"title": title, "url": real})
            if len(results) >= max_results:
                break

        if not results:
            await emit(protocol.STREAM_STDOUT, "No results found.\n")
        for i, r in enumerate(results, 1):
            await emit(protocol.STREAM_STDOUT, "{}. {}\n   {}\n".format(i, r["title"], r["url"]))

        return True, 0, None, {"results": results}

    async def _run_list_processes(self, emit: EmitFn) -> "tuple":
        running = self.list_running()
        if not running:
            await emit(protocol.STREAM_STDOUT, "No operations are currently running.\n")
        else:
            await emit(protocol.STREAM_STDOUT, "{} operation(s) running:\n".format(len(running)))
            for r in running:
                await emit(
                    protocol.STREAM_STDOUT,
                    "  [{}] {} (pid {}) {}\n".format(r["op_id"], r["kind"], r["pid"], r["command"]),
                )
        return True, 0, None, running
