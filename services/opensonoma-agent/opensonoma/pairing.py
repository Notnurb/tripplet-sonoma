"""Pairing-code generation and validation.

Format is ``XXX-XXX`` (six characters from an unambiguous letters+numbers
alphabet, grouped 3-3 with a hyphen). The alphabet omits easily-confused
characters (0/O, 1/I/L) so the user can read the code off a screen reliably.

This module also derives a single *verification emoji* from the code. The
daemon prints that emoji on screen next to the code; the Tripplet web pairing
flow shows five emoji and asks the user to pick the matching one before the
machine is bound. Because the emoji is derived deterministically from the code,
both sides agree without any extra round-trip. The web mirror of this logic is
``src/lib/connect/pairing.ts`` in the Sonomachat app — keep them in sync.
"""

from __future__ import annotations

import secrets

# Letters + numbers, ambiguous glyphs removed.
PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
GROUP_LEN = 3
GROUPS = 2

# Verification emoji pool. Single, visually-distinct glyphs that render in a
# terminal. MUST be identical (same order) to EMOJI_POOL in pairing.ts.
EMOJI_POOL = [
    "🦊", "🐼", "🐙", "🦉", "🐢", "🦁",
    "🐸", "🦄", "🐝", "🐬", "🦋", "🐧",
]


def generate_pairing_code() -> str:
    """Return a fresh code like ``A7K-3FQ``."""
    chars = [secrets.choice(PAIRING_ALPHABET) for _ in range(GROUP_LEN * GROUPS)]
    groups = [
        "".join(chars[i : i + GROUP_LEN])
        for i in range(0, GROUP_LEN * GROUPS, GROUP_LEN)
    ]
    return "-".join(groups)


def normalize_pairing_code(value: str) -> str:
    """Upper-case, strip spaces, and re-insert the hyphen.

    Accepts user input that may be lower-case, spaced, or missing the hyphen.
    """
    if not value:
        return ""
    cleaned = "".join(ch for ch in value.upper() if ch.isalnum())
    if len(cleaned) == GROUP_LEN * GROUPS:
        return "-".join(
            cleaned[i : i + GROUP_LEN]
            for i in range(0, GROUP_LEN * GROUPS, GROUP_LEN)
        )
    return cleaned


def is_valid_pairing_code(value: str) -> bool:
    """True if *value* normalizes to a well-formed code from the alphabet."""
    code = normalize_pairing_code(value)
    parts = code.split("-")
    if len(parts) != GROUPS:
        return False
    if any(len(p) != GROUP_LEN for p in parts):
        return False
    return all(ch in PAIRING_ALPHABET for ch in code if ch != "-")


def _fnv1a(s: str) -> int:
    """FNV-1a 32-bit hash. Mirrors fnv1a() in pairing.ts exactly."""
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def pairing_emoji(value: str) -> str:
    """The single verification emoji for *value* (what we show on screen).

    Derived from the hyphen-free, normalized code so the daemon and the web
    pairing UI always agree on the right emoji.
    """
    bare = normalize_pairing_code(value).replace("-", "")
    return EMOJI_POOL[_fnv1a(bare) % len(EMOJI_POOL)]
