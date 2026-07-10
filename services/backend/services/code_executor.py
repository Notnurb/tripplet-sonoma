"""
E2B-backed code execution service.

Keeps one sandbox per chat session so Python/Bash state can persist across
multiple tool calls within the same conversation.
"""

from __future__ import annotations

import asyncio
import os
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Literal

try:
    from e2b_code_interpreter import AsyncSandbox

    E2B_AVAILABLE = True
except ImportError:
    AsyncSandbox = None  # type: ignore[assignment]
    E2B_AVAILABLE = False


ExecutionLanguage = Literal["python", "bash"]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _coerce_output_text(payload: Any) -> str:
    if payload is None:
        return ""
    if isinstance(payload, str):
        return payload
    text = getattr(payload, "text", None)
    if isinstance(text, str):
        return text
    text = getattr(payload, "value", None)
    if isinstance(text, str):
        return text
    if isinstance(payload, dict):
        for key in ("text", "value", "message"):
            value = payload.get(key)
            if isinstance(value, str):
                return value
    return str(payload)


def _serialize_execution_error(error: Any) -> dict[str, Any]:
    if error is None:
        return {}
    if isinstance(error, dict):
        return error

    payload: dict[str, Any] = {}
    for key in ("name", "value", "traceback"):
        value = getattr(error, key, None)
        if value is not None:
            payload[key] = value

    if not payload:
        payload["message"] = str(error)

    return payload


@dataclass
class SandboxSession:
    session_id: str
    sandbox_id: str
    sandbox: Any
    created_at: str
    last_used_at: str


class CodeExecutorError(RuntimeError):
    """Raised when E2B execution cannot be started or completed."""


class CodeExecutorService:
    def __init__(self) -> None:
        self._sessions: dict[str, SandboxSession] = {}
        self._session_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._run_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._sandbox_timeout_seconds = int(os.getenv("E2B_SANDBOX_TIMEOUT_SECONDS", "1800"))
        self._request_timeout_seconds = float(os.getenv("E2B_REQUEST_TIMEOUT_SECONDS", "30"))

    def ensure_ready(self) -> None:
        if not E2B_AVAILABLE:
            raise CodeExecutorError(
                "E2B SDK is not installed. Add `e2b-code-interpreter` to the backend environment."
            )
        if not os.getenv("E2B_API_KEY"):
            raise CodeExecutorError("E2B_API_KEY is not configured.")

    async def shutdown(self) -> None:
        sessions = list(self._sessions.values())
        self._sessions.clear()

        async def _kill(session: SandboxSession) -> None:
            try:
                await session.sandbox.kill(request_timeout=self._request_timeout_seconds)
            except Exception:
                # Best effort cleanup on shutdown.
                pass

        if sessions:
            await asyncio.gather(*(_kill(session) for session in sessions), return_exceptions=True)

    async def _get_or_create_sandbox(self, session_id: str) -> tuple[SandboxSession, bool]:
        self.ensure_ready()

        async with self._session_locks[session_id]:
            existing = self._sessions.get(session_id)
            if existing:
                try:
                    sandbox = await existing.sandbox.connect(
                        timeout=self._sandbox_timeout_seconds,
                        request_timeout=self._request_timeout_seconds,
                    )
                    existing.sandbox = sandbox
                    existing.last_used_at = utc_now_iso()
                    return existing, False
                except Exception:
                    self._sessions.pop(session_id, None)

            sandbox = await AsyncSandbox.create(  # type: ignore[union-attr]
                timeout=self._sandbox_timeout_seconds,
                metadata={"session_id": session_id},
                request_timeout=self._request_timeout_seconds,
            )
            now = utc_now_iso()
            session = SandboxSession(
                session_id=session_id,
                sandbox_id=sandbox.sandbox_id,
                sandbox=sandbox,
                created_at=now,
                last_used_at=now,
            )
            self._sessions[session_id] = session
            return session, True

    async def stream_execution(
        self,
        *,
        session_id: str,
        execution_id: str,
        language: ExecutionLanguage,
        code: str,
        timeout_seconds: float,
    ) -> AsyncIterator[dict[str, Any]]:
        session, created = await self._get_or_create_sandbox(session_id)
        started_at = utc_now_iso()

        yield {
            "type": "started",
            "execution": {
                "id": execution_id,
                "session_id": session_id,
                "sandbox_id": session.sandbox_id,
                "language": language,
                "code": code,
                "status": "running",
                "started_at": started_at,
                "sandbox_created": created,
            },
        }

        async with self._run_locks[session_id]:
            stdout_chunks: list[str] = []
            stderr_chunks: list[str] = []
            result_chunks: list[str] = []
            error_payload: dict[str, Any] | None = None

            queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

            async def on_stdout(message: Any) -> None:
                text = _coerce_output_text(message)
                if not text:
                    return
                stdout_chunks.append(text)
                await queue.put(
                    {
                        "type": "stdout",
                        "execution_id": execution_id,
                        "chunk": text,
                    }
                )

            async def on_stderr(message: Any) -> None:
                text = _coerce_output_text(message)
                if not text:
                    return
                stderr_chunks.append(text)
                await queue.put(
                    {
                        "type": "stderr",
                        "execution_id": execution_id,
                        "chunk": text,
                    }
                )

            async def on_result(result: Any) -> None:
                text = _coerce_output_text(result)
                if not text:
                    return
                result_chunks.append(text)
                await queue.put(
                    {
                        "type": "result",
                        "execution_id": execution_id,
                        "chunk": text,
                    }
                )

            async def on_error(error: Any) -> None:
                nonlocal error_payload
                error_payload = _serialize_execution_error(error)

            async def runner() -> None:
                nonlocal error_payload
                try:
                    execution = await session.sandbox.run_code(
                        code,
                        language=language,
                        timeout=timeout_seconds,
                        request_timeout=self._request_timeout_seconds,
                        on_stdout=on_stdout,
                        on_stderr=on_stderr,
                        on_result=on_result,
                        on_error=on_error,
                    )

                    logs = getattr(execution, "logs", None)
                    stdout = "".join(stdout_chunks) or "".join(getattr(logs, "stdout", []) or [])
                    stderr = "".join(stderr_chunks) or "".join(getattr(logs, "stderr", []) or [])
                    output = getattr(execution, "text", None) or "".join(result_chunks)
                    e2b_error = getattr(execution, "error", None)
                    if e2b_error:
                        error_payload = _serialize_execution_error(e2b_error)

                    await queue.put(
                        {
                            "type": "finished",
                            "execution": {
                                "id": execution_id,
                                "session_id": session_id,
                                "sandbox_id": session.sandbox_id,
                                "language": language,
                                "code": code,
                                "status": "error" if error_payload else "completed",
                                "stdout": stdout,
                                "stderr": stderr,
                                "output": output,
                                "error": error_payload,
                                "started_at": started_at,
                                "completed_at": utc_now_iso(),
                            },
                        }
                    )
                except Exception as exc:
                    await queue.put(
                        {
                            "type": "finished",
                            "execution": {
                                "id": execution_id,
                                "session_id": session_id,
                                "sandbox_id": session.sandbox_id,
                                "language": language,
                                "code": code,
                                "status": "error",
                                "stdout": "".join(stdout_chunks),
                                "stderr": "".join(stderr_chunks),
                                "output": "".join(result_chunks),
                                "error": {
                                    "message": str(exc),
                                },
                                "started_at": started_at,
                                "completed_at": utc_now_iso(),
                            },
                        }
                    )
                finally:
                    session.last_used_at = utc_now_iso()
                    await queue.put(None)

            task = asyncio.create_task(runner())
            try:
                while True:
                    event = await queue.get()
                    if event is None:
                        break
                    yield event
            finally:
                await task


code_executor = CodeExecutorService()


async def shutdown_code_executor() -> None:
    await code_executor.shutdown()
