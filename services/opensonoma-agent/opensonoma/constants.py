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
