'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useIsMobile } from '@/hooks/useIsMobile';
import { modelsForPage, DEEP_CODE_PERSONA, type WorkspacePage } from '@/lib/ai/models';
import {
    DEEP_CODE_DEFAULT_REASONING_LEVEL,
    type DeepCodeReasoningLevel,
} from '@/lib/sonoma/reasoning-levels';
import { loadSettings, SETTINGS_EVENT } from '@/lib/settings';
import { useChatConversations, useChatActions } from '@/context/ChatContext';
import { runBash, isVmDownloaded, bootVm } from '@/lib/sandbox/trippletLinux';
import { readSonomaStream, mergeActivity, finishBashActivity } from '@/lib/sonoma/stream';
import { takeChatHandoff } from '@/lib/sonoma/handoff';
import { OUTAGE_ACTIVE } from '@/lib/outage';
import type { Message } from '@/types';
import SonomaComposer, { ModelMenu } from './Composer';
import OutageNotice from './OutageNotice';
import {
    SonomaUserMessage,
    SonomaAssistantMessage,
    type SonomaActivity,
} from './Message';

type UploadedFile = {
    id: string;
    file: File;
    preview?: string;
    name: string;
    kb: number;
};

interface UIMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    model?: string;
    thinking?: string;
    activity: SonomaActivity[];
    files?: { id: string; name: string; preview?: string; type: 'image' | 'file' }[];
}

function timeGreeting(): string {
    const h = new Date().getHours();
    if (h < 5) return 'Working late.';
    if (h < 12) return 'Good morning.';
    if (h < 17) return 'Good afternoon.';
    if (h < 21) return 'Good evening.';
    return 'Working late.';
}

function PageGreeting({ title, sub, white }: { title: string; sub: string; white?: boolean }) {
    return (
        <div className="sm-fadeUp flex flex-col items-center" style={{ marginTop: 0 }}>
            <div
                style={{
                    fontFamily: 'var(--font-serif)',
                    fontWeight: 400,
                    fontSize: 'clamp(34px, 4.4vw, 52px)',
                    lineHeight: 1.06,
                    letterSpacing: '-0.022em',
                    color: white ? '#ffffff' : 'var(--sonoma-ink)',
                    textAlign: 'center',
                }}
            >
                {title}
            </div>
            <div
                style={{
                    fontFamily: 'var(--font-serif)',
                    fontStyle: 'italic',
                    fontWeight: 400,
                    fontSize: 'clamp(20px, 2.4vw, 28px)',
                    lineHeight: 1.2,
                    letterSpacing: '-0.012em',
                    color: white ? '#ffffff' : 'var(--sonoma-muted)',
                    textAlign: 'center',
                    marginTop: 6,
                }}
            >
                {sub}
            </div>
        </div>
    );
}

interface DevOverride {
    apiKey: string;
    modelId: string;
}

interface SonomaChatShellProps {
    page?: WorkspacePage;
    conversationId?: string;
    transparent?: boolean;
    // /dev panel only: bypasses the OUTAGE_ACTIVE composer lock and routes the
    // selected persona through a user-supplied Groq key + model id instead of
    // the normal server-side backend. See src/app/dev/page.tsx.
    forceEnabled?: boolean;
    devOverride?: DevOverride;
}

const GREETINGS: Record<WorkspacePage, { title: () => string; sub: string; placeholder: string }> = {
    chat: { title: timeGreeting, sub: 'What shall we work on?', placeholder: 'How can Tripplet help?' },
    code: {
        title: () => "Let's build.",
        sub: 'Code, debug, refactor — together.',
        placeholder: 'Ask about code, paste a snippet, or drop a file…',
    },
    agent: {
        title: () => 'What should we run?',
        sub: 'An agent that searches, reads, and reasons.',
        placeholder: 'Describe a task. The agent will plan and execute.',
    },
};

function newId(prefix: string) {
    return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

// UIMessage (local shell shape) ↔ Message (persisted shape) converters.
function toPersisted(m: UIMessage): Message {
    return {
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date(),
        model: m.model,
    };
}

// Cheap content signature used to skip no-op saves.
function sigOf(messages: UIMessage[]): string {
    return messages.map((m) => `${m.id}:${m.content.length}`).join('|');
}

function toUI(m: Message): UIMessage {
    return {
        id: m.id,
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
        model: m.model,
        activity: [],
    };
}

export default function SonomaChatShell({ page = 'chat', conversationId, transparent = false, forceEnabled = false, devOverride }: SonomaChatShellProps = {}) {
    const router = useRouter();
    const isMobile = useIsMobile();
    const { conversations, historyLoaded } = useChatConversations();
    const { createConversation, selectConversation, saveConversation } = useChatActions();
    const [legacyModels, setLegacyModels] = useState(false);
    const [sandboxEnabled, setSandboxEnabled] = useState(false);
    const [memoryEnabled, setMemoryEnabled] = useState(true);
    const [pastChatsEnabled, setPastChatsEnabled] = useState(true);
    useEffect(() => {
        const sync = () => {
            const s = loadSettings();
            setLegacyModels(s.legacyModels);
            setMemoryEnabled(s.memorySkill ?? true);
            setPastChatsEnabled(s.pastChatsSkill ?? true);
            // Skill is live only when enabled AND the VM has been downloaded.
            const live = s.sandboxedLinux && isVmDownloaded();
            setSandboxEnabled(live);
            // Pre-boot the VM in the background the moment the skill is live,
            // so the first run_bash executes against a warm guest instead of
            // paying the multi-second cold boot inside the activity card.
            if (live) void bootVm().catch(() => { /* surfaces on first run */ });
        };
        sync();
        window.addEventListener(SETTINGS_EVENT, sync);
        return () => window.removeEventListener(SETTINGS_EVENT, sync);
    }, []);
    const [draft, setDraft] = useState('');
    const [browse, setBrowse] = useState(page === 'agent');
    const [reason, setReason] = useState(false);
    const [codeMode, setCodeMode] = useState(page === 'code');
    // DeepCode (code page only): swaps the model lineup to the deep-coding
    // set headlined by Astro 5 Code, a multi-stage pipeline persona.
    const [deepCode, setDeepCode] = useState(false);
    const [deepCodeLevel, setDeepCodeLevel] = useState<DeepCodeReasoningLevel>(
        DEEP_CODE_DEFAULT_REASONING_LEVEL,
    );
    const pageModels = useMemo(
        () => modelsForPage(page, legacyModels, deepCode),
        [page, legacyModels, deepCode],
    );
    const [model, setModel] = useState<string>(pageModels[0].id);
    const [uploaded, setUploaded] = useState<UploadedFile[]>([]);
    const [messages, setMessages] = useState<UIMessage[]>([]);
    const [busy, setBusy] = useState(false);
    const [atBottom, setAtBottom] = useState(true);
    const abortRef = useRef<AbortController | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const bashRunRef = useRef<Set<string>>(new Set());
    const machineRunRef = useRef<Set<string>>(new Set());
    // Paired OpenSonoma machines, for the composer's @mention list and the
    // Manage panel. Refetched whenever Manage closes (pair/unpair changes it).
    const [pairedMachines, setPairedMachines] = useState<{ deviceId: string; machineName: string }[]>([]);
    const [mentionedMachine, setMentionedMachine] = useState<{ deviceId: string; machineName: string } | null>(null);

    const refreshMachines = useCallback(() => {
        fetch('/api/connect/machines')
            .then((r) => (r.ok ? r.json() : { machines: [] }))
            .then((data) => {
                const list = Array.isArray(data.machines) ? data.machines : [];
                const simplified = list.map((m: { deviceId: string; machineName: string; status: string; online: boolean; lastSeenAt: string | null }) => ({
                    deviceId: m.deviceId,
                    machineName: m.machineName,
                }));
                setPairedMachines(simplified);
                // Auto-attach so the user doesn't have to @mention every
                // message — only when nothing is attached yet (an explicit
                // @mention or "remove" from the composer still wins) and
                // there's exactly one paired machine to default to.
                setMentionedMachine((prev) => (prev ? prev : simplified.length === 1 ? simplified[0] : prev));
            })
            .catch(() => { /* signed out / relay unreachable — composer just shows no machines */ });
    }, []);

    useEffect(() => {
        refreshMachines();
    }, [refreshMachines]);
    // Mirror of `atBottom` for the streaming auto-scroll effect, so it can read
    // the latest value without re-subscribing on every scroll.
    const atBottomRef = useRef(true);

    const onScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        const near = dist < 80;
        atBottomRef.current = near;
        setAtBottom(near);
    }, []);

    const scrollToBottom = useCallback(() => {
        const el = scrollRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, []);

    // The conversation this shell is bound to. Starts from the route param;
    // a fresh /chat with no id gets one assigned on first send.
    const convIdRef = useRef<string | null>(conversationId ?? null);
    // Tracks which conversation id we've already hydrated into local state so
    // we don't clobber an in-progress chat when the list updates.
    const hydratedRef = useRef<string | null>(null);
    // When a chat is started on the bare /chat route, we defer the URL change
    // until the turn is saved — navigating mid-stream would remount the shell.
    const pendingNavRef = useRef<string | null>(null);
    // Signature of the last persisted message list, so merely viewing a chat
    // doesn't re-save and reshuffle the history order.
    const savedSigRef = useRef<string>('');

    useEffect(() => {
        convIdRef.current = conversationId ?? null;
    }, [conversationId]);

    useEffect(() => {
        if (!pageModels.some((m) => m.id === model)) {
            setModel(pageModels[0].id);
        }
    }, [pageModels, model]);

    // Hydrate messages from the selected conversation (chat history).
    useEffect(() => {
        if (!conversationId || !historyLoaded) return;
        if (hydratedRef.current === conversationId) return;
        const conv = conversations.find((c) => c.id === conversationId);
        if (!conv) return;
        hydratedRef.current = conversationId;
        selectConversation(conversationId);
        if (conv.model) {
            // A conversation saved on the DeepCode lineup must restore the
            // toggle too, or the model-reset effect below would silently
            // kick it back to the base flagship.
            if (conv.model === DEEP_CODE_PERSONA) setDeepCode(true);
            setModel(conv.model);
        }
        const ui = conv.messages.filter((m) => m.role !== 'system').map(toUI);
        savedSigRef.current = sigOf(ui);
        setMessages(ui);
    }, [conversationId, historyLoaded, conversations, selectConversation]);

    // Persist the message list back into the conversation whenever a turn
    // settles, so the sidebar history stays in sync and survives reloads.
    useEffect(() => {
        const id = convIdRef.current;
        if (!id || busy || messages.length === 0) return;
        const sig = sigOf(messages);
        if (sig === savedSigRef.current) return;
        savedSigRef.current = sig;
        saveConversation(id, messages.map(toPersisted), model);
        // Reflect the new conversation in the URL once it's safely persisted.
        if (pendingNavRef.current === id) {
            pendingNavRef.current = null;
            router.replace(`/chat/${id}`);
        }
    }, [busy, messages, model, saveConversation, router]);

    const empty = messages.length === 0 && !busy;
    const centered = empty;

    // Auto-scroll as content streams in, but only when the user is already
    // pinned to the bottom — don't yank them back while they read history.
    useEffect(() => {
        if (atBottomRef.current && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages.length, messages[messages.length - 1]?.content, messages[messages.length - 1]?.activity?.length, messages[messages.length - 1]?.thinking?.length]);

    // A brand-new turn (user just sent) should always snap to the bottom.
    useEffect(() => {
        atBottomRef.current = true;
        setAtBottom(true);
    }, [messages.length]);

    const addFiles = useCallback((list: File[]) => {
        Promise.all(
            list.map(async (f) => {
                const id_ = newId('f');
                const isImage = f.type.startsWith('image/');
                const preview = isImage ? URL.createObjectURL(f) : undefined;
                return {
                    id: id_,
                    file: f,
                    preview,
                    name: f.name,
                    kb: Math.max(1, Math.round(f.size / 1024)),
                } as UploadedFile;
            }),
        ).then((atts) => setUploaded((u) => [...u, ...atts]));
    }, []);

    const removeFile = useCallback((id_: string) => {
        setUploaded((u) => {
            const found = u.find((x) => x.id === id_);
            if (found?.preview) URL.revokeObjectURL(found.preview);
            return u.filter((x) => x.id !== id_);
        });
    }, []);

    const stop = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setBusy(false);
    }, []);

    // Run a run_bash tool call headlessly in the real Linux VM and patch the
    // card with the actual stdout — same inline UI as the Python skill.
    const execBash = useCallback((assistantId: string, activityId: string, command: string) => {
        if (bashRunRef.current.has(activityId)) return;
        bashRunRef.current.add(activityId);
        runBash(command).then((output) => {
            setMessages((prev) => prev.map((m) =>
                m.id === assistantId ? { ...m, activity: finishBashActivity(m.activity, activityId, output) } : m,
            ));
        });
    }, []);

    // Actually run a run_on_machine tool call over the relay, after the user
    // has approved it (see onMachineDecision). Streams stdout/stderr and
    // patches the same "done" card shape run_bash uses.
    const execMachine = useCallback(
        (assistantId: string, activityId: string, deviceId: string, command: string, password: string) => {
            if (machineRunRef.current.has(activityId)) return;
            machineRunRef.current.add(activityId);
            let out = '';
            fetch('/api/connect/exec', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId, command, password }),
            })
                .then(async (res) => {
                    if (!res.body) throw new Error('no stream');
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    let buf = '';
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        buf += decoder.decode(value, { stream: true });
                        let nl: number;
                        while ((nl = buf.indexOf('\n\n')) !== -1) {
                            const chunk = buf.slice(0, nl);
                            buf = buf.slice(nl + 2);
                            const line = chunk.split('\n').find((l) => l.startsWith('data:'));
                            if (!line) continue;
                            let ev: { type: string; stream?: string; data?: string; ok?: boolean; error?: string };
                            try {
                                ev = JSON.parse(line.slice(5).trim());
                            } catch {
                                continue;
                            }
                            if (ev.type === 'stream' && ev.data) out += ev.data;
                            else if (ev.type === 'result' && !ev.ok && ev.error) out += (out ? '\n' : '') + `Error: ${ev.error}`;
                        }
                    }
                })
                .catch((e) => {
                    out += (out ? '\n' : '') + `Error: ${e instanceof Error ? e.message : 'exec failed'}`;
                })
                .finally(() => {
                    setMessages((prev) => prev.map((m) =>
                        m.id === assistantId ? { ...m, activity: finishBashActivity(m.activity, activityId, out) } : m,
                    ));
                });
        },
        [],
    );

    // In-page password dialog (never a native window.prompt) — shown when a
    // Yes/Always Accept decision needs a device password we don't have cached
    // for this session yet.
    const [passwordRequest, setPasswordRequest] = useState<{
        assistantId: string;
        activityId: string;
        deviceId: string;
        command: string;
        always: boolean;
    } | null>(null);

    const runApprovedMachine = useCallback(
        (assistantId: string, activityId: string, deviceId: string, command: string, always: boolean, password: string) => {
            setMessages((prev) => prev.map((m) => {
                if (m.id !== assistantId) return m;
                const activity = m.activity.map((a) => (a.id === activityId ? { ...a, permission: 'approved' as const } : a));
                return { ...m, activity };
            }));
            sessionStorage.setItem(`os_pw_${deviceId}`, password);
            if (always) sessionStorage.setItem(`os_always_${deviceId}`, '1');
            execMachine(assistantId, activityId, deviceId, command, password);
        },
        [execMachine],
    );

    // Handle Yes / Always Accept / No from the in-chat permission card.
    const onMachineDecision = useCallback(
        (assistantId: string) => (activityId: string, decision: 'yes' | 'always' | 'no') => {
            if (decision === 'no') {
                setMessages((prev) => prev.map((m) => {
                    if (m.id !== assistantId) return m;
                    const activity = m.activity.map((a) => (a.id === activityId ? { ...a, permission: 'denied' as const } : a));
                    return { ...m, activity };
                }));
                return;
            }

            const act = messages.find((m) => m.id === assistantId)?.activity.find((a) => a.id === activityId);
            const deviceId = String(act?.args.device_id ?? '');
            const command = String(act?.args.command ?? '');
            if (!deviceId || !command) return;

            const password = sessionStorage.getItem(`os_pw_${deviceId}`) || '';
            if (password) {
                runApprovedMachine(assistantId, activityId, deviceId, command, decision === 'always', password);
                return;
            }
            setPasswordRequest({ assistantId, activityId, deviceId, command, always: decision === 'always' });
        },
        [messages, runApprovedMachine],
    );

    const runAgent = useCallback(
        async (history: UIMessage[], assistantId: string) => {
            const ctrl = new AbortController();
            abortRef.current = ctrl;
            setBusy(true);

            const payload = {
                messages: history.map((m) => ({
                    role: m.role,
                    content: m.content,
                })),
                reason,
                browse,
                code: codeMode,
                deepCode,
                deepCodeLevel,
                page,
                model,
                sandbox: sandboxEnabled,
                memory: memoryEnabled,
                pastChats: pastChatsEnabled,
                machine: mentionedMachine,
                // Override auth rides on the HttpOnly dev_unlock cookie.
                ...(devOverride
                    ? { dev: { apiKey: devOverride.apiKey, modelId: devOverride.modelId } }
                    : {}),
            };

            try {
                const res = await fetch('/api/sonoma', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: ctrl.signal,
                });

                if (!res.ok || !res.body) {
                    const txt = await res.text().catch(() => '');
                    // A markup body is a framework error page (e.g. Next's
                    // HTML 500), not a message — don't dump it into the chat.
                    const isHtml =
                        /^\s*</.test(txt) ||
                        (res.headers.get('content-type') ?? '').includes('text/html');
                    let detail: string;
                    if (isHtml) {
                        detail = 'The server hit an internal error. Please try again.';
                    } else {
                        // JSON bodies (e.g. the 429 rate-limit response) carry
                        // the human message under `error` — show that, not the
                        // raw envelope.
                        let jsonError = '';
                        try {
                            jsonError = String(JSON.parse(txt).error ?? '');
                        } catch {
                            /* plain text */
                        }
                        detail = (jsonError || txt).slice(0, 200);
                    }
                    throw new Error(`Sonoma route ${res.status}: ${detail}`);
                }

                await readSonomaStream(res.body, {
                    onThinking: (delta) =>
                        setMessages((prev) =>
                            prev.map((m) =>
                                m.id === assistantId
                                    ? { ...m, thinking: (m.thinking ?? '') + delta }
                                    : m,
                            ),
                        ),
                    onContent: (delta) =>
                        setMessages((prev) =>
                            prev.map((m) =>
                                m.id === assistantId ? { ...m, content: m.content + delta } : m,
                            ),
                        ),
                    onActivity: (ev) => {
                        if (ev.tool === 'run_on_machine') {
                            const deviceId = String(ev.args?.device_id ?? '');
                            const machineName = mentionedMachine?.deviceId === deviceId ? mentionedMachine.machineName : deviceId;
                            const enriched = { ...ev, args: { ...ev.args, machine_name: machineName } };
                            const alwaysAccepted = typeof window !== 'undefined' && sessionStorage.getItem(`os_always_${deviceId}`) === '1';
                            setMessages((prev) =>
                                prev.map((m) => {
                                    if (m.id !== assistantId) return m;
                                    const merged = mergeActivity(m.activity, enriched);
                                    const activity = merged.map((a) =>
                                        a.id === ev.id ? { ...a, permission: alwaysAccepted ? ('approved' as const) : ('pending' as const) } : a,
                                    );
                                    return { ...m, activity };
                                }),
                            );
                            if (alwaysAccepted) {
                                const password = sessionStorage.getItem(`os_pw_${deviceId}`) || '';
                                if (password) execMachine(assistantId, ev.id, deviceId, String(ev.args?.command ?? ''), password);
                            }
                            return;
                        }
                        setMessages((prev) =>
                            prev.map((m) =>
                                m.id === assistantId ? { ...m, activity: mergeActivity(m.activity, ev) } : m,
                            ),
                        );
                        if (ev.tool === 'run_bash') {
                            execBash(assistantId, ev.id, String(ev.args?.command ?? ''));
                        }
                    },
                    onError: (message) =>
                        setMessages((prev) =>
                            prev.map((m) =>
                                m.id === assistantId
                                    ? { ...m, content: m.content + `\n\n_Error: ${message}_` }
                                    : m,
                            ),
                        ),
                });
            } catch (e) {
                if (ctrl.signal.aborted) {
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === assistantId
                                ? { ...m, content: m.content || '(stopped)' }
                                : m,
                        ),
                    );
                } else {
                    const msg = e instanceof Error ? e.message : 'Unknown error';
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === assistantId
                                ? { ...m, content: m.content + `\n\n_${msg}_` }
                                : m,
                        ),
                    );
                }
            } finally {
                abortRef.current = null;
                setBusy(false);
            }
        },
        [browse, reason, codeMode, deepCode, deepCodeLevel, page, model, devOverride, sandboxEnabled, memoryEnabled, pastChatsEnabled, mentionedMachine, execBash, execMachine],
    );

    const handleSend = useCallback(async () => {
        if (OUTAGE_ACTIVE && !forceEnabled) return;
        if (busy) return;
        const text = draft.trim();
        if (!text && uploaded.length === 0) return;

        // Ensure this chat is backed by a conversation so it lands in history.
        // On the bare /chat route (no id), mint one now and reflect it in the URL.
        if (!convIdRef.current) {
            const newId = createConversation(model);
            if (newId) {
                convIdRef.current = newId;
                hydratedRef.current = newId;
                // Only the canonical /chat route should rewrite its URL.
                if (page === 'chat' && !conversationId) pendingNavRef.current = newId;
            }
        }

        const userMessage: UIMessage = {
            id: newId('u'),
            role: 'user',
            content: text,
            activity: [],
            files: uploaded.map((f) => ({
                id: f.id,
                name: f.name,
                preview: f.preview,
                type: f.file.type.startsWith('image/') ? 'image' : 'file',
            })),
        };
        const assistantMessage: UIMessage = {
            id: newId('a'),
            role: 'assistant',
            content: '',
            model,
            activity: [],
        };

        const next = [...messages, userMessage, assistantMessage];
        setMessages(next);
        setDraft('');
        setUploaded([]);
        // mentionedMachine deliberately persists across turns — auto-attached
        // or @mentioned once, it stays available for the rest of the chat
        // instead of requiring a fresh @mention every message.

        await runAgent(next.slice(0, -1), assistantMessage.id);
    }, [busy, draft, uploaded, messages, model, runAgent, createConversation, page, conversationId, forceEnabled]);

    // Landing-page handoff: a message typed into the composer on `/` arrives
    // via sessionStorage. Prefill the draft (and any options) on mount, then
    // send it once React has committed the new draft — handleSend reads state,
    // so sending in the same tick as setDraft would see the old (empty) value.
    const [handoffPending, setHandoffPending] = useState(false);
    useEffect(() => {
        if (page !== 'chat' || conversationId) return;
        const handoff = takeChatHandoff();
        if (!handoff) return;
        if (handoff.model && pageModels.some((m) => m.id === handoff.model)) {
            setModel(handoff.model);
        }
        if (handoff.browse) setBrowse(true);
        if (handoff.reason) setReason(true);
        if (handoff.code) setCodeMode(true);
        setDraft(handoff.text);
        setHandoffPending(true);
        // Mount-only: the handoff is consumed exactly once per shell instance.
         
    }, []);
    useEffect(() => {
        if (!handoffPending || busy || !draft.trim()) return;
        setHandoffPending(false);
        void handleSend();
    }, [handoffPending, busy, draft, handleSend]);

    const handleRegenerate = useCallback(() => {
        if ((OUTAGE_ACTIVE && !forceEnabled) || busy) return;
        const lastUserIdx = [...messages].map((m, i) => ({ m, i })).reverse().find((x) => x.m.role === 'user')?.i;
        if (lastUserIdx === undefined) return;
        const history = messages.slice(0, lastUserIdx + 1);
        const assistantMessage: UIMessage = {
            id: newId('a'),
            role: 'assistant',
            content: '',
            model,
            activity: [],
        };
        const next = [...history, assistantMessage];
        setMessages(next);
        void runAgent(history, assistantMessage.id);
    }, [busy, messages, model, runAgent]);

    return (
        <div
            className="relative flex h-full w-full flex-1"
            style={{ background: transparent ? 'transparent' : 'var(--sonoma-bg)' }}
        >
            <div className="relative h-full flex-1" style={{ minWidth: 0 }}>
                {/* Mobile: model picker centered at the top, under the "Tripplet" header. */}
                {isMobile && (
                    <div
                        className="absolute left-0 right-0 top-0 z-20 flex justify-center"
                        style={{ padding: '8px 12px', pointerEvents: 'none' }}
                    >
                        <div style={{ pointerEvents: 'auto' }}>
                            <ModelMenu
                                value={model}
                                onChange={setModel}
                                models={pageModels}
                                placement="down"
                                variant="pill"
                            />
                        </div>
                    </div>
                )}
                <main
                    ref={scrollRef}
                    onScroll={onScroll}
                    className="sonoma-scroll absolute inset-0 overflow-y-auto"
                    style={{
                        paddingTop: centered ? 0 : isMobile ? 56 : 24,
                        paddingBottom: centered ? 0 : isMobile ? 188 : 220,
                        WebkitOverflowScrolling: 'touch',
                        overscrollBehaviorY: 'contain',
                    }}
                >
                    <div
                        className="mx-auto flex flex-col"
                        style={{
                            maxWidth: 760,
                            padding: isMobile ? '0 14px' : '0 24px',
                            minHeight: centered ? '100%' : 'auto',
                            justifyContent: centered ? 'center' : 'flex-start',
                        }}
                    >
                        {empty && (
                            <>
                                <PageGreeting
                                    title={GREETINGS[page].title()}
                                    sub={GREETINGS[page].sub}
                                    white={transparent}
                                />
                                {centered && (
                                    <div style={{ marginTop: 28 }}>
                                        {OUTAGE_ACTIVE && !forceEnabled && <OutageNotice />}
                                        <div
                                            aria-disabled={OUTAGE_ACTIVE && !forceEnabled}
                                            style={
                                                OUTAGE_ACTIVE && !forceEnabled
                                                    ? {
                                                        opacity: 0.45,
                                                        filter: 'grayscale(1)',
                                                        pointerEvents: 'none',
                                                        userSelect: 'none',
                                                    }
                                                    : undefined
                                            }
                                        >
                                        <SonomaComposer
                                            value={draft}
                                            onChange={setDraft}
                                            onSend={handleSend}
                                            onStop={stop}
                                            busy={busy}
                                            model={model}
                                            onModelChange={setModel}
                                            models={pageModels}
                                            files={uploaded}
                                            onAddFiles={addFiles}
                                            onRemoveFile={removeFile}
                                            browse={browse}
                                            onToggleBrowse={page === 'code' ? undefined : () => setBrowse((b) => !b)}
                                            reason={reason}
                                            onToggleReason={() => setReason((r) => !r)}
                                            code={codeMode}
                                            onToggleCode={page === 'code' ? undefined : () => setCodeMode((c) => !c)}
                                            deepCode={deepCode}
                                            onToggleDeepCode={page === 'code' ? () => setDeepCode((d) => !d) : undefined}
                                            deepCodeLevel={deepCodeLevel}
                                            onDeepCodeLevelChange={setDeepCodeLevel}
                                            connectors
                                            placeholder={GREETINGS[page].placeholder}
                                            machines={pairedMachines}
                                            mentionedMachine={mentionedMachine}
                                            onMentionMachine={setMentionedMachine}
                                        />
                                        </div>
                                    </div>
                                )}
                                {page === 'agent' && (
                                    <div
                                        style={{
                                            marginTop: 20,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: 8,
                                            padding: '10px 16px',
                                            borderRadius: 12,
                                            border: transparent
                                                ? '1px solid rgba(255,255,255,0.2)'
                                                : '1px solid var(--sonoma-border, rgba(0,0,0,0.1))',
                                            background: transparent
                                                ? 'rgba(0,0,0,0.4)'
                                                : 'var(--sonoma-surface, rgba(0,0,0,0.03))',
                                            color: transparent ? 'rgba(255,255,255,0.85)' : 'var(--sonoma-muted)',
                                            fontSize: 13,
                                            fontWeight: 500,
                                        }}
                                    >
                                        🚧 Agents are under construction — check back soon.
                                    </div>
                                )}
                            </>
                        )}

                        {!empty &&
                            messages.map((m, i) => {
                                if (m.role === 'user') {
                                    return (
                                        <SonomaUserMessage
                                            key={m.id}
                                            content={m.content}
                                            files={m.files}
                                        />
                                    );
                                }
                                const isLast = i === messages.length - 1;
                                return (
                                    <SonomaAssistantMessage
                                        key={m.id}
                                        modelId={m.model}
                                        content={m.content}
                                        thinking={m.thinking}
                                        activity={m.activity}
                                        isStreaming={isLast && busy}
                                        onRegenerate={isLast ? handleRegenerate : undefined}
                                        white={transparent}
                                        onMachineDecision={onMachineDecision(m.id)}
                                    />
                                );
                            })}
                    </div>
                </main>

                {!centered && (
                    <div
                        className="absolute left-0 right-0 bottom-0"
                        style={{
                            padding: isMobile ? '24px 12px 0' : '32px 24px 0',
                            paddingBottom: 'env(safe-area-inset-bottom)',
                            background: transparent
                                ? 'linear-gradient(to top, rgba(0,0,0,0.7) 55%, rgba(0,0,0,0.4) 80%, transparent)'
                                : 'linear-gradient(to top, var(--sonoma-bg) 55%, color-mix(in oklch, var(--sonoma-bg) 85%, transparent) 80%, transparent)',
                        }}
                    >
                        <div style={{ maxWidth: 760, margin: '0 auto', position: 'relative' }}>
                            {!atBottom && (
                                <button
                                    onClick={scrollToBottom}
                                    aria-label="Scroll to latest"
                                    className="sm-pop absolute left-1/2 -translate-x-1/2 inline-flex h-9 w-9 items-center justify-center rounded-full"
                                    style={{
                                        top: -48,
                                        background: 'var(--sonoma-surface)',
                                        border: '1px solid var(--sonoma-border)',
                                        color: 'var(--sonoma-ink-2)',
                                        boxShadow: 'var(--sonoma-shadow-md)',
                                    }}
                                >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="12" y1="5" x2="12" y2="19" />
                                        <polyline points="19 12 12 19 5 12" />
                                    </svg>
                                </button>
                            )}
                            {OUTAGE_ACTIVE && !forceEnabled && <OutageNotice />}
                            <div
                                aria-disabled={OUTAGE_ACTIVE && !forceEnabled}
                                style={
                                    OUTAGE_ACTIVE && !forceEnabled
                                        ? {
                                            opacity: 0.45,
                                            filter: 'grayscale(1)',
                                            pointerEvents: 'none',
                                            userSelect: 'none',
                                        }
                                        : undefined
                                }
                            >
                            <SonomaComposer
                                value={draft}
                                onChange={setDraft}
                                onSend={handleSend}
                                onStop={stop}
                                busy={busy}
                                model={model}
                                onModelChange={setModel}
                                models={pageModels}
                                files={uploaded}
                                onAddFiles={addFiles}
                                onRemoveFile={removeFile}
                                browse={browse}
                                onToggleBrowse={page === 'code' ? undefined : () => setBrowse((b) => !b)}
                                reason={reason}
                                onToggleReason={() => setReason((r) => !r)}
                                code={codeMode}
                                onToggleCode={page === 'code' ? undefined : () => setCodeMode((c) => !c)}
                                deepCode={deepCode}
                                onToggleDeepCode={page === 'code' ? () => setDeepCode((d) => !d) : undefined}
                                deepCodeLevel={deepCodeLevel}
                                onDeepCodeLevelChange={setDeepCodeLevel}
                                connectors
                                machines={pairedMachines}
                                mentionedMachine={mentionedMachine}
                                onMentionMachine={setMentionedMachine}
                            />
                            </div>
                            <div
                                className="py-2.5 text-center"
                                style={{
                                    color: 'var(--sonoma-faint)',
                                    fontSize: 11.5,
                                    padding: '10px 0 14px',
                                }}
                            >
                                Tripplet can make mistakes. Verify important details.
                            </div>
                        </div>
                    </div>
                )}
            </div>
            {passwordRequest && (
                <MachinePasswordDialog
                    command={passwordRequest.command}
                    onCancel={() => setPasswordRequest(null)}
                    onSubmit={(password) => {
                        const req = passwordRequest;
                        setPasswordRequest(null);
                        runApprovedMachine(req.assistantId, req.activityId, req.deviceId, req.command, req.always, password);
                    }}
                />
            )}
        </div>
    );
}

function MachinePasswordDialog({
    command,
    onSubmit,
    onCancel,
}: {
    command: string;
    onSubmit: (password: string) => void;
    onCancel: () => void;
}) {
    const [password, setPassword] = useState('');
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'color-mix(in oklch, var(--sonoma-bg) 55%, rgba(0,0,0,0.6))' }}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onCancel();
            }}
        >
            <form
                className="sm-fadeUp w-full max-w-[380px] rounded-[16px] p-4"
                style={{ background: 'var(--sonoma-bg)', border: '1px solid var(--sonoma-border)', boxShadow: 'var(--sonoma-shadow-lg)' }}
                onSubmit={(e) => {
                    e.preventDefault();
                    if (password) onSubmit(password);
                }}
            >
                <div className="text-[14px] font-semibold" style={{ color: 'var(--sonoma-ink)' }}>
                    Device password required
                </div>
                <div className="mt-1 text-[12.5px]" style={{ color: 'var(--sonoma-muted)' }}>
                    To run <code style={{ fontFamily: 'var(--font-mono)' }}>{command}</code>, enter this machine&apos;s OpenSonoma password.
                </div>
                <input
                    autoFocus
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-3 w-full rounded-[10px] px-3 py-2 text-[14px] outline-none"
                    style={{ background: 'var(--sonoma-bg-2)', border: '1px solid var(--sonoma-border)', color: 'var(--sonoma-ink)' }}
                />
                <div className="mt-3 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-full px-3.5 py-1.5 text-[12.5px] font-medium"
                        style={{ border: '1px solid var(--sonoma-border)', color: 'var(--sonoma-ink-2)', background: 'transparent' }}
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={!password}
                        className="rounded-full px-3.5 py-1.5 text-[12.5px] font-medium"
                        style={{ background: 'var(--sonoma-accent)', color: 'var(--sonoma-accent-ink, #fff)', opacity: password ? 1 : 0.5 }}
                    >
                        Run
                    </button>
                </div>
            </form>
        </div>
    );
}
