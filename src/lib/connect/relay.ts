// Thin client for the OpenSonoma relay (services/opensonoma-agent/relay/server.js).
//
// The relay is a WebSocket forwarder between Sonoma sessions (role "client")
// and paired machines (role "device"). To pair, we connect as a client,
// `register`, then send a `pair` frame with the code and await `pair_result`.
// The wire protocol is defined in opensonoma/protocol.py.
//
// Node (v20.10+, and the v24 runtime here) ships a global WHATWG `WebSocket`,
// so no extra dependency is needed.
//
// TRANSPORT ENCRYPTION: the relay URL is resolved through `resolveRelayUrl`,
// which refuses a plaintext ws:// endpoint on any non-loopback host — so the
// session token and pairing traffic are always TLS-encrypted (wss://) in
// production. See src/lib/connect/relay-url.ts.
//
// AUTH: `/api/connect/verify` forwards the user's real Tripplet session JWT as
// `auth_jwt`. When the relay is configured with `TRIPPLET_JWT_SECRET` (= the
// app's JWT_SECRET) it verifies that token (HS256) and binds only the caller's
// own devices. With neither that secret nor Supabase configured, the relay runs
// in dev-trust memory mode (local pairing only).

import { randomUUID } from 'crypto';
import { resolveRelayUrl } from './relay-url';

const PAIR_TIMEOUT_MS = 10_000;

export interface PairResult {
    ok: boolean;
    deviceId?: string;
    machineName?: string;
    online?: boolean;
    error?: string;
}

interface RelayMessage {
    type?: string;
    ok?: boolean;
    error?: string;
    device_id?: string;
    machine_name?: string;
    online?: boolean;
    message?: string;
}

/** Pair the given account with the machine advertising `code`. */
export function relayPair(opts: {
    accountId: string;
    authJwt?: string;
    code: string;
    machineName?: string;
}): Promise<PairResult> {
    return new Promise((resolve) => {
        let relayUrl: string;
        try {
            relayUrl = resolveRelayUrl().url;
        } catch (err) {
            // Misconfiguration (e.g. a plaintext ws:// relay in production) —
            // fail closed rather than send the session token in the clear.
            resolve({
                ok: false,
                error: err instanceof Error ? err.message : 'The relay is not configured correctly.',
            });
            return;
        }

        let ws: WebSocket;
        try {
            ws = new WebSocket(relayUrl);
        } catch {
            resolve({ ok: false, error: 'Could not reach the Tripplet relay.' });
            return;
        }

        let settled = false;
        const finish = (result: PairResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                ws.close();
            } catch {
                /* ignore */
            }
            resolve(result);
        };

        const timer = setTimeout(
            () => finish({ ok: false, error: 'The relay did not respond in time.' }),
            PAIR_TIMEOUT_MS,
        );

        const sessionId = randomUUID();
        const pairId = randomUUID();

        ws.addEventListener('open', () => {
            ws.send(
                JSON.stringify({
                    type: 'register',
                    role: 'client',
                    account_id: opts.accountId,
                    session_id: sessionId,
                    auth_jwt: opts.authJwt,
                }),
            );
        });

        ws.addEventListener('message', (ev: MessageEvent) => {
            let msg: RelayMessage;
            try {
                const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
                msg = JSON.parse(raw) as RelayMessage;
            } catch {
                return;
            }

            if (msg.type === 'register_ack') {
                if (msg.ok === false) {
                    finish({ ok: false, error: msg.error || 'The relay rejected the session.' });
                    return;
                }
                ws.send(
                    JSON.stringify({
                        type: 'pair',
                        id: pairId,
                        account_id: opts.accountId,
                        pairing_code: opts.code,
                        machine_name: opts.machineName,
                    }),
                );
            } else if (msg.type === 'pair_result') {
                finish({
                    ok: !!msg.ok,
                    deviceId: msg.device_id,
                    machineName: msg.machine_name,
                    online: msg.online,
                    error: msg.ok ? undefined : msg.error || 'No machine is advertising that code.',
                });
            } else if (msg.type === 'error') {
                finish({ ok: false, error: msg.message || 'The relay returned an error.' });
            }
        });

        ws.addEventListener('error', () =>
            finish({ ok: false, error: 'Could not connect to the Tripplet relay.' }),
        );
        ws.addEventListener('close', () =>
            finish({ ok: false, error: 'The relay connection closed before pairing finished.' }),
        );
    });
}
