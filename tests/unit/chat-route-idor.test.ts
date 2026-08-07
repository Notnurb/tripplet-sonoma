// Regression test for a real cross-tenant IDOR: the conversation-upsert and
// user-message-insert used to run as two INDEPENDENT autocommitted statements
// (Promise.all gives no shared transaction). Supplying another user's
// conversationId made the conversation-upsert reject on a PRIMARY KEY
// collision while the message-insert still committed — silently injecting an
// attacker-authored message into a victim's conversation even though the
// request as a whole errored out. Fixed in src/app/api/chat/route.ts by (1)
// explicitly rejecting ids that exist for a DIFFERENT user before any write,
// and (2) wrapping both writes in one real DB transaction (withTransaction).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { queryOne, query, withTransaction } = vi.hoisted(() => ({
    queryOne: vi.fn(),
    query: vi.fn(),
    withTransaction: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
    auth: vi.fn(async () => ({ userId: 'attacker-user-id' })),
}));
vi.mock('@/lib/db/neon', () => ({ queryOne, query, withTransaction }));

import { POST } from '@/app/api/chat/route';

let ipCounter = 0;
function post(body: unknown): NextRequest {
    ipCounter += 1;
    return new NextRequest('http://localhost/api/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-real-ip': `10.98.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
        },
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    queryOne.mockReset();
    query.mockReset();
    withTransaction.mockReset();
});

describe('POST /api/chat — conversation IDOR guard', () => {
    it('rejects with 403 and performs NO write when conversationId belongs to another user', async () => {
        // First lookup (scoped to attacker's userId) finds nothing — not theirs.
        queryOne.mockResolvedValueOnce(null);
        // Second lookup (unscoped existence check) finds it — belongs to someone else.
        queryOne.mockResolvedValueOnce({ id: 'victim-conversation-id' });

        const res = await POST(post({
            messages: [{ role: 'user', content: 'attacker-controlled message' }],
            model: 'taipei4',
            conversationId: '11111111-1111-4111-8111-111111111111',
        }));

        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toMatch(/does not belong to you/i);

        // The decisive assertion: no transaction — and therefore no message
        // insert — was ever attempted against the victim's conversation.
        expect(withTransaction).not.toHaveBeenCalled();
    });

    it('creates a new conversation via withTransaction when the id does not exist for anyone', async () => {
        queryOne.mockResolvedValueOnce(null); // not owned by this user
        queryOne.mockResolvedValueOnce(null); // does not exist for anyone either
        withTransaction.mockImplementation(async (fn) => fn({ query: vi.fn(), queryOne: vi.fn() }));

        // Stub the LLM stream so the request completes without real network.
        vi.doMock('@/lib/ai/chat-client', () => ({
            streamChatEvents: async function* () { /* empty stream */ },
        }));

        await POST(post({
            messages: [{ role: 'user', content: 'hello' }],
            model: 'taipei4',
            conversationId: '22222222-2222-4222-8222-222222222222',
        }));

        expect(withTransaction).toHaveBeenCalledTimes(1);
    });
});
