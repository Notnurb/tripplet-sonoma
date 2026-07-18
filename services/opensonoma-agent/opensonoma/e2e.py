"""End-to-end encryption for the OpenSonoma relay (device side).

This mirrors ``src/lib/connect/e2e.ts`` byte-for-byte, so a sealed box produced
by the Tripplet web client / a Sonoma session can be opened here — and vice
versa. The relay only ever forwards the opaque box; it never sees the per-use
password or command inside it.

Scheme (libsodium ``crypto_box_seal`` style hybrid encryption):

    1. sender makes an ephemeral X25519 keypair (epk, esk)
    2. shared = X25519(esk, recipient_pub)
    3. key    = HKDF-SHA256(ikm=shared, salt=epk||recipient_pub,
                            info=b"opensonoma-e2e-v1", length=32)
    4. iv     = 12 random bytes
    5. ct,tag = AES-256-GCM(key, iv, plaintext, aad)
    6. box    = {"v":1, "epk", "iv", "ct", "tag"}  (all base64)

Encryption is OPTIONAL. It needs the ``cryptography`` package (installed via the
``opensonoma[e2e]`` extra). When that import fails, ``HAVE_E2E`` is False and the
daemon transparently falls back to the password-over-TLS path. This module never
raises at import time.

Verify the cross-language contract on any machine with:

    python -m opensonoma.e2e        # runs selftest(): round-trip + TS vector
"""

from __future__ import annotations

import base64
import os
from typing import Dict, Optional, Tuple

# KDF/cipher parameters — MUST match e2e.ts.
HKDF_INFO = b"opensonoma-e2e-v1"
KEY_LEN = 32   # AES-256
IV_LEN = 12    # GCM standard nonce
TAG_LEN = 16   # GCM tag

try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric.x25519 import (
        X25519PrivateKey,
        X25519PublicKey,
    )
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    HAVE_E2E = True
except Exception:  # noqa: BLE001 - any import problem disables E2E cleanly
    HAVE_E2E = False


class E2EUnavailable(RuntimeError):
    """Raised when an E2E operation is attempted without ``cryptography``."""


def _require() -> None:
    if not HAVE_E2E:
        raise E2EUnavailable("the 'cryptography' package is not installed")


def _b64d(s: str) -> bytes:
    return base64.b64decode(s)


def _b64e(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def _raw_public(pub) -> bytes:
    return pub.public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )


def _raw_private(priv) -> bytes:
    return priv.private_bytes(
        serialization.Encoding.Raw,
        serialization.PrivateFormat.Raw,
        serialization.NoEncryption(),
    )


def generate_keypair() -> Tuple[str, str]:
    """Return ``(private_b64, public_b64)`` — raw 32-byte X25519 keys, base64."""
    _require()
    priv = X25519PrivateKey.generate()
    return _b64e(_raw_private(priv)), _b64e(_raw_public(priv.public_key()))


def public_for(private_b64: str) -> str:
    """Return the base64 raw public key for a stored raw private key."""
    _require()
    priv = X25519PrivateKey.from_private_bytes(_b64d(private_b64))
    return _b64e(_raw_public(priv.public_key()))


def _derive(shared: bytes, epk: bytes, recipient_pub: bytes) -> bytes:
    return HKDF(
        algorithm=hashes.SHA256(),
        length=KEY_LEN,
        salt=epk + recipient_pub,
        info=HKDF_INFO,
    ).derive(shared)


def seal(recipient_public_b64: str, plaintext, aad: Optional[bytes] = None) -> Dict[str, object]:
    """Seal *plaintext* to a recipient's raw X25519 public key (base64)."""
    _require()
    recipient_raw = _b64d(recipient_public_b64)
    recipient = X25519PublicKey.from_public_bytes(recipient_raw)

    eph = X25519PrivateKey.generate()
    epk = _raw_public(eph.public_key())
    shared = eph.exchange(recipient)
    key = _derive(shared, epk, recipient_raw)

    if isinstance(plaintext, str):
        plaintext = plaintext.encode("utf-8")
    iv = os.urandom(IV_LEN)
    sealed = AESGCM(key).encrypt(iv, plaintext, aad)  # ct || tag
    ct, tag = sealed[:-TAG_LEN], sealed[-TAG_LEN:]
    return {"v": 1, "epk": _b64e(epk), "iv": _b64e(iv), "ct": _b64e(ct), "tag": _b64e(tag)}


def open_box(private_b64: str, box: Dict[str, object], aad: Optional[bytes] = None) -> bytes:
    """Open a sealed *box* with a stored raw private key (base64).

    Raises on a malformed box, the wrong recipient key, or a failed
    authentication tag (tampered ciphertext / wrong AAD).
    """
    _require()
    if not isinstance(box, dict) or box.get("v") != 1:
        raise ValueError("malformed sealed box")
    for field in ("epk", "iv", "ct", "tag"):
        if not box.get(field):
            raise ValueError("malformed sealed box")

    priv = X25519PrivateKey.from_private_bytes(_b64d(private_b64))
    epk = _b64d(str(box["epk"]))
    shared = priv.exchange(X25519PublicKey.from_public_bytes(epk))
    key = _derive(shared, epk, _raw_public(priv.public_key()))

    ct_tag = _b64d(str(box["ct"])) + _b64d(str(box["tag"]))
    return AESGCM(key).decrypt(_b64d(str(box["iv"])), ct_tag, aad)


# Known-answer vector produced by src/lib/connect/e2e.ts (via `npx tsx`).
# Opening it here proves the Python and TypeScript constructions are byte
# compatible — do not edit these values by hand.
_KAT = {
    "recipient_private_b64": "mGjPaVD95jCK7j2d+FlUDJnKPRl+Of7LIqJ6vAPSo2w=",
    "aad_utf8": "device-abc:op-42",
    "plaintext": "correct horse battery staple",
    "box": {
        "v": 1,
        "epk": "WLM+MEgDhcy40+Wd1rw2Fl4iMYUZEi1BeGxF7q1zxCc=",
        "iv": "x+jy1gM6qnMM/t9d",
        "ct": "VpZGtjXKwuBWuyzMUO7v1z/jeQkRX/BHmgywww==",
        "tag": "cJrEXlIB1VYFvg2Lp3GFFw==",
    },
}


def selftest() -> int:
    """Round-trip a fresh box and decrypt the cross-language TS vector."""
    if not HAVE_E2E:
        print(
            "opensonoma.e2e: 'cryptography' not installed — E2E disabled "
            "(the relay transport is still TLS-encrypted)."
        )
        return 0

    priv_b64, pub_b64 = generate_keypair()
    box = seal(pub_b64, "ping", b"aad")
    assert open_box(priv_b64, box, b"aad") == b"ping", "python round-trip failed"

    got = open_box(_KAT["recipient_private_b64"], _KAT["box"], _KAT["aad_utf8"].encode())
    assert got.decode() == _KAT["plaintext"], "TS cross-language vector mismatch: %r" % got

    print("opensonoma.e2e self-test OK (Python round-trip + TypeScript vector).")
    return 0


if __name__ == "__main__":
    raise SystemExit(selftest())
