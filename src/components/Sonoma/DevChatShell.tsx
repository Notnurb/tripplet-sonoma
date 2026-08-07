'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CHAT_MODELS } from '@/lib/ai/models';
import { loadSettings, SETTINGS_EVENT } from '@/lib/settings';
import { runBash, isVmDownloaded, bootVm } from '@/lib/sandbox/trippletLinux';
import { readSonomaStream, mergeActivity, finishBashActivity, updateBashActivity } from '@/lib/sonoma/stream';
import SonomaComposer from './Composer';
import { SonomaUserMessage, SonomaAssistantMessage, type SonomaActivity } from './Message';

// The /dev workspace is deliberately self-contained: it does NOT use
// ChatContext, so it shares no conversation history or state with /chat, /code,
// etc. It keeps its own in-memory message list and talks to /api/sonoma
// directly, optionally routed through a user-supplied Groq key + model id.

type UploadedFile = { id: string; file: File; preview?: string; name: string; kb: number };

interface UIMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    model?: string;
    thinking?: string;
    activity: SonomaActivity[];
    files?: { id: string; name: string; preview?: string; type: 'image' | 'file' }[];
}

function newId(prefix: string) {
    return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export default function DevChatShell() {
    const [apiKey, setApiKey] = useState('');
    const [modelId, setModelId] = useState('');
    const [targetPersona, setTargetPersona] = useState(CHAT_MODELS[0]?.id ?? '');
    const [panelOpen, setPanelOpen] = useState(true);

    const [model, setModel] = useState<string>(CHAT_MODELS[0]?.id ?? '');
    const [draft, setDraft] = useState('');
    const [uploaded, setUploaded] = useState<UploadedFile[]>([]);
    const [messages, setMessages] = useState<UIMessage[]>([]);
    const [busy, setBusy] = useState(false);
    const [browse, setBrowse] = useState(false);
    const [reason, setReason] = useState(false);
    const [codeMode, setCodeMode] = useState(false);
    const [sandboxEnabled, setSandboxEnabled] = useState(false);

    const abortRef = useRef<AbortController | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const bashRunRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        // The skill is only live when enabled in Settings AND the VM has been
        // downloaded (its runtime is ~12 MB and fetched on demand).
        const sync = () => {
            const live = loadSettings().sandboxedLinux && isVmDownloaded();
            setSandboxEnabled(live);
            // Warm the VM ahead of the first run_bash (see ChatShell).
            if (live) void bootVm().catch(() => { /* surfaces on first run */ });
        };
        sync();
        window.addEventListener(SETTINGS_EVENT, sync);
        return () => window.removeEventListener(SETTINGS_EVENT, sync);
    }, []);

    const overrideActive = apiKey.trim().length > 0 && modelId.trim().length > 0;

    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages.length, messages[messages.length - 1]?.content, messages[messages.length - 1]?.thinking]);

    const addFiles = useCallback((list: File[]) => {
        Promise.all(
            list.map(async (f) => ({
                id: newId('f'),
                file: f,
                preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined,
                name: f.name,
                kb: Math.max(1, Math.round(f.size / 1024)),
            })),
        ).then((atts) => setUploaded((u) => [...u, ...atts]));
    }, []);

    const removeFile = useCallback((id: string) => {
        setUploaded((u) => {
            const found = u.find((x) => x.id === id);
            if (found?.preview) URL.revokeObjectURL(found.preview);
            return u.filter((x) => x.id !== id);
        });
    }, []);

    const stop = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setBusy(false);
    }, []);

    // Execute a run_bash tool call headlessly in the real Linux VM and patch the
    // matching activity card with the actual stdout — same inline UI as Python.
    const execBash = useCallback((assistantId: string, activityId: string, command: string) => {
        if (bashRunRef.current.has(activityId)) return;
        bashRunRef.current.add(activityId);
        setMessages((prev) => prev.map((m) => {
            if (m.id !== assistantId) return m;
            return { ...m, activity: m.activity.map((a) => a.id === activityId ? { ...a, status: 'running' } : a) };
        }));
        runBash(command, (partial) => {
            setMessages((prev) => prev.map((m) =>
                m.id === assistantId ? { ...m, activity: updateBashActivity(m.activity, activityId, partial) } : m,
            ));
        }).then((output) => {
            setMessages((prev) => prev.map((m) =>
                m.id === assistantId ? { ...m, activity: finishBashActivity(m.activity, activityId, output) } : m,
            ));
        });
    }, []);

    const runAgent = useCallback(
        async (history: UIMessage[], assistantId: string) => {
            const ctrl = new AbortController();
            abortRef.current = ctrl;
            setBusy(true);

            const payload = {
                messages: history.map((m) => ({ role: m.role, content: m.content })),
                reason,
                browse,
                code: codeMode,
                page: 'chat' as const,
                model,
                sandbox: sandboxEnabled,
                // Auth for the override rides on the HttpOnly dev_unlock cookie
                // (set by the password gate) — no secret in the payload.
                ...(overrideActive ? { dev: { apiKey, modelId } } : {}),
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
                    let detail = txt.slice(0, 200);
                    try { detail = String(JSON.parse(txt).error ?? detail); } catch { /* plain text */ }
                    throw new Error(`sonoma ${res.status}: ${detail}`);
                }

                await readSonomaStream(res.body, {
                    onThinking: (delta) =>
                        setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, thinking: (m.thinking ?? '') + delta } : m)),
                    onContent: (delta) =>
                        setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: m.content + delta } : m)),
                    onActivity: (ev) => {
                        setMessages((prev) => prev.map((m) =>
                            m.id === assistantId ? { ...m, activity: mergeActivity(m.activity, ev) } : m,
                        ));
                        if (ev.tool === 'run_bash') execBash(assistantId, ev.id, String(ev.args?.command ?? ''));
                    },
                    onError: (message) =>
                        setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: m.content + `\n\n_Error: ${message}_` } : m)),
                });
            } catch (e) {
                if (ctrl.signal.aborted) {
                    setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: m.content || '(stopped)' } : m));
                } else {
                    const msg = e instanceof Error ? e.message : 'Unknown error';
                    setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: m.content + `\n\n_${msg}_` } : m));
                }
            } finally {
                abortRef.current = null;
                setBusy(false);
            }
        },
        [browse, reason, codeMode, model, overrideActive, apiKey, modelId, sandboxEnabled, execBash],
    );

    const handleSend = useCallback(async () => {
        if (busy) return;
        const text = draft.trim();
        if (!text && uploaded.length === 0) return;

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
        const assistantMessage: UIMessage = { id: newId('a'), role: 'assistant', content: '', model, activity: [] };
        const next = [...messages, userMessage, assistantMessage];
        setMessages(next);
        setDraft('');
        setUploaded([]);
        await runAgent(next.slice(0, -1), assistantMessage.id);
    }, [busy, draft, uploaded, messages, model, runAgent]);

    const handleRegenerate = useCallback(() => {
        if (busy) return;
        const lastUserIdx = [...messages].map((m, i) => ({ m, i })).reverse().find((x) => x.m.role === 'user')?.i;
        if (lastUserIdx === undefined) return;
        const history = messages.slice(0, lastUserIdx + 1);
        const assistantMessage: UIMessage = { id: newId('a'), role: 'assistant', content: '', model, activity: [] };
        setMessages([...history, assistantMessage]);
        void runAgent(history, assistantMessage.id);
    }, [busy, messages, model, runAgent]);

    const empty = messages.length === 0 && !busy;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1, background: 'var(--sonoma-bg)' }}>
            {/* Dev control bar */}
            <div style={{ borderBottom: '1px solid var(--sonoma-border)', background: 'var(--sonoma-surface)', fontFamily: 'var(--font-sans)', fontSize: 12.5, flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer' }} onClick={() => setPanelOpen((o) => !o)}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: overrideActive ? 'var(--sonoma-ok)' : 'var(--sonoma-muted)', flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, color: 'var(--sonoma-ink)' }}>/dev</span>
                    <span style={{ color: 'var(--sonoma-muted)' }}>
                        {overrideActive
                            ? `Groq override active — "${CHAT_MODELS.find((m) => m.id === targetPersona)?.name}" routes to your key + model id`
                            : 'Standalone chat — separate from /chat history'}
                    </span>
                    <span style={{ marginLeft: 'auto', color: 'var(--sonoma-muted)' }}>{panelOpen ? '▲' : '▼'}</span>
                </div>
                {panelOpen && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '0 14px 12px', alignItems: 'center' }}>
                        <select
                            value={targetPersona}
                            onChange={(e) => { setTargetPersona(e.target.value); setModel(e.target.value); }}
                            style={fieldStyle}
                        >
                            {CHAT_MODELS.map((m) => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                        </select>
                        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Groq API key" style={{ ...fieldStyle, flex: '1 1 200px' }} />
                        <input type="text" value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="Groq model id (e.g. llama-3.3-70b-versatile)" style={{ ...fieldStyle, flex: '1 1 240px' }} />
                        {overrideActive && (
                            <button
                                onClick={() => { setApiKey(''); setModelId(''); }}
                                style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--sonoma-border)', background: 'transparent', color: 'var(--sonoma-muted)', fontSize: 12.5, cursor: 'pointer' }}
                            >
                                Clear
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="sonoma-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 24px 200px', display: 'flex', flexDirection: 'column', minHeight: '100%', justifyContent: empty ? 'center' : 'flex-start' }}>
                    {empty && (
                        <div className="sm-fadeUp" style={{ textAlign: 'center', marginBottom: 28 }}>
                            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(30px, 4vw, 46px)', color: 'var(--sonoma-ink)', letterSpacing: '-0.02em' }}>
                                /dev workspace
                            </div>
                            <div style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 'clamp(17px, 2.2vw, 24px)', color: 'var(--sonoma-muted)', marginTop: 6 }}>
                                A private chat, separate from everything else.
                            </div>
                        </div>
                    )}
                    {messages.map((m, i) => {
                        if (m.role === 'user') return <SonomaUserMessage key={m.id} content={m.content} files={m.files} />;
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
                            />
                        );
                    })}
                </div>
            </div>

            {/* Composer */}
            <div style={{ borderTop: '1px solid var(--sonoma-border)', background: 'var(--sonoma-bg)', flexShrink: 0 }}>
                <div style={{ maxWidth: 760, margin: '0 auto', padding: '14px 24px', paddingBottom: 'max(14px, env(safe-area-inset-bottom))' }}>
                    <SonomaComposer
                        value={draft}
                        onChange={setDraft}
                        onSend={handleSend}
                        onStop={stop}
                        busy={busy}
                        model={model}
                        onModelChange={setModel}
                        models={CHAT_MODELS}
                        files={uploaded}
                        onAddFiles={addFiles}
                        onRemoveFile={removeFile}
                        browse={browse}
                        onToggleBrowse={() => setBrowse((b) => !b)}
                        reason={reason}
                        onToggleReason={() => setReason((r) => !r)}
                        code={codeMode}
                        onToggleCode={() => setCodeMode((c) => !c)}
                        placeholder="Message the /dev workspace…"
                    />
                    <div style={{ textAlign: 'center', color: 'var(--sonoma-faint)', fontSize: 11.5, padding: '8px 0 2px' }}>
                        Isolated dev surface. Tripplet can make mistakes.
                    </div>
                </div>
            </div>

        </div>
    );
}

const fieldStyle: React.CSSProperties = {
    padding: '7px 10px',
    borderRadius: 8,
    border: '1px solid var(--sonoma-border)',
    background: 'var(--sonoma-bg)',
    color: 'var(--sonoma-ink)',
    fontSize: 12.5,
};
