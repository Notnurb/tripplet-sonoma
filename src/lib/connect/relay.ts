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

export interface RelayMachine {
    deviceId: string;
    machineName: string;
    status: string;
    lastSeenAt: string | null;
    online: boolean;
}

interface ClientSession {
    ws: WebSocket;
    close: () => void;
}

const REGISTER_TIMEOUT_MS = 8_000;

// Open a short-lived authenticated "client" session against the relay. The
// caller gets the socket once register_ack arrives (or a rejection reason).
function openClientSession(opts: {
    accountId: string;
    authJwt?: string;
}): Promise<{ ok: true; session: ClientSession; machines: RelayMachine[] } | { ok: false; error: string }> {
    return new Promise((resolve) => {
        let relayUrl: string;
        try {
            relayUrl = resolveRelayUrl().url;
        } catch (err) {
            resolve({ ok: false, error: err instanceof Error ? err.message : 'Relay misconfigured.' });
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
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try {
                ws.close();
            } catch {
                /* ignore */
            }
            resolve({ ok: false, error: 'The relay did not respond in time.' });
        }, REGISTER_TIMEOUT_MS);

        const sessionId = randomUUID();
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
            if (settled) return;
            let msg: RelayMessage & { machines?: Array<Record<string, unknown>> };
            try {
                const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
                msg = JSON.parse(raw);
            } catch {
                return;
            }
            if (msg.type === 'register_ack') {
                settled = true;
                clearTimeout(timer);
                if (msg.ok === false) {
                    resolve({ ok: false, error: msg.error || 'The relay rejected the session.' });
                    try {
                        ws.close();
                    } catch {
                        /* ignore */
                    }
                    return;
                }
                const machines = (msg.machines || []).map((m) => ({
                    deviceId: String(m.device_id ?? ''),
                    machineName: String(m.machine_name ?? ''),
                    status: String(m.status ?? 'offline'),
                    lastSeenAt: (m.last_seen_at as string) ?? null,
                    online: m.status === 'online',
                }));
                resolve({
                    ok: true,
                    session: { ws, close: () => ws.close() },
                    machines,
                });
            }
        });

        ws.addEventListener('error', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ ok: false, error: 'Could not connect to the Tripplet relay.' });
        });
    });
}

/** List the paired machines for this account. */
export async function relayListMachines(opts: {
    accountId: string;
    authJwt?: string;
}): Promise<{ ok: boolean; machines: RelayMachine[]; error?: string }> {
    const r = await openClientSession(opts);
    if (!r.ok) return { ok: false, machines: [], error: r.error };
    r.session.close();
    return { ok: true, machines: r.machines };
}

/** Unbind a device from this account (does not touch the device itself). */
export function relayUnpair(opts: {
    accountId: string;
    authJwt?: string;
    deviceId: string;
}): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
        openClientSession(opts).then((r) => {
            if (!r.ok) {
                resolve({ ok: false, error: r.error });
                return;
            }
            const { ws, close } = r.session;
            const reqId = randomUUID();
            const timer = setTimeout(() => {
                close();
                resolve({ ok: false, error: 'The relay did not respond in time.' });
            }, PAIR_TIMEOUT_MS);
            ws.addEventListener('message', (ev: MessageEvent) => {
                let msg: RelayMessage;
                try {
                    const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
                    msg = JSON.parse(raw);
                } catch {
                    return;
                }
                if (msg.type === 'unpair_result' && (msg as { id?: string }).id === reqId) {
                    clearTimeout(timer);
                    close();
                    resolve({ ok: !!msg.ok, error: msg.ok ? undefined : msg.error });
                }
            });
            ws.send(
                JSON.stringify({
                    type: 'unpair',
                    id: reqId,
                    account_id: opts.accountId,
                    device_id: opts.deviceId,
                }),
            );
        });
    });
}

export interface ExecStreamEvent {
    stream: 'stdout' | 'stderr';
    data: string;
}

export interface ExecResult {
    ok: boolean;
    exitCode: number | null;
    error?: string;
}

const EXEC_TIMEOUT_MS = 120_000;

/** Run a shell command on a paired device and stream its output. */
export function relayExec(opts: {
    accountId: string;
    authJwt?: string;
    deviceId: string;
    command: string;
    password: string;
    onStream?: (ev: ExecStreamEvent) => void;
}): Promise<ExecResult> {
    return new Promise((resolve) => {
        openClientSession(opts).then((r) => {
            if (!r.ok) {
                resolve({ ok: false, exitCode: null, error: r.error });
                return;
            }
            const { ws, close } = r.session;
            const opId = randomUUID();
            const sessionId = randomUUID();

            const timer = setTimeout(() => {
                close();
                resolve({ ok: false, exitCode: null, error: 'The device did not respond in time.' });
            }, EXEC_TIMEOUT_MS);

            ws.addEventListener('message', (ev: MessageEvent) => {
                let msg: RelayMessage & { stream?: string; data?: string; exit_code?: number };
                try {
                    const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
                    msg = JSON.parse(raw);
                } catch {
                    return;
                }
                if (msg.type === 'stream' && (msg.stream === 'stdout' || msg.stream === 'stderr')) {
                    opts.onStream?.({ stream: msg.stream, data: msg.data || '' });
                } else if (msg.type === 'result') {
                    clearTimeout(timer);
                    close();
                    resolve({
                        ok: !!msg.ok,
                        exitCode: typeof msg.exit_code === 'number' ? msg.exit_code : null,
                        error: msg.ok ? undefined : msg.error,
                    });
                } else if (msg.type === 'error') {
                    clearTimeout(timer);
                    close();
                    resolve({ ok: false, exitCode: null, error: msg.message || 'Device error.' });
                }
            });

            ws.send(
                JSON.stringify({
                    type: 'exec',
                    id: opId,
                    device_id: opts.deviceId,
                    session_id: sessionId,
                    auth: { password: opts.password },
                    op: { kind: 'bash', command: opts.command },
                }),
            );
        });
    });
}
