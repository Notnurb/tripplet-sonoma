"""
Client for the Sonoma/Hefai FastAPI backend's /reports endpoints.

Reads BACKEND_URL and BACKEND_API_KEY from the repo root .env (same variables
main.py/auth.py use), so PyReport talks to the exact same backend instance the
Next.js app uses — no separate config.
"""

from __future__ import annotations

import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_ROOT / ".env")

DEFAULT_BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
API_KEY = os.getenv("BACKEND_API_KEY", "")


class BackendError(RuntimeError):
    pass


def _headers() -> dict:
    headers = {}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
    return headers


def check_health(backend_url: str = DEFAULT_BACKEND_URL, timeout: float = 3.0) -> dict:
    """GET /health — no auth required. Raises BackendError on failure."""
    try:
        resp = httpx.get(f"{backend_url.rstrip('/')}/health", timeout=timeout)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPError as exc:
        raise BackendError(f"Backend unreachable at {backend_url}: {exc}") from exc


def generate_generic_report(
    columns: list[str],
    rows: list[dict],
    title: str = "Data Report",
    source_label: str = "uploaded data",
    backend_url: str = DEFAULT_BACKEND_URL,
    timeout: float = 30.0,
) -> bytes:
    """POST /reports/generic — render backend-side, return PDF bytes."""
    try:
        resp = httpx.post(
            f"{backend_url.rstrip('/')}/reports/generic",
            json={"title": title, "source_label": source_label, "columns": columns, "rows": rows},
            headers=_headers(),
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.content
    except httpx.HTTPStatusError as exc:
        raise BackendError(f"Backend rejected request ({exc.response.status_code}): {exc.response.text}") from exc
    except httpx.HTTPError as exc:
        raise BackendError(f"Backend unreachable at {backend_url}: {exc}") from exc


def generate_user_memory_report(
    user_id: str,
    backend_url: str = DEFAULT_BACKEND_URL,
    timeout: float = 30.0,
) -> bytes:
    """GET /reports/user-memory/{user_id} — pulls mem0 + SuperMemory data server-side."""
    try:
        resp = httpx.get(
            f"{backend_url.rstrip('/')}/reports/user-memory/{user_id}",
            headers=_headers(),
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.content
    except httpx.HTTPStatusError as exc:
        raise BackendError(f"Backend rejected request ({exc.response.status_code}): {exc.response.text}") from exc
    except httpx.HTTPError as exc:
        raise BackendError(f"Backend unreachable at {backend_url}: {exc}") from exc
