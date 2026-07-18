"""Persistent device configuration and secrets.

Two files live in the config dir:

  * config.json  — non-secret state (device id, machine name, pairing code,
                   relay url, paired flag, account id). World-unreadable but not
                   security-critical.
  * secret.json  — the scrypt password hash and the device token. chmod 600.

Both are small JSON documents loaded/saved atomically.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

from . import constants
from . import crypto


def _atomic_write(path: Path, data: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(data)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


def now_ts() -> float:
    return time.time()


@dataclass
class Config:
    """Non-secret device configuration (config.json)."""

    device_id: str = ""
    machine_name: str = ""
    pairing_code: str = ""
    relay_url: str = constants.DEFAULT_RELAY_URL
    paired: bool = False
    account_id: Optional[str] = None
    version: str = constants.VERSION
    created_at: float = field(default_factory=now_ts)
    updated_at: float = field(default_factory=now_ts)

    # -- persistence ---------------------------------------------------------
    @classmethod
    def path(cls) -> Path:
        return constants.CONFIG_FILE

    @classmethod
    def exists(cls) -> bool:
        return constants.CONFIG_FILE.exists()

    @classmethod
    def load(cls) -> "Config":
        if not constants.CONFIG_FILE.exists():
            return cls()
        try:
            data = json.loads(constants.CONFIG_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            return cls()
        known = {f for f in cls.__dataclass_fields__}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in data.items() if k in known})

    def save(self) -> None:
        constants.ensure_config_dir()
        self.updated_at = now_ts()
        _atomic_write(constants.CONFIG_FILE, json.dumps(asdict(self), indent=2), 0o600)


@dataclass
class Secret:
    """Security-critical material (secret.json, chmod 600)."""

    password_hash: str = ""
    device_token: str = ""
    # Raw 32-byte X25519 private key (base64) for end-to-end decryption of the
    # per-use password. Empty when the optional `cryptography` dep is absent.
    e2e_privkey: str = ""

    @classmethod
    def exists(cls) -> bool:
        return constants.SECRET_FILE.exists()

    @classmethod
    def load(cls) -> "Secret":
        if not constants.SECRET_FILE.exists():
            return cls()
        try:
            data = json.loads(constants.SECRET_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            return cls()
        known = {f for f in cls.__dataclass_fields__}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in data.items() if k in known})

    def save(self) -> None:
        constants.ensure_config_dir()
        _atomic_write(constants.SECRET_FILE, json.dumps(asdict(self), indent=2), 0o600)

    # -- convenience ---------------------------------------------------------
    def set_password(self, plaintext: str) -> None:
        self.password_hash = crypto.hash_password(plaintext)

    def verify(self, plaintext: str) -> bool:
        return crypto.verify_password(plaintext, self.password_hash)

    def ensure_device_token(self) -> str:
        if not self.device_token:
            self.device_token = crypto.new_device_token()
        return self.device_token

    def ensure_e2e_key(self) -> str:
        """Ensure an X25519 keypair exists; return the base64 public key.

        Returns "" when end-to-end encryption is unavailable (the optional
        `cryptography` dependency is not installed). Never raises — E2E is a
        best-effort hardening on top of the always-on TLS transport.
        """
        from . import e2e  # lazy: keeps config importable without cryptography

        if not e2e.HAVE_E2E:
            return ""
        try:
            if not self.e2e_privkey:
                priv_b64, _pub_b64 = e2e.generate_keypair()
                self.e2e_privkey = priv_b64
            return e2e.public_for(self.e2e_privkey)
        except Exception:  # noqa: BLE001 - never let key setup break registration
            return ""


def is_first_run() -> bool:
    """True when no usable configuration exists yet."""
    if not Config.exists() or not Secret.exists():
        return True
    cfg = Config.load()
    sec = Secret.load()
    return not (cfg.device_id and sec.password_hash)
