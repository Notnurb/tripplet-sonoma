'use client';

// Presentational panels for the Multi-Agent Workspace: the SubAgent creation
// modal, the sidebar stat/help/cost/compare cards, the inline slash-command
// picker, and the per-agent status bar. All are prop-driven — the page owns the
// state; these just render it.

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    type AgentSession,
    MODEL_META,
    DEFAULT_MODEL,
    SLASH_COMMANDS,
    getCommandUsage,
    estimateTokens,
    formatElapsed,
    createSession,
} from '../_lib/agents-core';

// ─── CreateSubAgentModal ──────────────────────────────────────────────────────

interface CreateSubAgentModalProps {
    onClose: () => void;
    onCreate: (session: AgentSession) => void;
    initialName?: string;
}

export function CreateSubAgentModal({ onClose, onCreate, initialName = '' }: CreateSubAgentModalProps) {
    const [name, setName]         = useState(initialName);
    const [purpose, setPurpose]   = useState('');
    const [sysprompt, setSysprompt] = useState('');
    const [model, setModel]       = useState(DEFAULT_MODEL);
    const [generating, setGenerating] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    // Generate a system prompt from the purpose field via /api/chat streaming
    const generateSystemPrompt = useCallback(async () => {
        if (!purpose.trim()) return;
        setGenerating(true);
        setSysprompt('');
        abortRef.current = new AbortController();
        try {
            const meta = `Write a focused system prompt for an AI agent whose purpose is: ${purpose}. Be specific, under 200 words. Return only the system prompt text, no preamble.`;
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: meta }],
                    model,
                    activeModes: [],
                    activeTone: null,
                }),
                signal: abortRef.current.signal,
            });
            if (!res.ok || !res.body) { setGenerating(false); return; }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let accumulated = '';
            let buf = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                const lines = buf.split('\n');
                buf = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const raw = line.slice(6).trim();
                    if (raw === '[DONE]') break;
                    try {
                        const parsed = JSON.parse(raw) as { content?: string; type?: string; error?: string };
                        if (parsed.error) { setSysprompt(`Error: ${parsed.error}`); break; }
                        if (parsed.type || !parsed.content) continue;
                        accumulated += parsed.content;
                        setSysprompt(accumulated);
                    } catch { /* skip malformed chunk */ }
                }
            }
        } catch (e) {
            if ((e as { name?: string }).name !== 'AbortError') {
                setSysprompt('Failed to generate. Please type your system prompt manually.');
            }
        } finally {
            setGenerating(false);
        }
    }, [purpose, model]);

    const handleCreate = useCallback(() => {
        if (!name.trim()) return;
        onCreate(createSession({
            name: name.trim(),
            systemPrompt: sysprompt.trim() || `You are a specialized AI assistant. Purpose: ${purpose}`,
            model,
            isSubAgent: true,
            subAgentPurpose: purpose.trim(),
        }));
        onClose();
    }, [name, sysprompt, purpose, model, onCreate, onClose]);

    // Cleanup streaming on unmount
    useEffect(() => () => { abortRef.current?.abort(); }, []);

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-card border border-border rounded-xl w-full max-w-lg shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
                    <h2 className="font-bold text-foreground text-base">Create SubAgent</h2>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                        <X size={16} />
                    </button>
                </div>

                <div className="px-5 py-4 flex flex-col gap-4">
                    {/* Name */}
                    <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5 block">Name</label>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Research Agent"
                            className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-foreground/30 transition-colors"
                        />
                    </div>

                    {/* Purpose */}
                    <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5 block">Purpose</label>
                        <input
                            value={purpose}
                            onChange={(e) => setPurpose(e.target.value)}
                            placeholder="What will this agent specialize in?"
                            className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-foreground/30 transition-colors"
                        />
                    </div>

                    {/* System Prompt */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">System Prompt</label>
                            <button
                                onClick={generateSystemPrompt}
                                disabled={!purpose.trim() || generating}
                                className={cn(
                                    'text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors',
                                    purpose.trim() && !generating
                                        ? 'bg-foreground text-background hover:opacity-80'
                                        : 'text-muted-foreground/40 cursor-not-allowed'
                                )}
                            >
                                {generating ? 'Generating...' : 'Generate with Tripplet'}
                            </button>
                        </div>
                        <textarea
                            value={sysprompt}
                            onChange={(e) => setSysprompt(e.target.value)}
                            placeholder="Describe how this agent should behave, what it knows, and its constraints..."
                            rows={5}
                            className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-foreground/30 transition-colors resize-none"
                        />
                    </div>

                    {/* Model selector */}
                    <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5 block">Model</label>
                        <div className="flex gap-2">
                            {Object.entries(MODEL_META).map(([id, meta]) => (
                                <button
                                    key={id}
                                    onClick={() => setModel(id)}
                                    className={cn(
                                        'flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                                        model === id
                                            ? 'border-foreground/40 bg-foreground/10 text-foreground'
                                            : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/20'
                                    )}
                                >
                                    {meta.displayName}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2 px-5 pb-5">
                    <button onClick={onClose} className="px-4 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors">
                        Cancel
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={!name.trim()}
                        className={cn(
                            'px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors',
                            name.trim()
                                ? 'bg-foreground text-background hover:opacity-80'
                                : 'bg-muted text-muted-foreground/40 cursor-not-allowed'
                        )}
                    >
                        Create
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── StatsCard ────────────────────────────────────────────────────────────────

export function StatsCard({ sessions }: { sessions: AgentSession[] }) {
    const totalMessages = sessions.reduce((s, a) => s + a.messages.length, 0);
    const totalInputTokens = sessions.reduce((s, a) => s + a.inputTokens, 0);
    const totalOutputTokens = sessions.reduce((s, a) => s + a.outputTokens, 0);
    const totalCost = sessions.reduce((sum, a) => {
        const meta = MODEL_META[a.model] ?? MODEL_META[DEFAULT_MODEL];
        return sum + (a.inputTokens / 1e6 * meta.inputPricePerM) + (a.outputTokens / 1e6 * meta.outputPricePerM);
    }, 0);

    const modelUsage = sessions.reduce<Record<string, number>>((acc, a) => {
        acc[a.model] = (acc[a.model] ?? 0) + a.messages.length;
        return acc;
    }, {});
    const mostUsedModel = Object.entries(modelUsage).sort((a, b) => b[1] - a[1])[0]?.[0];

    const longestSessionMs = sessions.reduce((max, s) => {
        const dur = Date.now() - s.sessionStart.getTime();
        return dur > max ? dur : max;
    }, 0);

    return (
        <div className="mx-4 my-2 rounded-xl border border-border bg-muted/20 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-3">Session Stats</p>
            <div className="grid grid-cols-2 gap-3">
                {[
                    { label: 'Agents', value: sessions.length },
                    { label: 'Messages', value: totalMessages },
                    { label: 'Input Tokens', value: totalInputTokens.toLocaleString() },
                    { label: 'Output Tokens', value: totalOutputTokens.toLocaleString() },
                    { label: 'Total Cost', value: `$${totalCost.toFixed(2)}` },
                    { label: 'Most Used', value: mostUsedModel ? MODEL_META[mostUsedModel]?.displayName ?? mostUsedModel : '—' },
                    { label: 'Longest Session', value: formatElapsed(longestSessionMs) },
                ].map(({ label, value }) => (
                    <div key={label} className="flex flex-col">
                        <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">{label}</span>
                        <span className="text-sm font-semibold text-foreground">{value}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── HelpCard ─────────────────────────────────────────────────────────────────

export function HelpCard() {
    return (
        <div className="mx-4 my-2 rounded-xl border border-border bg-muted/20 p-4 max-h-80 overflow-y-auto">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-3">Commands</p>
            <div className="flex flex-col gap-1">
                {SLASH_COMMANDS.map((cmd) => (
                    <div key={cmd.name} className="flex items-baseline gap-2">
                        <span className="font-mono text-[12px] font-semibold text-foreground min-w-[130px]">
                            {cmd.name} <span className="text-muted-foreground/50 font-normal">{cmd.args}</span>
                        </span>
                        <span className="text-[11px] text-muted-foreground/60">{cmd.description}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── CostCard ─────────────────────────────────────────────────────────────────

export function CostCard({ agent }: { agent: AgentSession }) {
    const meta = MODEL_META[agent.model] ?? MODEL_META[DEFAULT_MODEL];
    const cost = (agent.inputTokens / 1e6 * meta.inputPricePerM) + (agent.outputTokens / 1e6 * meta.outputPricePerM);

    return (
        <div className="mx-4 my-2 rounded-xl border border-border bg-muted/20 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-3">Cost Breakdown — {agent.name}</p>
            <div className="grid grid-cols-2 gap-3">
                {[
                    { label: 'Model', value: meta.displayName },
                    { label: 'Input tokens', value: agent.inputTokens.toLocaleString() },
                    { label: 'Output tokens', value: agent.outputTokens.toLocaleString() },
                    { label: 'Input cost', value: `$${(agent.inputTokens / 1e6 * meta.inputPricePerM).toFixed(2)}` },
                    { label: 'Output cost', value: `$${(agent.outputTokens / 1e6 * meta.outputPricePerM).toFixed(2)}` },
                    { label: 'Total', value: `$${cost.toFixed(2)}` },
                ].map(({ label, value }) => (
                    <div key={label} className="flex flex-col">
                        <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">{label}</span>
                        <span className="text-sm font-semibold text-foreground">{value}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── CompareCard ──────────────────────────────────────────────────────────────

export function CompareCard({ sessions }: { sessions: AgentSession[] }) {
    const sessionsWithReplies = sessions.filter(
        (s) => s.messages.some((m) => m.role === 'assistant')
    );

    if (sessionsWithReplies.length < 2) {
        return (
            <div className="mx-4 my-2 rounded-xl border border-border bg-muted/20 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">Compare</p>
                <p className="text-xs text-muted-foreground/50">Need at least 2 agents with responses to compare.</p>
            </div>
        );
    }

    return (
        <div className="mx-4 my-2 rounded-xl border border-border bg-muted/20 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-3">Compare — Last Responses</p>
            <div className="flex flex-col gap-3">
                {sessionsWithReplies.map((s) => {
                    const lastReply = [...s.messages].reverse().find((m) => m.role === 'assistant');
                    if (!lastReply) return null;
                    return (
                        <div key={s.id} className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold text-foreground/70">{s.name}</span>
                            <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap">
                                {lastReply.content.slice(0, 400)}{lastReply.content.length > 400 ? '...' : ''}
                            </p>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── InlineCommandPicker (above InputBox) ────────────────────────────────────

interface InlineCommandPickerProps {
    filter: string;
    onSelect: (cmd: string) => void;
    selectedIndex: number;
}

export function InlineCommandPicker({ filter, onSelect, selectedIndex }: InlineCommandPickerProps) {
    const usage = useMemo(() => getCommandUsage(), []);
    const listRef = useRef<HTMLDivElement>(null);

    const filtered = useMemo(() => {
        const q = filter.toLowerCase().replace(/^\//, '');
        const matches = SLASH_COMMANDS.filter(
            (c) => c.name.slice(1).startsWith(q) || c.description.toLowerCase().includes(q)
        );
        // Sort: most-used first, then alphabetical
        return matches.sort((a, b) => {
            const ua = usage[a.name] ?? 0;
            const ub = usage[b.name] ?? 0;
            if (ub !== ua) return ub - ua;
            return a.name.localeCompare(b.name);
        });
    }, [filter, usage]);

    // Scroll selected item into view
    useEffect(() => {
        const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
        el?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    if (filtered.length === 0) return null;

    // Show "Most Used" divider
    const hasFrequent = Object.values(usage).some((v) => v > 0);

    return (
        <div className="absolute bottom-full left-0 right-0 mb-1 mx-auto max-w-3xl z-50">
            <div className="bg-card border border-border rounded-lg shadow-2xl max-h-64 overflow-y-auto" ref={listRef}>
                {hasFrequent && filtered.some((c) => (usage[c.name] ?? 0) > 0) && (
                    <div className="px-3 pt-2 pb-1">
                        <span className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-semibold">Most Used</span>
                    </div>
                )}
                {filtered.map((cmd, i) => {
                    const Icon = cmd.icon;
                    const isSelected = i === selectedIndex;
                    const isFrequent = (usage[cmd.name] ?? 0) > 0;
                    const prevIsFrequent = i > 0 ? (usage[filtered[i - 1].name] ?? 0) > 0 : true;

                    return (
                        <React.Fragment key={cmd.name}>
                            {!isFrequent && prevIsFrequent && hasFrequent && (
                                <div className="px-3 pt-2 pb-1 border-t border-border/50">
                                    <span className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-semibold">All Commands</span>
                                </div>
                            )}
                            <button
                                onMouseDown={(e) => { e.preventDefault(); onSelect(cmd.name + (cmd.args ? ' ' : '')); }}
                                className={cn(
                                    'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors',
                                    isSelected ? 'bg-accent text-foreground' : 'hover:bg-accent/50 text-muted-foreground'
                                )}
                            >
                                <Icon size={14} className="shrink-0" />
                                <span className="font-semibold text-foreground">{cmd.name}</span>
                                {cmd.args && (
                                    <span className="text-muted-foreground/50 text-xs">{cmd.args}</span>
                                )}
                                <span className="text-[11px] text-muted-foreground/40 ml-auto truncate max-w-[180px]">
                                    {cmd.description}
                                </span>
                            </button>
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
}

// ─── StatusBar ────────────────────────────────────────────────────────────────

interface StatusBarProps {
    agent: AgentSession;
}

export function StatusBar({ agent }: StatusBarProps) {
    const [elapsed, setElapsed] = useState(Date.now() - agent.sessionStart.getTime());

    useEffect(() => {
        const interval = setInterval(() => {
            setElapsed(Date.now() - agent.sessionStart.getTime());
        }, 1000);
        return () => clearInterval(interval);
    }, [agent.sessionStart]);

    const meta = MODEL_META[agent.model] ?? MODEL_META[DEFAULT_MODEL];

    const totalTokens = agent.messages.reduce((s, m) => s + (m.tokenCount ?? estimateTokens(m.content)), 0);
    const contextPct = Math.min(100, Math.round((totalTokens / meta.contextWindow) * 100));
    const cost = (agent.inputTokens / 1e6 * meta.inputPricePerM) + (agent.outputTokens / 1e6 * meta.outputPricePerM);

    const costStr = cost < 0.01 ? `<$0.01` : `$${cost.toFixed(2)}`;
    const label = `${meta.displayName}${agent.extendedThinking ? ' Extended' : ''} | Context: ${contextPct}% | ${costStr} | ${formatElapsed(elapsed)}`;

    return (
        <div className="px-4 py-1.5 border-t border-border flex items-center gap-1 shrink-0">
            <span className={cn(
                "font-sans text-[11px] text-muted-foreground/60 select-none",
                agent.isStreaming && 'animate-pulse'
            )}>
                {label}
            </span>
            {agent.autoEnabled && (
                <span className="ml-2 text-[10px] font-semibold text-yellow-400">⚡ AUTO</span>
            )}
        </div>
    );
}
