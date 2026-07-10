// Pairing-code + verification-emoji helpers for the OpenSonoma "Connect" flow.
//
// This is the TypeScript mirror of ~/OS/opensonoma/pairing.py. The pairing code
// format (XXX-XXX over an unambiguous alphabet) and the emoji derivation MUST
// stay byte-for-byte compatible with the Python daemon, because the daemon shows
// the verification emoji on its own screen and the web must compute the same one
// to validate the user's pick.
//
// Keep three implementations in sync:
//   * ~/OS/opensonoma/pairing.py   (daemon — shows the emoji)
//   * this file                    (web    — validates the picked emoji)

// Letters + numbers with ambiguous glyphs (0/O, 1/I/L) removed — matches
// PAIRING_ALPHABET in pairing.py so a code read off a screen always parses.
const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUP_LEN = 3;
const GROUPS = 2;
const CODE_LEN = GROUP_LEN * GROUPS; // 6

// Verification emoji pool. Single, visually-distinct glyphs that render in a
// terminal. MUST be identical (same order) to EMOJI_POOL in pairing.py.
export const EMOJI_POOL = [
    '🦊', '🐼', '🐙', '🦉', '🐢', '🦁',
    '🐸', '🦄', '🐝', '🐬', '🦋', '🐧',
] as const;

/** Upper-case, strip non-alphanumerics, and re-insert the hyphen (XXX-XXX). */
export function normalizeCode(value: string): string {
    if (!value) return '';
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned.length === CODE_LEN) {
        return `${cleaned.slice(0, GROUP_LEN)}-${cleaned.slice(GROUP_LEN)}`;
    }
    return cleaned;
}

/** The code without its hyphen — the exact string both sides hash. */
function bareCode(value: string): string {
    return normalizeCode(value).replace('-', '');
}

/** True when `value` normalizes to a well-formed code from the alphabet. */
export function isValidCode(value: string): boolean {
    const bare = bareCode(value);
    if (bare.length !== CODE_LEN) return false;
    return [...bare].every((ch) => PAIRING_ALPHABET.includes(ch));
}

// FNV-1a (32-bit). Mirrors _fnv1a in pairing.py — same constants, same masking.
function fnv1a(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/** The single correct verification emoji for `code` (what the daemon shows). */
export function pairingEmoji(code: string): string {
    return EMOJI_POOL[fnv1a(bareCode(code)) % EMOJI_POOL.length];
}

/**
 * Deterministic set of `n` emoji choices for the web to display — always the
 * correct one plus distinct decoys, returned in a stable shuffled order so the
 * answer position isn't predictable but is reproducible for a given code.
 */
export function pairingEmojiChoices(code: string, n = 5): string[] {
    const count = Math.min(n, EMOJI_POOL.length);
    const h = fnv1a(bareCode(code));
    const idxs = [h % EMOJI_POOL.length];

    // Small LCG seeded from the hash → deterministic decoy pick + shuffle.
    let seed = h || 1;
    const rand = () => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        return seed / 0x100000000;
    };

    while (idxs.length < count) {
        const k = Math.floor(rand() * EMOJI_POOL.length);
        if (!idxs.includes(k)) idxs.push(k);
    }
    for (let i = idxs.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    return idxs.map((i) => EMOJI_POOL[i]);
}
