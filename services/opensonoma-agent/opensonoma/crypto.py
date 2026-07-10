"""Password hashing and identity helpers.

Password hashing uses scrypt from the standard library (hashlib) so there is no
third-party dependency for the security-critical path. The stored format is:

    scrypt$<n>$<r>$<p>$<salt_hex>$<hash_hex>

Only this hash is persisted (locally, chmod 600). The plaintext password is never
written to disk and never sent to the cloud in a stored form; the per-use prompt
forwards it once over the encrypted relay connection where the daemon verifies it
against this hash and then discards it.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid

# scrypt parameters. N must be a power of two. These give a strong, slow hash
# while staying well within hashlib's default maxmem on modern machines.
_SCRYPT_N = 2 ** 15  # 32768
_SCRYPT_R = 8
_SCRYPT_P = 1
_DKLEN = 32
_SALT_BYTES = 16
# scrypt memory use is ~ 128 * N * r * p bytes; bump maxmem so it never trips.
_MAXMEM = 128 * _SCRYPT_N * _SCRYPT_R * _SCRYPT_P * 2


def hash_password(password: str) -> str:
    """Return a self-describing scrypt hash string for *password*."""
    if not isinstance(password, str) or password == "":
        raise ValueError("password must be a non-empty string")
    salt = secrets.token_bytes(_SALT_BYTES)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_DKLEN,
        maxmem=_MAXMEM,
    )
    return "scrypt${}${}${}${}${}".format(
        _SCRYPT_N, _SCRYPT_R, _SCRYPT_P, salt.hex(), derived.hex()
    )


def verify_password(password: str, stored: str) -> bool:
    """Constant-time verification of *password* against a stored hash string."""
    if not password or not stored:
        return False
    try:
        scheme, n_s, r_s, p_s, salt_hex, hash_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        n, r, p = int(n_s), int(r_s), int(p_s)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except (ValueError, AttributeError):
        return False
    try:
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=n,
            r=r,
            p=p,
            dklen=len(expected),
            maxmem=128 * n * r * p * 2,
        )
    except (ValueError, MemoryError):
        return False
    return hmac.compare_digest(derived, expected)


def new_device_id() -> str:
    """A stable, globally-unique identifier for this machine install."""
    return str(uuid.uuid4())


def new_device_token() -> str:
    """A bearer token the device uses to authenticate to the relay."""
    return secrets.token_urlsafe(32)
