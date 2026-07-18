// Single source of truth for the OpenSonoma relay URL used by the web client.
//
// Resolves the relay endpoint from configuration and — critically — ENFORCES
// transport encryption: a relay reachable over the public internet MUST use
// `wss://` (WebSocket-over-TLS). Plaintext `ws://` is only tolerated for a
// loopback address during local development, where nothing leaves the machine.
//
// The daemon mirrors this policy in `opensonoma/constants.py` (resolve_relay_url)
// so both ends of the relay agree on the same URL and the same "must be
// encrypted" rule. Keep the two in sync.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

/** True when `host` is a loopback/localhost address (plaintext ws:// is OK). */
export function isLoopbackHost(host: string): boolean {
    const h = host.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
    if (LOOPBACK_HOSTS.has(h)) return true;
    // `*.localhost` always resolves to loopback per the RFC 6761 reserved TLD.
    if (h === 'localhost' || h.endsWith('.localhost')) return true;
    // 127.0.0.0/8 is entirely loopback.
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
    return false;
}

export interface ResolvedRelay {
    /** The validated relay URL to connect to. */
    url: string;
    /** True when the transport is encrypted (wss://). */
    secure: boolean;
    /** True when the host is loopback (the only case ws:// is allowed). */
    loopback: boolean;
}

/**
 * The default relay URL when `OPENSONOMA_RELAY_URL` is not set. Production
 * defaults to the managed TLS relay; anything else defaults to a local relay on
 * loopback so `npm run opensonoma:relay` + `/connect` works out of the box.
 */
export function defaultRelayUrl(): string {
    const configured = process.env.OPENSONOMA_RELAY_URL?.trim();
    if (configured) return configured;
    return process.env.NODE_ENV === 'production'
        ? 'wss://relay.tripplet.ai/ws'
        : 'ws://127.0.0.1:8080/ws';
}

/**
 * Validate and resolve a relay URL, enforcing the transport-encryption policy.
 * Throws a descriptive Error if the URL is malformed, uses a non-ws scheme, or
 * would send traffic to a remote host without TLS.
 */
export function resolveRelayUrl(raw?: string): ResolvedRelay {
    const url = (raw ?? defaultRelayUrl()).trim();

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`Invalid OpenSonoma relay URL: ${JSON.stringify(url)}`);
    }

    const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
    if (scheme !== 'ws' && scheme !== 'wss') {
        throw new Error(
            `Relay URL must use ws:// or wss:// (got "${parsed.protocol}//" in ${url}).`,
        );
    }

    const loopback = isLoopbackHost(parsed.hostname);
    const secure = scheme === 'wss';

    if (!secure && !loopback) {
        throw new Error(
            `Refusing to use an unencrypted relay at ${url}. ` +
                'Use wss:// for any non-localhost relay so the session token and ' +
                'pairing traffic are encrypted in transit.',
        );
    }

    return { url, secure, loopback };
}
