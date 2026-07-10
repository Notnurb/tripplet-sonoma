// @vitest-environment jsdom
//
// Direct tests for the conversation domain hook — especially the guest→signed-in
// merge/dedup logic that runs on login (recovering localStorage guest chats into
// the server-loaded list without duplicating shared ids). This state-machine
// code was previously only exercised transitively; here it is tested in isolation.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';

// Mutable auth state the mocked context returns; each test sets it before render.
let authState: { user: { id: string } | null; isLoading: boolean } = { user: null, isLoading: false };
vi.mock('@/context/AuthContext', () => ({ useAuth: () => authState }));

import { useConversations } from '@/hooks/useConversations';

const STORAGE_KEY = 'tripplet_conversations';

function conv(id: string, updatedAt: string, title = id) {
    return {
        id,
        title,
        model: 'tura-3',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt,
        messages: [{ id: `${id}-m`, role: 'user', content: 'hi', timestamp: '2026-01-01T00:00:00.000Z' }],
    };
}

const fetchMock = vi.fn();

beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    // Default: signed-in history endpoint returns nothing unless a test overrides.
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ conversations: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    authState = { user: null, isLoading: false };
});

afterEach(cleanup);

describe('useConversations — history loading', () => {
    it('loads guest conversations from localStorage and does not call the API', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([conv('g1', '2026-02-01T00:00:00.000Z')]));
        const { result } = renderHook(() => useConversations());

        await waitFor(() => expect(result.current.historyLoaded).toBe(true));
        expect(result.current.conversations.map((c) => c.id)).toEqual(['g1']);
        expect(result.current.conversations[0].updatedAt).toBeInstanceOf(Date);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('on sign-in, merges API history with leftover guest chats and dedupes shared ids', async () => {
        // localStorage still holds a guest-only chat and a chat that also exists server-side.
        localStorage.setItem(STORAGE_KEY, JSON.stringify([
            conv('guest-only', '2026-03-01T00:00:00.000Z'),
            conv('shared', '2026-01-01T00:00:00.000Z'),
        ]));
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ conversations: [conv('api-1', '2026-04-01T00:00:00.000Z'), conv('shared', '2026-05-01T00:00:00.000Z')] }),
        });
        authState = { user: { id: 'u1' }, isLoading: false };

        const { result } = renderHook(() => useConversations());
        await waitFor(() => expect(result.current.historyLoaded).toBe(true));

        // shared appears exactly once (API copy wins the dedup), and the list is
        // sorted by updatedAt desc: shared (May) > api-1 (Apr) > guest-only (Mar).
        expect(result.current.conversations.map((c) => c.id)).toEqual(['shared', 'api-1', 'guest-only']);
        expect(result.current.conversations.filter((c) => c.id === 'shared')).toHaveLength(1);
        // The surviving "shared" is the API copy (May), not the guest one (Jan).
        expect(result.current.conversations.find((c) => c.id === 'shared')?.updatedAt.getUTCMonth()).toBe(4);
    });

    it('waits for auth to resolve before loading (isLoading gate)', async () => {
        authState = { user: null, isLoading: true };
        const { result } = renderHook(() => useConversations());
        // Give effects a tick; nothing should load while auth is still resolving.
        await act(async () => { await Promise.resolve(); });
        expect(result.current.historyLoaded).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('useConversations — CRUD', () => {
    async function mounted() {
        const hook = renderHook(() => useConversations());
        await waitFor(() => expect(hook.result.current.historyLoaded).toBe(true));
        return hook;
    }

    it('createConversation adds a conversation and makes it active', async () => {
        const { result } = await mounted();
        let newId = '';
        act(() => { newId = result.current.createConversation('tura-3'); });
        expect(newId).toBeTruthy();
        expect(result.current.activeConversationId).toBe(newId);
        expect(result.current.conversations.some((c) => c.id === newId)).toBe(true);
    });

    it('createConversation is idempotent for a given id (no duplicate)', async () => {
        const { result } = await mounted();
        act(() => { result.current.createConversation('tura-3', 'fixed-id'); });
        act(() => { result.current.createConversation('tura-3', 'fixed-id'); });
        expect(result.current.conversations.filter((c) => c.id === 'fixed-id')).toHaveLength(1);
    });

    it('deleteConversation removes it and clears active when it was active', async () => {
        const { result } = await mounted();
        let id = '';
        act(() => { id = result.current.createConversation('tura-3'); });
        act(() => { result.current.deleteConversation(id); });
        expect(result.current.conversations.some((c) => c.id === id)).toBe(false);
        expect(result.current.activeConversationId).toBeNull();
    });

    it('renameConversation updates the title (and ignores empty)', async () => {
        const { result } = await mounted();
        let id = '';
        act(() => { id = result.current.createConversation('tura-3'); });
        act(() => { result.current.renameConversation(id, '  Renamed  '); });
        expect(result.current.conversations.find((c) => c.id === id)?.title).toBe('Renamed');
        act(() => { result.current.renameConversation(id, '   '); });
        expect(result.current.conversations.find((c) => c.id === id)?.title).toBe('Renamed'); // unchanged
    });

    it('saveConversation upserts a full message list', async () => {
        const { result } = await mounted();
        const msgs = [
            { id: 'm1', role: 'user' as const, content: 'What is 2+2?', timestamp: new Date(), model: 'tura-3' },
            { id: 'm2', role: 'assistant' as const, content: '4', timestamp: new Date(), model: 'tura-3' },
        ];
        act(() => { result.current.saveConversation('conv-x', msgs, 'astro-5-code'); });
        const saved = result.current.conversations.find((c) => c.id === 'conv-x');
        expect(saved?.messages).toHaveLength(2);
        expect(saved?.model).toBe('astro-5-code');
        expect(saved?.title).toBe('What is 2+2?');
    });
});
