"""Shared constants, paths, and defaults for OpenSonoma.

Every other module imports paths and names from here so there is a single source
of truth. The on-disk layout lives under ~/.opensonoma on both macOS and Linux.
"""

from __future__ import annotations

import os
from pathlib import Path

APP_NAME = "OpenSonoma"
BUNDLE_ID = "ai.tripplet.opensonoma"
SERVICE_LABEL = BUNDLE_ID  # launchd label / systemd unit base name
SYSTEMD_UNIT_NAME = "opensonoma.service"
VERSION = "1.0.0"

# ---------------------------------------------------------------------------
# Filesystem layout
# ---------------------------------------------------------------------------
def _config_dir() -> Path:
    override = os.environ.get("OPENSONOMA_HOME")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".opensonoma"


CONFIG_DIR = _config_dir()
CONFIG_FILE = CONFIG_DIR / "config.json"
SECRET_FILE = CONFIG_DIR / "secret.json"
OPERATIONS_LOG = CONFIG_DIR / "operations.log"   # append-only JSONL of every op
DAEMON_LOG = CONFIG_DIR / "daemon.log"           # daemon runtime log
STATUS_FILE = CONFIG_DIR / "status.json"         # live status written by daemon
PID_FILE = CONFIG_DIR / "daemon.pid"
WORK_DIR = CONFIG_DIR / "work"                   # scratch dir for cpp/python ops

# ---------------------------------------------------------------------------
# Networking / relay
# ---------------------------------------------------------------------------
DEFAULT_RELAY_URL = os.environ.get(
    "OPENSONOMA_RELAY_URL", "wss://relay.tripplet.ai/ws"
)

# Loopback hosts where a plaintext ws:// relay is acceptable (local dev only).
_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}


def _hostname(url: str) -> str:
    try:
        from urllib.parse import urlparse

        host = urlparse(url).hostname or ""
    except Exception:  # noqa: BLE001
        return ""
    return host.lower()


def is_loopback_relay(url: str) -> bool:
    """True when *url*'s host is loopback (ws:// is acceptable there)."""
    host = _hostname(url)
    if host in _LOOPBACK_HOSTS:
        return True
    if host == "localhost" or host.endswith(".localhost"):
        return True
    if host.startswith("127."):
        return True
    return False


def relay_is_secure(url: str) -> bool:
    """True when the relay URL uses an encrypted transport (wss://)."""
    return url.lower().startswith("wss://")


def relay_transport_ok(url: str) -> bool:
    """Mirror the web client's policy: wss:// anywhere, ws:// only to loopback.

    A False result means the relay would send device credentials over an
    unencrypted link to a remote host. The daemon warns (rather than refusing)
    so an operator who terminates TLS elsewhere can still opt in, but the
    default managed relay is wss:// and satisfies this.
    """
    return relay_is_secure(url) or is_loopback_relay(url)

# ---------------------------------------------------------------------------
# Behaviour tuning
# ---------------------------------------------------------------------------
HEARTBEAT_INTERVAL = 20          # seconds between heartbeats to the relay
RECONNECT_BASE_DELAY = 1.0       # seconds, exponential backoff base
RECONNECT_MAX_DELAY = 30.0       # seconds, backoff ceiling
UNLOCK_TTL_SECONDS = 900         # how long an unlock window is recorded as valid
STATUS_WRITE_INTERVAL = 5        # seconds between status.json writes
RECENT_OPS_KEPT = 50             # number of recent ops kept in status.json
DEFAULT_OP_TIMEOUT = None        # None == no timeout (raw power, per spec)


def ensure_config_dir() -> None:
    """Create the config dir (and work dir) with private permissions."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(CONFIG_DIR, 0o700)
    except OSError:
        pass
