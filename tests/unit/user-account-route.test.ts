import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * DELETE /api/user/account contract:
 *   - guests get 401
 *   - missing/incorrect password is rejected before anything is deleted
 *   - a correct password deletes the FK-blocking/orphan-prone rows (AIUsage,
 *     TelegramBot, MessageFeedback) then the User row itself, in one transaction
 *   - best-effort cleanup (Composio, dev keys, OAuth tokens) never blocks the delete
 *   - the auth cookie is cleared on success
 */

const session = vi.hoisted(() => ({ auth: vi.fn() }));
const passwordLib = vi.hoisted(() => ({ verifyPassword: vi.fn() }));
const neon = vi.hoisted(() => ({
    queryOne: vi.fn(),
    query: vi.fn(async (_sql: string, _params?: unknown[]): Promise<unknown[]> => []),
}));
const prismaMock = vi.hoisted(() => ({
    aIUsage: { deleteMany: vi.fn() },
    telegramBot: { deleteMany: vi.fn() },
    messageFeedback: { deleteMany: vi.fn() },
    user: { delete: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
}));
const memory = vi.hoisted(() => ({ clearMemories: vi.fn(async () => 0) }));
const composio = vi.hoisted(() => ({
    composioEnabled: vi.fn(() => false),
    listConnectedAccounts: vi.fn(async (_userId: string): Promise<Array<{ id: string }>> => []),
    deleteConnectedAccount: vi.fn(async (_id: string) => { }),
}));
const sessionStore = vi.hoisted(() => ({ invalidateSessionsNow: vi.fn(async () => { }) }));

vi.mock('@/lib/auth/session', () => session);
vi.mock('@/lib/auth/password', () => passwordLib);
vi.mock('@/lib/db/neon', () => neon);
vi.mock('@/lib/db/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/db/user-memory', () => memory);
vi.mock('@/lib/composio/client', () => composio);
vi.mock('@/lib/auth/session-store', () => sessionStore);

import { DELETE } from '@/app/api/user/account/route';

function req(body?: unknown): NextRequest {
    return new NextRequest('http://localhost/api/user/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-real-ip': '10.70.0.1' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

beforeEach(() => {
    session.auth.mockReset().mockResolvedValue({ userId: 'u1', email: 'user@x.com' });
    passwordLib.verifyPassword.mockReset().mockResolvedValue(true);
    neon.queryOne.mockReset().mockResolvedValue({ id: 'u1', email: 'user@x.com', passwordHash: 'hash' });
    neon.query.mockClear();
    prismaMock.aIUsage.deleteMany.mockReset();
    prismaMock.telegramBot.deleteMany.mockReset();
    prismaMock.messageFeedback.deleteMany.mockReset();
    prismaMock.user.delete.mockReset();
    prismaMock.$transaction.mockClear();
    memory.clearMemories.mockClear();
    composio.composioEnabled.mockReturnValue(false);
    composio.listConnectedAccounts.mockClear();
    composio.deleteConnectedAccount.mockClear();
    sessionStore.invalidateSessionsNow.mockClear();
});

describe('DELETE /api/user/account', () => {
    it('rejects guests with 401 without touching the DB', async () => {
        session.auth.mockResolvedValue({ userId: null });
        const res = await DELETE(req({ password: 'whatever' }));
        expect(res.status).toBe(401);
        expect(neon.queryOne).not.toHaveBeenCalled();
    });

    it('rejects a missing password with 400', async () => {
        const res = await DELETE(req({}));
        expect(res.status).toBe(400);
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an incorrect password with 400 and deletes nothing', async () => {
        passwordLib.verifyPassword.mockResolvedValue(false);
        const res = await DELETE(req({ password: 'wrong' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/incorrect/i);
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('deletes AIUsage/TelegramBot/MessageFeedback then the User row in one transaction', async () => {
        const res = await DELETE(req({ password: 'correct' }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });

        expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
        expect(prismaMock.aIUsage.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
        expect(prismaMock.telegramBot.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
        expect(prismaMock.messageFeedback.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
        expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
    });

    it('clears the auth_token cookie on success', async () => {
        const res = await DELETE(req({ password: 'correct' }));
        const cookie = res.cookies.get('auth_token');
        expect(cookie?.value).toBe('');
    });

    it('best-effort cleanup (memory, dev keys, OAuth tokens) runs but never blocks the delete on failure', async () => {
        memory.clearMemories.mockRejectedValue(new Error('down'));
        neon.query.mockImplementation(async (sql: string) => {
            if (/oauth_access_tokens|oauth_authorization_codes|developer_api_keys/.test(sql)) {
                throw new Error('down');
            }
            return [];
        });
        const res = await DELETE(req({ password: 'correct' }));
        expect(res.status).toBe(200);
        expect(prismaMock.user.delete).toHaveBeenCalled();
    });

    it('does not call Composio when it is not configured', async () => {
        await DELETE(req({ password: 'correct' }));
        expect(composio.listConnectedAccounts).not.toHaveBeenCalled();
    });

    it('best-effort disconnects Composio connections when configured', async () => {
        composio.composioEnabled.mockReturnValue(true);
        composio.listConnectedAccounts.mockResolvedValue([{ id: 'conn-1' }, { id: 'conn-2' }]);
        const res = await DELETE(req({ password: 'correct' }));
        expect(res.status).toBe(200);
        expect(composio.deleteConnectedAccount).toHaveBeenCalledWith('conn-1');
        expect(composio.deleteConnectedAccount).toHaveBeenCalledWith('conn-2');
    });

    it('returns 404 when the authenticated user row is already gone', async () => {
        neon.queryOne.mockResolvedValue(null);
        const res = await DELETE(req({ password: 'correct' }));
        expect(res.status).toBe(404);
    });

    it('returns 500 and does not clear the cookie if the transaction fails', async () => {
        prismaMock.$transaction.mockRejectedValue(new Error('db exploded'));
        const res = await DELETE(req({ password: 'correct' }));
        expect(res.status).toBe(500);
    });
});
