'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Message, Conversation } from '@/types';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '@/context/AuthContext';
import { loadSettings } from '@/lib/settings';

const STORAGE_KEY = 'tripplet_conversations';

// Cheap content signature so the cloud-sync effect only pushes conversations
// that actually changed (title, model, or any message's content).
function syncSigOf(c: Conversation): string {
    let hash = 0;
    for (const m of c.messages) {
        const s = `${m.id}:${m.role}:${m.content}`;
        for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
    }
    return `${c.title}|${c.model}|${c.messages.length}|${hash}`;
}

// A conversation still carries a placeholder title if it's the default or just
// a prefix of the first user message (how createConversation/saveConversation
// derive titles before the AI namer has run).
function hasPlaceholderTitle(c: Conversation): boolean {
    if (!c.title || c.title === 'New Chat') return true;
    const first = c.messages.find((m) => m.role === 'user')?.content.trim();
    return !!first && first.startsWith(c.title.trim());
}

/**
 * Conversation domain: the list of conversations, which one is active, history
 * loading (API for signed-in users, localStorage for guests), and CRUD. This is
 * deliberately separated from the streaming/`sendMessage` concern (see
 * `useChat`) so a change to persistence or history logic doesn't have to be made
 * inside a 700-line streaming callback.
 *
 * It exposes `setConversations` and the `*Ref` mirrors so the streaming layer
 * can append messages and read the latest history without prop-drilling.
 */
export function useConversations() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [historyLoaded, setHistoryLoaded] = useState(false);

    const { user, isLoading: isAuthLoadingRaw } = useAuth();
    const isAuthLoaded = !isAuthLoadingRaw;
    const isSignedIn = !!user;

    // Ref mirrors so async streaming code can read the latest values without
    // re-subscribing to state.
    const conversationsRef = useRef<Conversation[]>([]);
    const activeConversationIdRef = useRef<string | null>(null);

    // id → signature of the copy the cloud already has. Seeded from the server
    // load so boot doesn't re-upload everything; guest conversations recovered
    // from localStorage are absent from the seed and migrate up automatically.
    const lastSyncedRef = useRef<Map<string, string>>(new Map());

    useEffect(() => {
        conversationsRef.current = conversations;
    }, [conversations]);

    useEffect(() => {
        activeConversationIdRef.current = activeConversationId;
    }, [activeConversationId]);

    // Initialize/Load from API — wait until auth resolves.
    useEffect(() => {
        if (!isAuthLoaded) return;
        let cancelled = false;

        async function loadConversations() {
            if (!isSignedIn) {
                try {
                    const saved = localStorage.getItem(STORAGE_KEY);
                    if (saved) {
                        const parsed = JSON.parse(saved);
                        const formatted = parsed.map((c: any) => ({
                            ...c,
                            createdAt: new Date(c.createdAt),
                            updatedAt: new Date(c.updatedAt),
                            messages: c.messages.map((m: any) => ({
                                ...m,
                                timestamp: new Date(m.timestamp)
                            }))
                        }));
                        if (!cancelled) {
                            setConversations(formatted);
                        }
                    }
                } catch {
                    // ignore
                }
                if (!cancelled) {
                    setHistoryLoaded(true);
                }
                return;
            }

            try {
                const res = await fetch('/api/chat/history');
                if (cancelled) return;
                if (res.ok) {
                    const data = await res.json();
                    if (cancelled) return;
                    if (data.conversations) {
                        const formatted = data.conversations.map((c: any) => ({
                            ...c,
                            createdAt: new Date(c.createdAt),
                            updatedAt: new Date(c.updatedAt),
                            messages: c.messages.map((m: any) => ({
                                ...m,
                                timestamp: new Date(m.timestamp || m.createdAt),
                                model: m.model || c.model // Fallback
                            }))
                        })) as Conversation[];

                        formatted.forEach((c) => lastSyncedRef.current.set(c.id, syncSigOf(c)));

                        setConversations((prev) => {
                            const merged = [...formatted];

                            // Also recover any guest conversations from localStorage
                            // so conversations survive the sign-in transition
                            let guestConvs: Conversation[] = [];
                            try {
                                const saved = localStorage.getItem(STORAGE_KEY);
                                if (saved) {
                                    const parsed = JSON.parse(saved);
                                    guestConvs = parsed.map((c: any) => ({
                                        ...c,
                                        createdAt: new Date(c.createdAt),
                                        updatedAt: new Date(c.updatedAt),
                                        messages: c.messages.map((m: any) => ({
                                            ...m,
                                            timestamp: new Date(m.timestamp),
                                        })),
                                    }));
                                }
                            } catch { /* ignore */ }

                            const seen = new Set(merged.map(c => c.id));
                            [...prev, ...guestConvs].forEach(p => {
                                if (!seen.has(p.id)) {
                                    merged.unshift(p);
                                    seen.add(p.id);
                                }
                            });

                            return merged.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
                        });
                    }
                }
            } catch (error) {
                if (!cancelled) {
                    console.error("Failed to load history", error);
                }
            } finally {
                if (!cancelled) {
                    setHistoryLoaded(true);
                }
            }
        }

        loadConversations();

        return () => {
            cancelled = true;
        };
    }, [isSignedIn, isAuthLoaded]);

    // Save to localStorage ONLY for confirmed guests (not during auth loading).
    useEffect(() => {
        if (isAuthLoaded && !isSignedIn && historyLoaded) {
            const timeout = setTimeout(() => {
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
                } catch {
                    // ignore
                }
            }, 250);
            return () => clearTimeout(timeout);
        }
    }, [conversations, historyLoaded, isSignedIn, isAuthLoaded]);

    // Cloud sync for signed-in users: debounce, diff against what the server
    // already has, and push only the changed conversations (encrypted at rest
    // server-side). Fire-and-forget — a failed push retries on the next change
    // because the signature map is only updated after a 2xx.
    useEffect(() => {
        if (!isAuthLoaded || !isSignedIn || !historyLoaded) return;
        const timeout = setTimeout(async () => {
            const changed = conversationsRef.current.filter(
                (c) => c.messages.length > 0 && lastSyncedRef.current.get(c.id) !== syncSigOf(c),
            );
            // Oldest-first so a mid-batch failure never leaves newer state
            // synced ahead of older state; cap batches to the API's limit.
            for (let i = 0; i < changed.length; i += 10) {
                const batch = changed.slice(i, i + 10);
                try {
                    const res = await fetch('/api/chat/sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            conversations: batch.map((c) => ({
                                id: c.id,
                                title: c.title,
                                model: c.model,
                                createdAt: c.createdAt,
                                messages: c.messages.slice(-400).map((m) => ({
                                    id: m.id,
                                    role: m.role === 'user' ? 'user' : 'assistant',
                                    content: m.content.slice(0, 200_000),
                                    timestamp: m.timestamp,
                                    model: m.model,
                                    attachments: m.attachments,
                                    codeExecutions: m.codeExecutions,
                                })),
                            })),
                        }),
                    });
                    if (res.ok) {
                        const { synced } = await res.json();
                        batch.forEach((c) => {
                            if (Array.isArray(synced) && synced.includes(c.id)) {
                                lastSyncedRef.current.set(c.id, syncSigOf(c));
                            }
                        });
                    } else {
                        break; // rate-limited or server trouble — retry on next change
                    }
                } catch {
                    break; // offline — localStorage/state still has everything
                }
            }
        }, 1500);
        return () => clearTimeout(timeout);
    }, [conversations, historyLoaded, isSignedIn, isAuthLoaded, conversationsRef]);

    // AI conversation naming (big-pickle via /api/chat/title): once a
    // conversation has its first real exchange and still wears a placeholder
    // title, ask the namer once and rename in place. The rename flows through
    // the cloud-sync effect automatically. Off when the Auto-title setting is.
    const titleAttemptedRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (!historyLoaded || !loadSettings().autoTitle) return;
        const timeout = setTimeout(async () => {
            const candidates = conversationsRef.current.filter(
                (c) =>
                    !titleAttemptedRef.current.has(c.id) &&
                    hasPlaceholderTitle(c) &&
                    c.messages.some((m) => m.role === 'user') &&
                    c.messages.some((m) => m.role === 'assistant'),
            );
            for (const c of candidates.slice(0, 3)) {
                titleAttemptedRef.current.add(c.id);
                const firstUser = c.messages.find((m) => m.role === 'user');
                const firstReply = c.messages.find((m) => m.role === 'assistant');
                if (!firstUser?.content.trim()) continue;
                try {
                    const res = await fetch('/api/chat/title', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            message: firstUser.content.slice(0, 2000),
                            reply: firstReply?.content.slice(0, 2000),
                        }),
                    });
                    if (!res.ok) continue;
                    const { title } = await res.json();
                    if (typeof title === 'string' && title.trim() && title !== 'New Chat') {
                        setConversations((prev) =>
                            prev.map((p) => (p.id === c.id ? { ...p, title: title.trim().slice(0, 60) } : p)),
                        );
                    }
                } catch {
                    // Placeholder title stays — retried never, it's cosmetic.
                }
            }
        }, 1200);
        return () => clearTimeout(timeout);
    }, [conversations, historyLoaded, conversationsRef]);

    const activeConversation = useMemo(
        () => conversations.find((c) => c.id === activeConversationId),
        [conversations, activeConversationId]
    );

    // Create a new conversation and make it active. Streaming-state reset (if
    // any) is layered on by the caller in `useChat` — this stays pure
    // conversation domain.
    const createConversation = useCallback((modelId?: string, id?: string, initialMessages: Message[] = []) => {
        const defaultModel = (isAuthLoaded && !isSignedIn) ? 'suzhou4' : 'taipei4';
        const finalModel = modelId || defaultModel;
        const newId = id || uuidv4();

        // Prevent duplicate creation if it already exists
        setConversations((prev) => {
            if (prev.some(c => c.id === newId)) return prev;

            const newConv: Conversation = {
                id: newId,
                title: initialMessages.length > 0 ? (initialMessages[0].content.slice(0, 30) || 'New Chat') : 'New Chat',
                model: finalModel,
                updatedAt: new Date(),
                createdAt: new Date(),
                messages: initialMessages,
            };
            return [newConv, ...prev];
        });

        setActiveConversationId(newId);
        activeConversationIdRef.current = newId;
        return newId;
    }, [isSignedIn, isAuthLoaded]);

    // Persist a full message list into a conversation (creating it if needed).
    // Used by the Sonoma chat shell, which streams via /api/sonoma and holds
    // the message list locally — this keeps the sidebar history in sync.
    const saveConversation = useCallback((id: string, messages: Message[], modelId?: string) => {
        if (messages.length === 0) return;
        const firstUser = messages.find((m) => m.role === 'user');
        const derivedTitle = firstUser?.content.trim().slice(0, 40) || 'New Chat';
        setConversations((prev) => {
            const idx = prev.findIndex((c) => c.id === id);
            if (idx === -1) {
                const conv: Conversation = {
                    id,
                    title: derivedTitle,
                    model: modelId || messages[messages.length - 1]?.model || 'taipei4',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    messages,
                };
                return [conv, ...prev];
            }
            return prev.map((c) =>
                c.id === id
                    ? {
                        ...c,
                        messages,
                        // Keep the persisted model current — switching models
                        // mid-conversation (e.g. onto Astro 5 Code) must
                        // survive a reload.
                        model: modelId || c.model,
                        updatedAt: new Date(),
                        title: c.title && c.title !== 'New Chat' ? c.title : derivedTitle,
                    }
                    : c,
            );
        });
    }, []);

    const selectConversation = useCallback((id: string) => {
        setActiveConversationId(id);
        activeConversationIdRef.current = id;
    }, []);

    const deleteConversation = useCallback(
        (id: string) => {
            setConversations((prev) => prev.filter((c) => c.id !== id));
            if (activeConversationIdRef.current === id) {
                setActiveConversationId(null);
                activeConversationIdRef.current = null;
            }
            lastSyncedRef.current.delete(id);
            if (isSignedIn) {
                fetch('/api/chat/sync', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id }),
                }).catch(() => { /* cloud copy lingers; local removal already done */ });
            }
        },
        [isSignedIn]
    );

    const renameConversation = useCallback((id: string, newTitle: string) => {
        setConversations((prev) =>
            prev.map((c) => (c.id === id ? { ...c, title: newTitle.trim() || c.title } : c))
        );
    }, []);

    return {
        conversations,
        setConversations,
        activeConversationId,
        setActiveConversationId,
        historyLoaded,
        activeConversation,
        conversationsRef,
        activeConversationIdRef,
        createConversation,
        saveConversation,
        selectConversation,
        deleteConversation,
        renameConversation,
    };
}
