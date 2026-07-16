import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * /api/composio/* route contracts:
 *   - guests get 401 (connectors are account-bound)
 *   - un-configured deploys get a clear 503 with code NOT_CONFIGURED
 *   - POST validates the app slug before it reaches an outbound URL
 *   - DELETE verifies ownership — foreign ids 404 without deleting
 */

const session = vi.hoisted(() => ({ auth: vi.fn() }));
const client = vi.hoisted(() => ({
    composioEnabled: vi.fn(() => true),
    listToolkits: vi.fn(),
    listConnectedAccounts: vi.fn(),
    getConnectedAccount: vi.fn(),
    deleteConnectedAccount: vi.fn(),
    initiateConnection: vi.fn(),
}));
const bridge = vi.hoisted(() => ({ invalidateComposioConnections: vi.fn() }));

vi.mock('@/lib/auth/session', () => session);
vi.mock('@/lib/composio/client', () => client);
vi.mock('@/lib/composio/tools', () => bridge);

import { GET as getApps } from '@/app/api/composio/apps/route';
import { GET as getConnections, POST as postConnection, DELETE as deleteConnection } from '@/app/api/composio/connections/route';

function req(path: string, init?: RequestInit): NextRequest {
    return new NextRequest(`http://localhost${path}`, init as ConstructorParameters<typeof NextRequest>[1]);
}

beforeEach(() => {
    session.auth.mockResolvedValue({ userId: 'u1' });
    client.composioEnabled.mockReturnValue(true);
    client.listToolkits.mockReset();
    client.listConnectedAccounts.mockReset();
    client.getConnectedAccount.mockReset();
    client.deleteConnectedAccount.mockReset();
    client.initiateConnection.mockReset();
    bridge.invalidateComposioConnections.mockReset();
});

describe('GET /api/composio/apps', () => {
    it('rejects guests with 401', async () => {
        session.auth.mockResolvedValue({ userId: null });
        const res = await getApps(req('/api/composio/apps'));
        expect(res.status).toBe(401);
        expect(client.listToolkits).not.toHaveBeenCalled();
    });

    it('returns 503 NOT_CONFIGURED without an API key', async () => {
        client.composioEnabled.mockReturnValue(false);
        const res = await getApps(req('/api/composio/apps'));
        expect(res.status).toBe(503);
        expect((await res.json()).code).toBe('NOT_CONFIGURED');
    });

    it('passes the search term through', async () => {
        client.listToolkits.mockResolvedValue([{ slug: 'github', name: 'GitHub' }]);
        const res = await getApps(req('/api/composio/apps?search=git'));
        expect(res.status).toBe(200);
        expect(client.listToolkits).toHaveBeenCalledWith('git');
        expect((await res.json()).apps).toHaveLength(1);
    });
});

describe('POST /api/composio/connections', () => {
    const post = (body: unknown) =>
        postConnection(
            req('/api/composio/connections', {
                method: 'POST',
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' },
            }),
        );

    it('rejects malformed app slugs before any outbound call', async () => {
        for (const app of ['../evil', 'a b', '', 'x'.repeat(65), 42]) {
            const res = await post({ app });
            expect(res.status).toBe(400);
        }
        expect(client.initiateConnection).not.toHaveBeenCalled();
    });

    it('initiates for the signed-in user with a settings callback', async () => {
        client.initiateConnection.mockResolvedValue({
            id: 'ca_9',
            redirectUrl: 'https://composio.example/consent',
            status: 'INITIATED',
        });
        const res = await post({ app: 'GitHub' });
        expect(res.status).toBe(200);
        const [userId, slug, callback] = client.initiateConnection.mock.calls[0];
        expect(userId).toBe('u1');
        expect(slug).toBe('github'); // normalized to lowercase
        expect(callback).toBe('http://localhost/settings?connector=done');
        expect((await res.json()).redirectUrl).toBe('https://composio.example/consent');
        expect(bridge.invalidateComposioConnections).toHaveBeenCalledWith('u1');
    });

    it('honors a same-origin returnTo path (chat composer flow)', async () => {
        client.initiateConnection.mockResolvedValue({ id: 'ca_9', redirectUrl: 'x', status: 'INITIATED' });
        await post({ app: 'github', returnTo: '/chat/abc123' });
        expect(client.initiateConnection.mock.calls[0][2]).toBe(
            'http://localhost/chat/abc123?connector=done',
        );
    });

    it('rejects open-redirect shaped returnTo values, falling back to /settings', async () => {
        client.initiateConnection.mockResolvedValue({ id: 'ca_9', redirectUrl: 'x', status: 'INITIATED' });
        for (const returnTo of [
            'https://evil.example/phish', // absolute URL
            '//evil.example/phish',       // protocol-relative authority
            '/chat?x=1',                  // embedded query
            '/chat#frag',                 // fragment
            `/${'a'.repeat(300)}`,        // oversized
            42,                           // wrong type
        ]) {
            client.initiateConnection.mockClear();
            await post({ app: 'github', returnTo });
            expect(client.initiateConnection.mock.calls[0][2]).toBe(
                'http://localhost/settings?connector=done',
            );
        }
    });
});

describe('DELETE /api/composio/connections', () => {
    it('404s on foreign connections without deleting (no id probing)', async () => {
        client.getConnectedAccount.mockResolvedValue({ id: 'ca_2', userId: 'someone-else' });
        const res = await deleteConnection(req('/api/composio/connections?id=ca_2', { method: 'DELETE' }));
        expect(res.status).toBe(404);
        expect(client.deleteConnectedAccount).not.toHaveBeenCalled();
    });

    it('deletes own connections and invalidates the tool cache', async () => {
        client.getConnectedAccount.mockResolvedValue({ id: 'ca_1', userId: 'u1' });
        const res = await deleteConnection(req('/api/composio/connections?id=ca_1', { method: 'DELETE' }));
        expect(res.status).toBe(200);
        expect(client.deleteConnectedAccount).toHaveBeenCalledWith('ca_1');
        expect(bridge.invalidateComposioConnections).toHaveBeenCalledWith('u1');
    });

    it('rejects malformed ids', async () => {
        const res = await deleteConnection(req('/api/composio/connections?id=%2e%2e%2Fetc', { method: 'DELETE' }));
        expect(res.status).toBe(400);
        expect(client.getConnectedAccount).not.toHaveBeenCalled();
    });
});

describe('GET /api/composio/connections', () => {
    it('returns the caller-safe projection (no Composio user ids)', async () => {
        client.listConnectedAccounts.mockResolvedValue([
            {
                id: 'ca_1',
                toolkitSlug: 'github',
                status: 'ACTIVE',
                statusReason: null,
                createdAt: '2026-01-01',
                isDisabled: false,
                userId: 'u1',
            },
        ]);
        const res = await getConnections(req('/api/composio/connections'));
        const body = await res.json();
        expect(body.connections).toEqual([
            {
                id: 'ca_1',
                app: 'github',
                status: 'ACTIVE',
                statusReason: null,
                createdAt: '2026-01-01',
                isDisabled: false,
            },
        ]);
        expect(JSON.stringify(body)).not.toContain('userId');
    });

    it('drops the cached tool scope so fresh connections reach the next chat request', async () => {
        client.listConnectedAccounts.mockResolvedValue([]);
        await getConnections(req('/api/composio/connections'));
        expect(bridge.invalidateComposioConnections).toHaveBeenCalledWith('u1');
    });
});
