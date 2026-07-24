// Integration coverage for the OpenSonoma relay pairing round-trip.
//
// This spawns the REAL relay process (services/opensonoma-agent/relay/server.js),
// registers a fake device against it, and pairs using the app's REAL
// relayPair() client. It exists because the relay was broken in ways the
// pure-unit tests could not see:
//   - the relay crashed on boot when @supabase/supabase-js was not installed,
//     even though it has a complete in-memory fallback;
//   - nothing exercised register -> pair -> pair_result across a live socket.

import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';

import { relayPair } from '@/lib/connect/relay';

// Uses Node's global WHATWG WebSocket — the same client relay.ts itself relies
// on — so the test needs no extra dependency to talk to the relay.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RELAY_ENTRY = 'services/opensonoma-agent/relay/server.js';

const SECRET = 'relay-pairing-test-secret-0123456789';
const USER_ID = 'user_pairing_test';
const OTHER_USER_ID = 'user_someone_else';
const DEVICE_ID = 'dev-pairing-test-1';
const CODE = 'A7K-3FQ';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const addr = srv.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            srv.close(() => resolve(port));
        });
    });
}

/** Boot the relay and resolve once it reports it is listening. */
function startRelay(port: number, env: Record<string, string> = {}): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [RELAY_ENTRY], {
            cwd: REPO_ROOT,
            env: { ...process.env, PORT: String(port), ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        const timer = setTimeout(
            () => reject(new Error(`relay did not start in time; output:\n${out}`)),
            15_000,
        );
        proc.stdout!.on('data', (d) => {
            out += String(d);
            if (out.includes('listening on')) {
                clearTimeout(timer);
                resolve(proc);
            }
        });
        proc.stderr!.on('data', (d) => {
            out += String(d);
        });
        proc.on('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`relay exited early (code ${code}); output:\n${out}`));
        });
    });
}

/** Connect a fake OpenSonoma device and register it with a pairing code. */
async function connectDevice(port: number, overrides: Record<string, unknown> = {}) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const frames: Record<string, unknown>[] = [];
    await new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve());
        ws.addEventListener('error', () => reject(new Error('device socket failed')));
    });
    ws.addEventListener('message', (ev) => frames.push(JSON.parse(String(ev.data))));
    ws.send(
        JSON.stringify({
            type: 'register',
            role: 'device',
            device_id: DEVICE_ID,
            device_token: 'tok-secret',
            machine_name: 'Test MacBook',
            pairing_code: CODE,
            e2e_pubkey: 'BASE64PUBKEY==',
            ...overrides,
        }),
    );
    await sleep(300);
    return { ws, frames };
}

function mintJwt(userId: string, secret = SECRET) {
    return new SignJWT({ userId, email: 'tester@example.com' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('7d')
        .sign(new TextEncoder().encode(secret));
}

let relay: ChildProcess | null = null;
let sockets: WebSocket[] = [];
const originalRelayUrl = process.env.OPENSONOMA_RELAY_URL;

afterEach(async () => {
    for (const s of sockets) {
        try {
            s.close();
        } catch {
            /* ignore */
        }
    }
    sockets = [];
    if (relay) {
        relay.removeAllListeners('exit');
        relay.kill('SIGKILL');
        relay = null;
    }
    if (originalRelayUrl === undefined) delete process.env.OPENSONOMA_RELAY_URL;
    else process.env.OPENSONOMA_RELAY_URL = originalRelayUrl;
    await sleep(100);
});

describe('OpenSonoma relay pairing', () => {
    it('boots with no Supabase configured and serves /health', async () => {
        const port = await freePort();
        relay = await startRelay(port);

        const res = await fetch(`http://127.0.0.1:${port}/health`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.ok).toBe(true);
        expect(body.service).toBe('opensonoma-relay');
        expect(body.mode).toBe('memory');
    }, 30_000);

    it('pairs a device to the caller identified by their Tripplet JWT', async () => {
        const port = await freePort();
        relay = await startRelay(port, { TRIPPLET_JWT_SECRET: SECRET });
        process.env.OPENSONOMA_RELAY_URL = `ws://127.0.0.1:${port}/ws`;

        const { ws, frames } = await connectDevice(port);
        sockets.push(ws);
        expect(frames[0]).toMatchObject({ type: 'register_ack', ok: true });

        const result = await relayPair({
            accountId: USER_ID,
            authJwt: await mintJwt(USER_ID),
            code: CODE,
        });

        expect(result.ok).toBe(true);
        expect(result.deviceId).toBe(DEVICE_ID);
        expect(result.machineName).toBe('Test MacBook');
        expect(result.online).toBe(true);

        // The device must be told it is now bound to that account.
        await sleep(200);
        expect(frames.some((f) => f.type === 'paired' && f.account_id === USER_ID)).toBe(true);
    }, 30_000);

    it('rejects a client whose JWT is signed with the wrong secret', async () => {
        const port = await freePort();
        relay = await startRelay(port, { TRIPPLET_JWT_SECRET: SECRET });
        process.env.OPENSONOMA_RELAY_URL = `ws://127.0.0.1:${port}/ws`;

        const { ws } = await connectDevice(port);
        sockets.push(ws);

        const result = await relayPair({
            accountId: USER_ID,
            authJwt: await mintJwt(USER_ID, 'a-completely-different-secret-value'),
            code: CODE,
        });

        expect(result.ok).toBe(false);
        expect(result.deviceId).toBeUndefined();
    }, 30_000);

    it('does not pair when the code matches no registered machine', async () => {
        const port = await freePort();
        relay = await startRelay(port, { TRIPPLET_JWT_SECRET: SECRET });
        process.env.OPENSONOMA_RELAY_URL = `ws://127.0.0.1:${port}/ws`;

        const { ws } = await connectDevice(port);
        sockets.push(ws);

        const result = await relayPair({
            accountId: USER_ID,
            authJwt: await mintJwt(USER_ID),
            code: 'ZZZ-999',
        });

        expect(result.ok).toBe(false);
    }, 30_000);

    it('refuses to send pairing traffic to a plaintext remote relay', async () => {
        process.env.OPENSONOMA_RELAY_URL = 'ws://relay.example.com/ws';
        const result = await relayPair({
            accountId: USER_ID,
            authJwt: await mintJwt(USER_ID),
            code: CODE,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/unencrypted/i);
    }, 30_000);

    it('will not let one account drive another account\'s device', async () => {
        const port = await freePort();
        relay = await startRelay(port, { TRIPPLET_JWT_SECRET: SECRET });
        process.env.OPENSONOMA_RELAY_URL = `ws://127.0.0.1:${port}/ws`;

        const { ws } = await connectDevice(port);
        sockets.push(ws);

        // Owner pairs the device.
        const owned = await relayPair({
            accountId: USER_ID,
            authJwt: await mintJwt(USER_ID),
            code: CODE,
        });
        expect(owned.ok).toBe(true);

        // A different account connects and tries to exec on it.
        const intruder = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        sockets.push(intruder);
        const seen: Record<string, unknown>[] = [];
        await new Promise<void>((resolve, reject) => {
            intruder.addEventListener('open', () => resolve());
            intruder.addEventListener('error', () => reject(new Error('intruder socket failed')));
        });
        intruder.addEventListener('message', (ev) => seen.push(JSON.parse(String(ev.data))));
        intruder.send(
            JSON.stringify({
                type: 'register',
                role: 'client',
                account_id: OTHER_USER_ID,
                session_id: 'sess-intruder',
                auth_jwt: await mintJwt(OTHER_USER_ID),
            }),
        );
        await sleep(300);
        intruder.send(
            JSON.stringify({ type: 'exec', id: 'op-1', device_id: DEVICE_ID, op: { cmd: 'id' } }),
        );
        await sleep(300);

        expect(seen.some((f) => f.type === 'error' && /not authorized/i.test(String(f.message)))).toBe(
            true,
        );
    }, 30_000);
});
