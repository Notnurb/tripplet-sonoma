// Serverless mode — a dev-only switch that runs the whole app with no
// database and no server round-trips for stored data.
//
// While it is on, `window.fetch` is patched: the data endpoints (auth session,
// chat history/sync/title, memory, projects) are answered from an in-page
// store instead of hitting the API. The store lives in sessionStorage, so a
// reload keeps your work but closing the tab or window throws it all away —
// nothing ever reaches Postgres.
//
// Everything else falls through untouched. Model inference (/api/sonoma,
// /api/chat) still goes to the real backend — there is no local model to
// answer with, so that one call is the exception to "no server".
//
// Dev-mode only: the toggle lives in the dev panel, which itself only mounts
// while isDevModeActive() (NODE_ENV === 'development').

const FLAG_KEY = 'tripplet:serverless';
const DATA_KEY = 'tripplet:serverless-data';

export const SERVERLESS_EVENT = 'tripplet:serverless-change';

interface StoreConversation {
    id: string;
    title: string;
    model: string;
    createdAt: string;
    updatedAt: string;
    messages: unknown[];
}

interface StoreProject {
    id: string;
    userId: string;
    name: string;
    description: string;
    createdAt: string;
    updatedAt: string;
}

interface StoreProjectMemory {
    id: string;
    projectId: string;
    content: string;
    source: 'explicit' | 'auto';
    createdAt: string;
}

interface Store {
    conversations: StoreConversation[];
    projects: StoreProject[];
    projectMemories: StoreProjectMemory[];
    projectConversations: { conversationId: string; projectId: string }[];
    memories: { id: string; content: string; tags: string[]; source: string; createdAt: string; updatedAt: string }[];
}

const EMPTY: Store = {
    conversations: [],
    projects: [],
    projectMemories: [],
    projectConversations: [],
    memories: [],
};

const SERVERLESS_USER = { id: 'serverless-dev', email: 'dev@tripplet.local', name: 'Tripplet Dev' };

function readStore(): Store {
    try {
        const raw = sessionStorage.getItem(DATA_KEY);
        if (!raw) return { ...EMPTY };
        return { ...EMPTY, ...(JSON.parse(raw) as Partial<Store>) };
    } catch {
        return { ...EMPTY };
    }
}

function writeStore(store: Store): void {
    try {
        sessionStorage.setItem(DATA_KEY, JSON.stringify(store));
    } catch {
        // Quota or private mode — the session simply can't be resumed.
    }
}

export function isServerlessMode(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return sessionStorage.getItem(FLAG_KEY) === '1';
    } catch {
        return false;
    }
}

export function setServerlessMode(on: boolean): void {
    if (typeof window === 'undefined') return;
    try {
        if (on) sessionStorage.setItem(FLAG_KEY, '1');
        else sessionStorage.removeItem(FLAG_KEY);
    } catch {
        return;
    }
    if (on) installServerlessFetch();
    window.dispatchEvent(new CustomEvent(SERVERLESS_EVENT, { detail: { on } }));
}

/** Wipe everything the session is holding. */
export function clearServerlessData(): void {
    try {
        sessionStorage.removeItem(DATA_KEY);
    } catch {
        /* ignore */
    }
    window.dispatchEvent(new CustomEvent(SERVERLESS_EVENT, { detail: { on: isServerlessMode() } }));
}

export function serverlessStats(): { conversations: number; projects: number; memories: number } {
    const s = readStore();
    return {
        conversations: s.conversations.length,
        projects: s.projects.length,
        memories: s.memories.length + s.projectMemories.length,
    };
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
    });
}

function newId(prefix: string): string {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

// Title derived from the first message — no model call, no server.
function deriveTitle(message: string): string {
    const line = message.trim().split('\n')[0] ?? '';
    const words = line.replace(/\s+/g, ' ').split(' ').slice(0, 7).join(' ');
    return (words || 'New Chat').slice(0, 60);
}

async function handle(url: URL, init: RequestInit | undefined, method: string): Promise<Response | null> {
    const path = url.pathname;
    const body = (): Record<string, unknown> => {
        try {
            return typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        } catch {
            return {};
        }
    };
    const store = readStore();

    // ── Session ───────────────────────────────────────────────────────────
    if (path === '/api/auth/me') {
        return json({ user: SERVERLESS_USER });
    }

    // ── Chat history ──────────────────────────────────────────────────────
    if (path === '/api/chat/history' && method === 'GET') {
        return json({ conversations: store.conversations });
    }
    if (path === '/api/chat/sync' && method === 'POST') {
        const incoming = (body().conversations as StoreConversation[] | undefined) ?? [];
        const synced: string[] = [];
        for (const c of incoming) {
            if (!c?.id) continue;
            const now = new Date().toISOString();
            const existing = store.conversations.findIndex((x) => x.id === c.id);
            const row: StoreConversation = {
                id: c.id,
                title: c.title ?? 'New Chat',
                model: c.model ?? '',
                createdAt: c.createdAt ?? now,
                updatedAt: now,
                messages: c.messages ?? [],
            };
            if (existing >= 0) store.conversations[existing] = row;
            else store.conversations.unshift(row);
            synced.push(c.id);
        }
        writeStore(store);
        return json({ synced });
    }
    if (path === '/api/chat/title' && method === 'POST') {
        return json({ title: deriveTitle(String(body().message ?? '')) });
    }

    // ── Account memory ────────────────────────────────────────────────────
    if (path === '/api/memory') {
        if (method === 'GET') return json({ memories: store.memories });
        if (method === 'POST') {
            const now = new Date().toISOString();
            const memory = {
                id: newId('mem'),
                content: String(body().content ?? ''),
                tags: (body().tags as string[] | undefined) ?? [],
                source: 'explicit',
                createdAt: now,
                updatedAt: now,
            };
            store.memories.unshift(memory);
            writeStore(store);
            return json({ memory }, 201);
        }
        if (method === 'DELETE') {
            const id = url.searchParams.get('id');
            store.memories = store.memories.filter((m) => m.id !== id);
            writeStore(store);
            return json({ ok: true });
        }
    }

    // ── Projects ──────────────────────────────────────────────────────────
    if (path === '/api/projects') {
        if (method === 'GET') return json({ projects: store.projects });
        if (method === 'POST') {
            const name = String(body().name ?? '').trim();
            if (!name) return json({ error: 'A project name is required' }, 400);
            const now = new Date().toISOString();
            const project: StoreProject = {
                id: newId('proj'),
                userId: SERVERLESS_USER.id,
                name,
                description: String(body().description ?? '').trim(),
                createdAt: now,
                updatedAt: now,
            };
            store.projects.unshift(project);
            writeStore(store);
            return json({ project }, 201);
        }
    }

    const projectMatch = /^\/api\/projects\/([^/]+)(\/memory|\/conversations)?$/.exec(path);
    if (projectMatch) {
        const [, id, sub] = projectMatch;
        const project = store.projects.find((p) => p.id === id);
        if (!project) return json({ error: 'Project not found' }, 404);

        if (!sub) {
            if (method === 'GET') {
                return json({
                    project,
                    memories: store.projectMemories.filter((m) => m.projectId === id),
                });
            }
            if (method === 'PATCH') {
                const b = body();
                if (typeof b.name === 'string') project.name = b.name.trim();
                if (typeof b.description === 'string') project.description = b.description.trim();
                project.updatedAt = new Date().toISOString();
                writeStore(store);
                return json({ project });
            }
            if (method === 'DELETE') {
                store.projects = store.projects.filter((p) => p.id !== id);
                store.projectMemories = store.projectMemories.filter((m) => m.projectId !== id);
                store.projectConversations = store.projectConversations.filter((l) => l.projectId !== id);
                writeStore(store);
                return json({ ok: true });
            }
        }

        if (sub === '/memory') {
            if (method === 'GET') {
                return json({ memories: store.projectMemories.filter((m) => m.projectId === id) });
            }
            if (method === 'POST') {
                const content = String(body().content ?? '').trim();
                if (!content) return json({ error: 'Content is required' }, 400);
                const memory: StoreProjectMemory = {
                    id: newId('pmem'),
                    projectId: id,
                    content,
                    source: 'explicit',
                    createdAt: new Date().toISOString(),
                };
                store.projectMemories.unshift(memory);
                writeStore(store);
                return json({ memory }, 201);
            }
            if (method === 'DELETE') {
                const memoryId = url.searchParams.get('memoryId');
                store.projectMemories = store.projectMemories.filter((m) => m.id !== memoryId);
                writeStore(store);
                return json({ ok: true });
            }
        }

        if (sub === '/conversations') {
            if (method === 'GET') {
                return json({
                    conversationIds: store.projectConversations
                        .filter((l) => l.projectId === id)
                        .map((l) => l.conversationId),
                });
            }
            if (method === 'POST') {
                const conversationId = String(body().conversationId ?? '');
                if (!conversationId) return json({ error: 'conversationId is required' }, 400);
                store.projectConversations = [
                    { conversationId, projectId: id },
                    ...store.projectConversations.filter((l) => l.conversationId !== conversationId),
                ];
                writeStore(store);
                return json({ ok: true }, 201);
            }
        }
    }

    return null; // not ours — let the real fetch handle it
}

/**
 * Collect a project memory from one finished exchange, locally.
 *
 * The real learner runs server-side against Postgres (src/lib/memory/
 * project-learner.ts); with no database there is nothing for it to write to,
 * so serverless mode does its own lightweight version: keep the user's ask as
 * one short fact, skip questions and near-duplicates. Same store, same panel.
 */
export function learnServerlessProjectMemory(projectId: string, userMessage: string): void {
    if (!isServerlessMode() || !projectId) return;
    const first = userMessage.trim().split('\n').find((l) => l.trim()) ?? '';
    const fact = first.replace(/\s+/g, ' ').trim().slice(0, 200);
    // Questions describe what was asked, not what the project IS.
    if (fact.length < 12 || fact.endsWith('?')) return;

    const store = readStore();
    const mine = store.projectMemories.filter((m) => m.projectId === projectId);
    const norm = fact.toLowerCase();
    if (mine.some((m) => m.content.toLowerCase() === norm)) return;

    store.projectMemories.unshift({
        id: newId('pmem'),
        projectId,
        content: fact,
        source: 'auto',
        createdAt: new Date().toISOString(),
    });
    // Same 200-row ceiling as the real store; oldest auto rows roll out.
    const capped = store.projectMemories.filter((m) => m.projectId === projectId);
    if (capped.length > 200) {
        const drop = new Set(
            capped
                .filter((m) => m.source === 'auto')
                .slice(200)
                .map((m) => m.id),
        );
        store.projectMemories = store.projectMemories.filter((m) => !drop.has(m.id));
    }
    writeStore(store);
    window.dispatchEvent(new CustomEvent(SERVERLESS_EVENT, { detail: { on: true } }));
}

let installed = false;

/**
 * Patch window.fetch once. The patch is a no-op whenever serverless mode is
 * off, so it is safe to leave installed for the life of the page.
 */
export function installServerlessFetch(): void {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    const original = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (!isServerlessMode()) return original(input, init);
        try {
            const raw =
                typeof input === 'string'
                    ? input
                    : input instanceof URL
                        ? input.toString()
                        : input.url;
            const url = new URL(raw, window.location.origin);
            if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
                return original(input, init);
            }
            const method = (
                init?.method ??
                (typeof input === 'object' && 'method' in input ? input.method : 'GET')
            ).toUpperCase();
            const handled = await handle(url, init, method);
            if (handled) return handled;
        } catch {
            // Anything unexpected falls through to the network.
        }
        return original(input, init);
    };
}
