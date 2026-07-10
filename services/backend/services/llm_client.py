"""
LLM backend configuration — provider-neutral, OpenAI-compatible.

The backend talks to Tripplet's own inference backend over the standard
OpenAI-compatible ``/chat/completions`` API. Everything is env-driven so the
underlying host/provider can change without touching code — the single
indirection point for the whole service (mirrors ``resolveBackend()`` on the
Next.js side).

Environment:
  LLM_API_KEY          Bearer token for the inference API.
  LLM_BASE_URL         OpenAI-compatible base URL, e.g. ``https://host/v1``.
  LLM_MODEL            Default chat/completions model id.
  LLM_SYNTHESIS_MODEL  Optional stronger model for final synthesis; falls back
                       to LLM_MODEL when unset.

Values are read at call time (not import time) so a late ``load_dotenv`` or a
test that patches the environment is picked up correctly.
"""

import os


def api_key() -> str:
    return os.getenv("LLM_API_KEY", "")


def base_url() -> str:
    return os.getenv("LLM_BASE_URL", "").rstrip("/")


def model() -> str:
    return os.getenv("LLM_MODEL", "")


def synthesis_model() -> str:
    return os.getenv("LLM_SYNTHESIS_MODEL", "") or model()


def is_configured() -> bool:
    """True only when enough is set to actually reach the backend."""
    return bool(api_key() and base_url() and model())


def not_configured_error() -> str:
    return "LLM backend not configured (set LLM_API_KEY, LLM_BASE_URL, LLM_MODEL)"


def chat_completions_url() -> str:
    return f"{base_url()}/chat/completions"


def auth_headers() -> dict:
    return {
        "Authorization": f"Bearer {api_key()}",
        "Content-Type": "application/json",
    }
