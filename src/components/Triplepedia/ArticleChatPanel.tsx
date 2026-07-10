'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Loader2, Trash2, X, Check, ChevronDown, Sparkles, Square, Copy, CornerDownLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { CHAT_MODELS } from '@/lib/ai/models';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ArticleContext {
    title: string;
    summary: string;
    sections: Array<{
        heading: string;
        content?: string;
        subheadings?: Array<{ heading: string; content: string }>;
    }>;
}

/** A request from the article surface to ask about a specific passage. */
export interface AskRequest {
    /** The prompt to seed the composer with. */
    prompt: string;
    /** Bumps on every request so identical passages still re-trigger. */
    nonce: number;
    /** When true, send immediately instead of waiting for the user. */
    autoSend?: boolean;
}

interface ArticleChatPanelProps {
    article: ArticleContext;
    open: boolean;
    onClose: () => void;
    /** External ask requests (e.g. "ask about this selection"). */
    ask?: AskRequest | null;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

const REMARK_PLUGINS = [remarkGfm];
const DEFAULT_MODEL = CHAT_MODELS[0]?.id ?? 'astro-5';

// Bump when the persisted shape changes so stale entries are ignored.
const STORE_VERSION = 1;
const storageKey = (title: string) => `tp-article-chat:${STORE_VERSION}:${title}`;

// Flatten the article into a compact grounding block sent to the model.
function buildArticleContext(article: ArticleContext): string {
    const lines: string[] = [
        `You are Tripplet, answering questions about the following Triplepedia article. Ground every answer in this content first; you may add relevant background knowledge, but never contradict the article. Be concise, accurate, and use markdown.`,
        ``,
        `# ${article.title}`,
        ``,
        article.summary,
    ];

    for (const section of article.sections) {
        lines.push(``, `## ${section.heading}`);
        if (section.content) lines.push(section.content);
        for (const sub of section.subheadings ?? []) {
            lines.push(``, `### ${sub.heading}`, sub.content);
        }
    }

    return lines.join('\n');
}

// Derive grounded starter questions from the article's own structure so the
// suggestions feel specific to what the reader is looking at.
function buildSuggestions(article: ArticleContext): string[] {
    const fromSections = article.sections
        .map((s) => s.heading?.trim())
        .filter(Boolean)
        .slice(0, 2)
        .map((h) => `What does this article say about ${h!.toLowerCase()}?`);

    return ['Give me a quick summary', 'What are the key takeaways?', ...fromSections].slice(0, 4);
}

const markdownComponents = {
    p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
    ul: ({ children }: { children?: React.ReactNode }) => <ul className="mb-2 list-disc pl-5 space-y-1">{children}</ul>,
    ol: ({ children }: { children?: React.ReactNode }) => <ol className="mb-2 list-decimal pl-5 space-y-1">{children}</ol>,
    li: ({ children }: { children?: React.ReactNode }) => <li className="leading-relaxed">{children}</li>,
    h1: ({ children }: { children?: React.ReactNode }) => <h1 className="mb-2 mt-3 text-base font-semibold">{children}</h1>,
    h2: ({ children }: { children?: React.ReactNode }) => <h2 className="mb-2 mt-3 text-[15px] font-semibold">{children}</h2>,
    h3: ({ children }: { children?: React.ReactNode }) => <h3 className="mb-1 mt-2 text-sm font-semibold">{children}</h3>,
    strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-foreground">{children}</strong>,
    a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
        <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 hover:opacity-80">{children}</a>
    ),
    code: ({ children }: { children?: React.ReactNode }) => (
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>
    ),
    pre: ({ children }: { children?: React.ReactNode }) => (
        <pre className="mb-2 overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 text-[0.85em]">{children}</pre>
    ),
};

export function ArticleChatPanel({ article, open, onClose, ask }: ArticleChatPanelProps) {
    const [mounted, setMounted] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [model, setModel] = useState<string>(DEFAULT_MODEL);
    const [isGenerating, setIsGenerating] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [hydrated, setHydrated] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const lastAskNonce = useRef<number>(-1);

    useEffect(() => setMounted(true), []);

    // Load any persisted conversation for this article once on mount / article change.
    useEffect(() => {
        setHydrated(false);
        try {
            const raw = localStorage.getItem(storageKey(article.title));
            if (raw) {
                const parsed = JSON.parse(raw) as { model?: string; messages?: ChatMessage[] };
                if (Array.isArray(parsed.messages)) setMessages(parsed.messages);
                if (parsed.model && CHAT_MODELS.some((m) => m.id === parsed.model)) setModel(parsed.model);
            } else {
                setMessages([]);
            }
        } catch {
            setMessages([]);
        }
        setHydrated(true);
    }, [article.title]);

    // Persist the conversation whenever it changes (after hydration so we don't clobber).
    useEffect(() => {
        if (!hydrated) return;
        try {
            if (messages.length === 0) {
                localStorage.removeItem(storageKey(article.title));
            } else {
                localStorage.setItem(storageKey(article.title), JSON.stringify({ model, messages }));
            }
        } catch { /* storage full / unavailable — non-fatal */ }
    }, [messages, model, hydrated, article.title]);

    useEffect(() => {
        if (!open) return;
        const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handle);
        return () => window.removeEventListener('keydown', handle);
    }, [onClose, open]);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const autoGrow = () => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    };

    const selectedModelName = CHAT_MODELS.find((m) => m.id === model)?.name ?? 'Astro 5';
    const suggestions = useMemo(() => buildSuggestions(article), [article]);

    const send = async (content: string) => {
        const trimmed = content.trim();
        if (!trimmed || isGenerating) return;

        const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: trimmed };
        const assistantId = crypto.randomUUID();
        const priorHistory = messages.map((m) => ({ role: m.role, content: m.content }));

        setMessages((prev) => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '' }]);
        setInput('');
        requestAnimationFrame(autoGrow);
        setIsGenerating(true);
        abortRef.current = new AbortController();

        try {
            // Article context is injected as a synthetic opening exchange in the
            // messages array rather than via systemPromptOverride — the chat API
            // drops the override for guest sessions, but user/assistant turns are
            // always forwarded, so the model gets the article context either way.
            const groundingTurns = [
                { role: 'user' as const, content: buildArticleContext(article) },
                { role: 'assistant' as const, content: `I've read the full article on "${article.title}". Ask me anything about it.` },
            ];

            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: abortRef.current.signal,
                body: JSON.stringify({
                    messages: [...groundingTurns, ...priorHistory, { role: 'user', content: trimmed }],
                    model,
                    webSearch: false,
                    conversationId: null,
                }),
            });

            if (!res.ok || !res.body) throw new Error('API error');

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let accumulated = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') break;
                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta?.content ?? '';
                        if (delta) {
                            accumulated += delta;
                            setMessages((prev) =>
                                prev.map((m) => (m.id === assistantId ? { ...m, content: accumulated } : m)),
                            );
                        }
                    } catch { /* ignore parse errors */ }
                }
            }

            // If the stream closed without producing anything, surface it rather
            // than leaving an empty bubble spinning forever.
            if (!accumulated) {
                setMessages((prev) =>
                    prev.map((m) => (m.id === assistantId ? { ...m, content: '_No response — please try again._' } : m)),
                );
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                setMessages((prev) =>
                    prev.map((m) => (m.id === assistantId ? { ...m, content: 'Something went wrong. Please try again.' } : m)),
                );
            } else {
                // Aborted mid-stream — drop the empty placeholder if nothing arrived.
                setMessages((prev) =>
                    prev.filter((m) => !(m.id === assistantId && m.content === '')),
                );
            }
        } finally {
            setIsGenerating(false);
            abortRef.current = null;
        }
    };

    // React to external "ask about this passage" requests.
    useEffect(() => {
        if (!ask || ask.nonce === lastAskNonce.current) return;
        lastAskNonce.current = ask.nonce;
        if (ask.autoSend) {
            void send(ask.prompt);
        } else {
            setInput(ask.prompt);
            requestAnimationFrame(() => {
                autoGrow();
                textareaRef.current?.focus();
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ask]);

    const stop = () => {
        abortRef.current?.abort();
        setIsGenerating(false);
    };

    const handleClear = () => {
        abortRef.current?.abort();
        setMessages([]);
        setIsGenerating(false);
    };

    const handleCopy = async (m: ChatMessage) => {
        try {
            await navigator.clipboard.writeText(m.content);
            setCopiedId(m.id);
            setTimeout(() => setCopiedId((id) => (id === m.id ? null : id)), 1500);
        } catch { /* clipboard blocked — ignore */ }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send(input);
        }
    };

    const content = (
        <AnimatePresence>
            {open && (
                <>
                    {/* Mobile-only scrim; on desktop the panel is docked and the article stays interactive. */}
                    <motion.div
                        key="scrim"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        onClick={onClose}
                        className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm lg:hidden"
                    />

                    <motion.aside
                        key="panel"
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                        className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col border-l border-border bg-card text-foreground shadow-2xl sm:w-[440px]"
                        role="dialog"
                        aria-label={`Ask about ${article.title}`}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                            <div className="flex min-w-0 items-center gap-2.5">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                    <Sparkles size={17} />
                                </div>
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold leading-tight">Ask about this article</p>
                                    <p className="truncate text-xs text-muted-foreground">{article.title}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-1">
                                {messages.length > 0 && (
                                    <button
                                        onClick={handleClear}
                                        title="Clear conversation"
                                        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                )}
                                <button
                                    onClick={onClose}
                                    title="Close (Esc)"
                                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto px-4 py-4">
                            {messages.length === 0 ? (
                                <div className="flex h-full flex-col items-center justify-center text-center">
                                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                                        <Sparkles size={30} />
                                    </div>
                                    <h3 className="mb-1.5 text-lg font-semibold">Ask about this article</h3>
                                    <p className="mb-6 max-w-xs text-sm text-muted-foreground">
                                        I&apos;ve read the full article on <span className="font-medium text-foreground">{article.title}</span>. Ask me anything — or highlight a passage to ask about it.
                                    </p>
                                    <div className="flex w-full flex-col gap-2">
                                        {suggestions.map((s) => (
                                            <button
                                                key={s}
                                                onClick={() => void send(s)}
                                                className="w-full rounded-xl border border-border bg-muted/30 px-3.5 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                                            >
                                                {s}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <AnimatePresence initial={false}>
                                        {messages.map((m) => (
                                            <motion.div
                                                key={m.id}
                                                initial={{ opacity: 0, y: 8 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ duration: 0.18 }}
                                                className={cn('group flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}
                                            >
                                                <div
                                                    className={cn(
                                                        'max-w-[88%] rounded-2xl px-4 py-2.5 text-sm',
                                                        m.role === 'user'
                                                            ? 'bg-primary text-primary-foreground'
                                                            : 'bg-muted/60 text-foreground',
                                                    )}
                                                >
                                                    {m.role === 'assistant' ? (
                                                        m.content ? (
                                                            <div className="text-sm">
                                                                <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>
                                                                    {m.content}
                                                                </ReactMarkdown>
                                                            </div>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                                                <Loader2 size={14} className="animate-spin" /> Thinking…
                                                            </span>
                                                        )
                                                    ) : (
                                                        <p className="whitespace-pre-wrap">{m.content}</p>
                                                    )}
                                                </div>
                                                {m.role === 'assistant' && m.content && (
                                                    <button
                                                        onClick={() => void handleCopy(m)}
                                                        className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground/70 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                                                    >
                                                        {copiedId === m.id ? (
                                                            <><Check size={11} /> Copied</>
                                                        ) : (
                                                            <><Copy size={11} /> Copy</>
                                                        )}
                                                    </button>
                                                )}
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                    <div ref={endRef} />
                                </div>
                            )}
                        </div>

                        {/* Input */}
                        <form
                            onSubmit={(e) => { e.preventDefault(); void send(input); }}
                            className="border-t border-border p-3"
                        >
                            <div className="mb-2 flex items-center justify-between px-1">
                                <DropdownMenu>
                                    <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted">
                                        {selectedModelName}
                                        <ChevronDown size={13} className="opacity-50" />
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className="min-w-[200px]">
                                        {CHAT_MODELS.map((m) => (
                                            <DropdownMenuItem
                                                key={m.id}
                                                onClick={() => setModel(m.id)}
                                                className="flex items-center justify-between gap-3"
                                            >
                                                <div className="flex flex-col">
                                                    <span className="text-sm">{m.name}</span>
                                                    <span className="text-[11px] text-muted-foreground">{m.description}</span>
                                                </div>
                                                {model === m.id && <Check size={15} className="shrink-0 text-primary" />}
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <span className="hidden items-center gap-1 text-[11px] text-muted-foreground/50 sm:flex">
                                    <CornerDownLeft size={11} /> to send
                                </span>
                            </div>
                            <div className="relative">
                                <textarea
                                    ref={textareaRef}
                                    value={input}
                                    onChange={(e) => { setInput(e.target.value); autoGrow(); }}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Ask about this article…"
                                    rows={1}
                                    className={cn(
                                        'max-h-[160px] min-h-[52px] w-full resize-none rounded-xl border border-border bg-muted/40 px-4 py-3.5 pr-12 text-sm text-foreground placeholder:text-muted-foreground/60',
                                        'focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20',
                                    )}
                                />
                                {isGenerating ? (
                                    <button
                                        type="button"
                                        onClick={stop}
                                        title="Stop generating"
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg bg-muted p-2 text-foreground transition-colors hover:bg-muted/70"
                                    >
                                        <Square size={15} className="fill-current" />
                                    </button>
                                ) : (
                                    <button
                                        type="submit"
                                        disabled={!input.trim()}
                                        className={cn(
                                            'absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-2 transition-all',
                                            input.trim()
                                                ? 'bg-primary text-primary-foreground hover:opacity-90'
                                                : 'cursor-not-allowed bg-muted text-muted-foreground/40',
                                        )}
                                    >
                                        <Send size={16} />
                                    </button>
                                )}
                            </div>
                        </form>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    );

    if (!mounted) return null;
    return createPortal(content, document.body);
}
