'use client';

/**
 * Multi-Agent Workspace
 *
 * A Claude Code–inspired multi-agent environment for Tripplet.
 * Think of it as mission control for your AI army. Each "agent"
 * is an independent session with its own model, system prompt,
 * message history, and token budget. You can run as many as you
 * want in parallel, group them, create SubAgents, broadcast to
 * a whole group, and pipe commands in with slash shortcuts.
 *
 * Layout:
 *   Left  (flex-1) — chat area for the active agent + status bar + InputBox
 *   Right (260px)  — sidebar: agent list, groups, subagents, command picker
 */

import React, {
    useState,
    useCallback,
    useRef,
    useEffect,
    useMemo,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Plus,
    Cpu,
    Pencil,
    ChevronRight,
    ChevronDown,
    Trash2,
    PanelRightClose,
    PanelRightOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AutoSkillSetting, ChatMode, ToneType, Message } from '@/types';

import MessageBubble from '@/components/Chat/MessageBubble';
import InputBox from '@/components/Chat/InputBox';
import { toggleMode } from '@/lib/ai/modes';
import { loadSettings } from '@/lib/settings';
import {
    type AgentMessage,
    type AgentSession,
    type AgentGroup,
    MODEL_META,
    DEFAULT_MODEL,
    bumpCommandUsage,
    estimateTokens,
    uid,
    agentMsgToMessage,
    createSession,
} from './_lib/agents-core';
import { executeSlashCommand } from './_lib/commands';
import {
    CreateSubAgentModal,
    StatsCard,
    HelpCard,
    CostCard,
    CompareCard,
    InlineCommandPicker,
    StatusBar,
} from './_components/AgentPanels';

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AgentsPage() {
    // ── Agent sessions ────────────────────────────────────────────────────────
    const [sessions, setSessions] = useState<AgentSession[]>([createSession({ name: 'Agent 1' })]);
    const [activeId, setActiveId] = useState<string>(sessions[0].id);

    // ── Groups ────────────────────────────────────────────────────────────────
    const [groups, setGroups] = useState<AgentGroup[]>([]);

    // ── InputBox shared state ─────────────────────────────────────────────────
    const [activeModes, setActiveModes]   = useState<ChatMode[]>([]);
    const [activeTone, setActiveTone]     = useState<ToneType | null>(null);
    const [autoSkill, setAutoSkill]       = useState<AutoSkillSetting>(() => loadSettings().autoSkills);

    // ── UI state ──────────────────────────────────────────────────────────────
    const [agentSidebarOpen, setAgentSidebarOpen] = useState(false);
    const [showSubAgentModal, setShowSubAgentModal] = useState(false);
    const [subAgentInitialName, setSubAgentInitialName] = useState('');
    const [commandBarInput, setCommandBarInput]   = useState<string | undefined>(undefined);

    // Slash autocomplete state
    const [slashFilter, setSlashFilter] = useState('');
    const [showSlashPicker, setShowSlashPicker] = useState(false);
    const [slashSelectedIdx, setSlashSelectedIdx] = useState(0);

    // Inline rename state
    const [renamingAgentId, setRenamingAgentId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
    const [renameGroupValue, setRenameGroupValue] = useState('');

    // ── Refs ──────────────────────────────────────────────────────────────────
    const abortControllers = useRef<Map<string, AbortController>>(new Map());
    const autoIntervals    = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
    const messagesEndRef   = useRef<HTMLDivElement>(null);

    // Scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [sessions]);

    // Derive active agent
    const activeAgent = useMemo(
        () => sessions.find((s) => s.id === activeId) ?? sessions[0],
        [sessions, activeId]
    );

    // ── Session updater helper ─────────────────────────────────────────────────
    const updateSession = useCallback((id: string, patch: Partial<AgentSession> | ((s: AgentSession) => Partial<AgentSession>)) => {
        setSessions((prev) => prev.map((s) =>
            s.id === id
                ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) }
                : s
        ));
    }, []);

    // ── Streaming ─────────────────────────────────────────────────────────────

    const streamAgentMessage = useCallback(async (
        agentId: string,
        messages: Array<{ role: string; content: string }>,
        model: string,
        systemPromptOverride: string,
        extended: boolean,
    ) => {
        // Abort any existing stream for this agent
        abortControllers.current.get(agentId)?.abort();
        const controller = new AbortController();
        abortControllers.current.set(agentId, controller);

        updateSession(agentId, { isStreaming: true, streamingContent: '' });

        let accumulated = '';
        let wasAborted = false;

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages,
                    model,
                    extendedThinking: extended,
                    activeModes,
                    activeTone,
                    systemPromptOverride,
                }),
                signal: controller.signal,
            });

            if (!res.ok || !res.body) {
                // Surface the actual error from the server if possible
                let errMsg = `Request failed (${res.status})`;
                try {
                    const errBody = await res.json() as { error?: string };
                    if (errBody.error) errMsg = errBody.error;
                } catch { /* ignore */ }
                throw new Error(errMsg);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();

            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const raw = line.slice(6).trim();
                    if (raw === '[DONE]') break;
                    try {
                        const parsed = JSON.parse(raw) as { content?: string; type?: string; error?: string };
                        // Route sends { error: "..." } when the upstream API fails mid-stream
                        if (parsed.error) { accumulated = `⚠ ${parsed.error}`; break; }
                        // Skip metadata events (search_stats, auto_skills)
                        if (parsed.type || !parsed.content) continue;
                        accumulated += parsed.content;
                        const liveOut = estimateTokens(accumulated);
                        requestAnimationFrame(() => {
                            updateSession(agentId, {
                                streamingContent: accumulated,
                                outputTokens: liveOut,
                            });
                        });
                    } catch { /* skip malformed chunk */ }
                }
            }

        } catch (e) {
            if ((e as { name?: string }).name === 'AbortError') {
                wasAborted = true;
            } else {
                accumulated = accumulated || (e instanceof Error ? e.message : 'An error occurred. Please try again.');
            }
        } finally {
            // Don't commit an empty message on abort
            if (wasAborted && !accumulated) {
                updateSession(agentId, { isStreaming: false, streamingContent: '' });
                abortControllers.current.delete(agentId);
                return;
            }

            const outputTokens = estimateTokens(accumulated);
            const systemTokens = 200;
            const historyTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

            setSessions((prev) => prev.map((s) => {
                if (s.id !== agentId) return s;
                const assistantMsg: AgentMessage = {
                    id: uid(),
                    role: 'assistant',
                    content: accumulated,
                    timestamp: new Date(),
                    model,
                    tokenCount: outputTokens,
                };
                return {
                    ...s,
                    messages: [...s.messages, assistantMsg],
                    isStreaming: false,
                    streamingContent: '',
                    inputTokens: s.inputTokens + systemTokens + historyTokens,
                    outputTokens: s.outputTokens + outputTokens,
                };
            }));

            abortControllers.current.delete(agentId);
        }
    }, [activeModes, activeTone, updateSession]);

    // ── Slash command handler ─────────────────────────────────────────────────

    // Parse + resolve here; the command behaviors live in `_lib/commands.ts`
    // and receive this page's state operations as a context object.
    const handleSlashCommand = useCallback((agentId: string, content: string): boolean => {
        const trimmed = content.trim();
        if (!trimmed.startsWith('/')) return false;

        const [cmd, ...argParts] = trimmed.slice(1).split(' ');
        const arg = argParts.join(' ').trim();
        const command = `/${cmd.toLowerCase()}`;
        bumpCommandUsage(command);

        const session = sessions.find((s) => s.id === agentId);
        if (!session) return true;

        executeSlashCommand(command, arg, agentId, session, {
            sessions,
            groups,
            activeModes,
            setSessions,
            setGroups,
            setActiveId,
            setActiveModes,
            setSubAgentInitialName,
            setShowSubAgentModal,
            updateSession,
            addSystemInfoMessage,
            addSpecialCard,
            streamAgentMessage,
            autoIntervals: autoIntervals.current,
        });
        return true;
     
    }, [sessions, groups, activeModes, streamAgentMessage, updateSession]);

    // Push a simple info message (displayed as a system-style assistant bubble)
    const addSystemInfoMessage = useCallback((agentId: string, text: string) => {
        const msg: AgentMessage = {
            id: uid(), role: 'assistant', content: text, timestamp: new Date(),
            tokenCount: 0,
        };
        setSessions((prev) => prev.map((s) =>
            s.id === agentId ? { ...s, messages: [...s.messages, msg] } : s
        ));
    }, []);

    // We store special card markers as special assistant messages prefixed with a sentinel.
    // The chat renderer will detect these and render the appropriate card component.
    const CARD_SENTINEL = '\u0000CARD:';
    const addSpecialCard = useCallback((agentId: string, type: 'stats' | 'help' | 'cost' | 'compare') => {
        const msg: AgentMessage = {
            id: uid(), role: 'assistant',
            content: `${CARD_SENTINEL}${type}`,
            timestamp: new Date(),
            tokenCount: 0,
        };
        setSessions((prev) => prev.map((s) =>
            s.id === agentId ? { ...s, messages: [...s.messages, msg] } : s
        ));
    }, [CARD_SENTINEL]);

    // ── Send handler (main) ───────────────────────────────────────────────────

    const handleSend = useCallback((content: string) => {
        if (!activeAgent) return;
        setShowSlashPicker(false);
        const agentId = activeAgent.id;

        // Intercept slash commands
        if (content.trim().startsWith('/')) {
            handleSlashCommand(agentId, content);
            return;
        }

        const userMsg: AgentMessage = {
            id: uid(), role: 'user', content, timestamp: new Date(),
            tokenCount: estimateTokens(content),
        };

        setSessions((prev) => prev.map((s) =>
            s.id === agentId ? { ...s, messages: [...s.messages, userMsg] } : s
        ));

        const history = [
            ...activeAgent.messages,
            userMsg,
        ].map((m) => ({ role: m.role, content: m.content }));

        streamAgentMessage(agentId, history, activeAgent.model, activeAgent.systemPrompt, activeAgent.extendedThinking);
    }, [activeAgent, handleSlashCommand, streamAgentMessage]);

    // ── Add a new agent session ───────────────────────────────────────────────

    const addAgent = useCallback(() => {
        const n = sessions.length + 1;
        const newSession = createSession({ name: `Agent ${n}` });
        setSessions((prev) => [...prev, newSession]);
        setActiveId(newSession.id);
    }, [sessions.length]);

    // ── Delete agent session ──────────────────────────────────────────────────

    const deleteAgent = useCallback((agentId: string) => {
        abortControllers.current.get(agentId)?.abort();
        const interval = autoIntervals.current.get(agentId);
        if (interval) clearInterval(interval);
        setSessions((prev) => {
            const remaining = prev.filter((s) => s.id !== agentId);
            if (remaining.length === 0) {
                const fresh = createSession({ name: 'Agent 1' });
                setActiveId(fresh.id);
                return [fresh];
            }
            if (activeId === agentId) setActiveId(remaining[0].id);
            return remaining;
        });
    }, [activeId]);

    // ── Create group ──────────────────────────────────────────────────────────

    const createGroup = useCallback(() => {
        const n = groups.length + 1;
        const newGroup: AgentGroup = {
            id: uid(), name: `Group ${n}`, agentIds: [], collapsed: false,
        };
        setGroups((prev) => [...prev, newGroup]);
    }, [groups.length]);

    // ── Cleanup on unmount ────────────────────────────────────────────────────

    useEffect(() => {
        return () => {
            abortControllers.current.forEach((c) => c.abort());
            autoIntervals.current.forEach((i) => clearInterval(i));
        };
    }, []);

    // ── Slash autocomplete ──────────────────────────────────────────────────

    const handleInputChange = useCallback((text: string) => {
        const trimmed = text.trimStart();
        if (trimmed.startsWith('/') && !trimmed.includes('\n')) {
            setSlashFilter(trimmed);
            setShowSlashPicker(true);
            setSlashSelectedIdx(0);
        } else {
            setShowSlashPicker(false);
            setSlashFilter('');
        }
    }, []);

    const handleSlashSelect = useCallback((cmdTemplate: string) => {
        bumpCommandUsage(cmdTemplate.trim());
        setCommandBarInput(cmdTemplate);
        setShowSlashPicker(false);
        setSlashFilter('');
    }, []);

    // Reset commandBarInput after it's been used (InputBox reacts to initialContent changes)
    useEffect(() => {
        if (commandBarInput !== undefined) {
            const t = setTimeout(() => setCommandBarInput(undefined), 100);
            return () => clearTimeout(t);
        }
    }, [commandBarInput]);

    // ── Inline rename handlers ───────────────────────────────────────────────

    const startRenameAgent = useCallback((agentId: string, currentName: string) => {
        setRenamingAgentId(agentId);
        setRenameValue(currentName);
    }, []);

    const commitRenameAgent = useCallback(() => {
        if (renamingAgentId && renameValue.trim()) {
            updateSession(renamingAgentId, { name: renameValue.trim() });
        }
        setRenamingAgentId(null);
        setRenameValue('');
    }, [renamingAgentId, renameValue, updateSession]);

    const startRenameGroup = useCallback((groupId: string, currentName: string) => {
        setRenamingGroupId(groupId);
        setRenameGroupValue(currentName);
    }, []);

    const commitRenameGroup = useCallback(() => {
        if (renamingGroupId && renameGroupValue.trim()) {
            setGroups((prev) => prev.map((g) =>
                g.id === renamingGroupId ? { ...g, name: renameGroupValue.trim() } : g
            ));
        }
        setRenamingGroupId(null);
        setRenameGroupValue('');
    }, [renamingGroupId, renameGroupValue]);

    // ── Render ────────────────────────────────────────────────────────────────

    if (!activeAgent) return null;

    const subAgents = sessions.filter((s) => s.isSubAgent);

    const meta = MODEL_META[activeAgent.model] ?? MODEL_META[DEFAULT_MODEL];
    const liveCost = (activeAgent.inputTokens / 1e6 * meta.inputPricePerM) + (activeAgent.outputTokens / 1e6 * meta.outputPricePerM);
    const liveCostStr = liveCost < 0.01 ? '<$0.01' : `$${liveCost.toFixed(2)}`;

    return (
        <div className="flex h-full bg-background relative">
            {/* ── Live token counter (top-right corner) ────────────────────── */}
            <div className="absolute top-3 right-3 z-10 flex items-center gap-2 pointer-events-none">
                <AnimatePresence>
                    {activeAgent.isStreaming && (
                        <motion.span
                            key="streaming-dot"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center gap-1"
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                        </motion.span>
                    )}
                </AnimatePresence>
                <div className="flex items-center gap-2 bg-background/80 backdrop-blur border border-border rounded-full px-3 py-1 text-[11px] font-mono text-muted-foreground shadow-sm">
                    <span title="Input tokens">↑{activeAgent.inputTokens.toLocaleString()}</span>
                    <span className="text-border">·</span>
                    <span title="Output tokens">↓{activeAgent.outputTokens.toLocaleString()}</span>
                    <span className="text-border">·</span>
                    <span title="Cost" className={liveCost > 0 ? 'text-foreground' : ''}>{liveCostStr}</span>
                </div>
            </div>

            {/* ── LEFT: Chat area ──────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0 h-full">

                {/* Message list */}
                <div className="flex-1 overflow-y-auto">
                    {activeAgent.messages.length === 0 && !activeAgent.isStreaming ? (
                        <div className="h-full" />
                    ) : (
                        <div className="py-4 max-w-3xl mx-auto w-full">
                            {activeAgent.messages.map((msg) => {
                                // Detect special card sentinels
                                if (msg.content.startsWith(CARD_SENTINEL)) {
                                    const cardType = msg.content.slice(CARD_SENTINEL.length) as 'stats' | 'help' | 'cost' | 'compare';
                                    return (
                                        <div key={msg.id}>
                                            {cardType === 'stats'   && <StatsCard   sessions={sessions} />}
                                            {cardType === 'help'    && <HelpCard />}
                                            {cardType === 'cost'    && <CostCard    agent={activeAgent} />}
                                            {cardType === 'compare' && <CompareCard sessions={sessions} />}
                                        </div>
                                    );
                                }

                                // Regular message bubble
                                const message: Message = agentMsgToMessage(msg);
                                return (
                                    <MessageBubble
                                        key={msg.id}
                                        message={message}
                                        isStreaming={false}
                                    />
                                );
                            })}

                            {/* Streaming preview bubble */}
                            {activeAgent.isStreaming && activeAgent.streamingContent && (
                                <MessageBubble
                                    message={{
                                        id: 'streaming',
                                        role: 'assistant',
                                        content: activeAgent.streamingContent,
                                        timestamp: new Date(),
                                        model: activeAgent.model,
                                    }}
                                    isStreaming={true}
                                />
                            )}

                            {/* Streaming spinner when no content yet */}
                            {activeAgent.isStreaming && !activeAgent.streamingContent && (
                                <div className="flex items-center gap-2 px-6 py-3">
                                    <span className="text-xs text-muted-foreground/50 animate-pulse">
                                        {activeAgent.name} is thinking...
                                    </span>
                                </div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>
                    )}
                </div>

                {/* Status bar */}
                <StatusBar agent={activeAgent} />

                {/* InputBox with slash autocomplete */}
                <div className="pb-4 shrink-0 relative max-w-3xl mx-auto w-full">
                    {showSlashPicker && (
                        <InlineCommandPicker
                            filter={slashFilter}
                            onSelect={handleSlashSelect}
                            selectedIndex={slashSelectedIdx}
                        />
                    )}
                    <InputBox
                        selectedModel={activeAgent.model}
                        extendedThinking={activeAgent.extendedThinking}
                        isStreaming={activeAgent.isStreaming}
                        activeModes={activeModes}
                        activeTone={activeTone}
                        autoSkillSetting={autoSkill}
                        onSend={(content, file) => {
                            setShowSlashPicker(false);
                            handleSend(content);
                        }}
                        onModelChange={(model) => updateSession(activeAgent.id, { model })}
                        onSelectModel={(model) => updateSession(activeAgent.id, { model })}
                        onExtendedThinkingChange={() => updateSession(activeAgent.id, (s) => ({ extendedThinking: !s.extendedThinking }))}
                        onToggleExtended={() => updateSession(activeAgent.id, (s) => ({ extendedThinking: !s.extendedThinking }))}
                        onToggleMode={(mode) => setActiveModes((prev) => toggleMode(prev, mode))}
                        onSetTone={setActiveTone}
                        onAutoSkillSettingChange={setAutoSkill}
                        initialContent={commandBarInput}
                        modelSelectorTitle="Agent Model"
                        onInputChange={handleInputChange}
                    />
                </div>
            </div>

            {/* ── RIGHT: Sidebar ────────────────────────────────────────────── */}
            <AnimatePresence initial={false}>
            {agentSidebarOpen ? (
            <motion.div
                key="agent-sidebar"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 260, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="shrink-0 border-l border-border flex flex-col bg-background overflow-y-auto overflow-x-hidden"
                style={{ minWidth: 0 }}
            >

                {/* Header */}
                <div className="px-4 pt-5 pb-3 shrink-0 flex items-start justify-between">
                    <div>
                        <h2 className="text-2xl font-black tracking-tight text-foreground">Agents</h2>
                        <p className="text-[11px] text-muted-foreground/50 mt-0.5">{sessions.length} running</p>
                    </div>
                    <button
                        onClick={() => setAgentSidebarOpen(false)}
                        title="Hide agents panel"
                        className="mt-1 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                    >
                        <PanelRightClose size={15} />
                    </button>
                </div>

                {/* New Agent button */}
                <button
                    onClick={addAgent}
                    className="mx-4 mb-3 flex items-center gap-2 px-3 py-1.5 rounded-md border border-dashed border-border hover:border-foreground/30 text-muted-foreground hover:text-foreground text-sm transition-colors"
                >
                    <Plus size={14} /> New Agent
                </button>

                {/* Agent list */}
                <div className="flex flex-col shrink-0">
                    {sessions.filter((s) => !s.isSubAgent).map((session) => (
                        <div
                            key={session.id}
                            onClick={() => setActiveId(session.id)}
                            className={cn(
                                'w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors text-left group cursor-pointer',
                                activeId === session.id
                                    ? 'bg-accent text-foreground'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                            )}
                        >
                            <span className={cn(
                                'w-1.5 h-1.5 rounded-full shrink-0',
                                session.isStreaming ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30'
                            )} />
                            {renamingAgentId === session.id ? (
                                <input
                                    autoFocus
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onBlur={commitRenameAgent}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') commitRenameAgent();
                                        if (e.key === 'Escape') { setRenamingAgentId(null); setRenameValue(''); }
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex-1 bg-transparent border-b border-foreground/30 text-sm font-medium text-foreground outline-none min-w-0"
                                />
                            ) : (
                                <span
                                    className="flex-1 truncate font-medium"
                                    onDoubleClick={(e) => { e.stopPropagation(); startRenameAgent(session.id, session.name); }}
                                >
                                    {session.name}
                                </span>
                            )}
                            {session.autoEnabled && (
                                <span className="text-[9px] text-yellow-400 shrink-0">⚡</span>
                            )}
                            {renamingAgentId !== session.id && (
                                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-all">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); startRenameAgent(session.id, session.name); }}
                                        className="text-muted-foreground/40 hover:text-foreground transition-colors p-0.5 rounded"
                                    >
                                        <Pencil size={11} />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); deleteAgent(session.id); }}
                                        className="text-muted-foreground/40 hover:text-destructive transition-colors p-0.5 rounded"
                                        title="Delete agent"
                                    >
                                        <Trash2 size={11} />
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* Groups section */}
                <div className="mx-4 mt-3 mb-1 border-t border-border/50 pt-3 shrink-0">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/40 font-semibold">Groups</span>
                        <button
                            onClick={createGroup}
                            className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                        >
                            <Plus size={12} />
                        </button>
                    </div>
                    {groups.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground/30 italic">No groups yet. Use /group to create one.</p>
                    ) : (
                        groups.map((group) => (
                            <div key={group.id} className="mb-1">
                                <div className="w-full flex items-center gap-1.5 py-1 group/grp">
                                    <button
                                        onClick={() => setGroups((prev) => prev.map((g) =>
                                            g.id === group.id ? { ...g, collapsed: !g.collapsed } : g
                                        ))}
                                        className="shrink-0"
                                    >
                                        {group.collapsed
                                            ? <ChevronRight size={11} className="text-muted-foreground/40" />
                                            : <ChevronDown size={11} className="text-muted-foreground/40" />}
                                    </button>
                                    {renamingGroupId === group.id ? (
                                        <input
                                            autoFocus
                                            value={renameGroupValue}
                                            onChange={(e) => setRenameGroupValue(e.target.value)}
                                            onBlur={commitRenameGroup}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') commitRenameGroup();
                                                if (e.key === 'Escape') { setRenamingGroupId(null); setRenameGroupValue(''); }
                                            }}
                                            className="flex-1 bg-transparent border-b border-foreground/30 text-[12px] font-medium text-foreground outline-none min-w-0"
                                        />
                                    ) : (
                                        <span
                                            className="text-[12px] font-medium text-muted-foreground flex-1 cursor-pointer"
                                            onDoubleClick={() => startRenameGroup(group.id, group.name)}
                                        >
                                            {group.name}
                                        </span>
                                    )}
                                    <span className="text-[10px] text-muted-foreground/40">{group.agentIds.length}</span>
                                    {renamingGroupId !== group.id && (
                                        <button
                                            onClick={() => startRenameGroup(group.id, group.name)}
                                            className="opacity-0 group-hover/grp:opacity-100 text-muted-foreground/40 hover:text-foreground transition-all shrink-0"
                                        >
                                            <Pencil size={10} />
                                        </button>
                                    )}
                                </div>
                                {!group.collapsed && group.agentIds.map((agId) => {
                                    const s = sessions.find((x) => x.id === agId);
                                    if (!s) return null;
                                    return (
                                        <button
                                            key={agId}
                                            onClick={() => setActiveId(agId)}
                                            className="w-full pl-5 pr-2 py-1 text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent/40 rounded-md transition-colors text-left truncate"
                                        >
                                            {s.name}
                                        </button>
                                    );
                                })}
                            </div>
                        ))
                    )}
                </div>

                {/* SubAgents section */}
                {subAgents.length > 0 && (
                    <div className="mx-4 mt-2 mb-2 border-t border-border/50 pt-3 shrink-0">
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/40 font-semibold">SubAgents</span>
                        {subAgents.map((s) => (
                            <button
                                key={s.id}
                                onClick={() => setActiveId(s.id)}
                                className="w-full flex items-center gap-2 px-2 py-1.5 mt-1 text-[12px] text-muted-foreground hover:text-foreground rounded-md hover:bg-accent/50 transition-colors text-left"
                            >
                                <Cpu size={11} className="shrink-0" />
                                <span className="truncate flex-1">{s.name}</span>
                                {s.subAgentPurpose && (
                                    <span className="text-[10px] text-muted-foreground/40 truncate max-w-[70px]">
                                        {s.subAgentPurpose}
                                    </span>
                                )}
                                <span className="text-[9px] uppercase tracking-wider bg-violet-500/15 text-violet-400 px-1 py-0.5 rounded shrink-0">Sub</span>
                            </button>
                        ))}
                    </div>
                )}

                {/* Spacer */}
                <div className="flex-1" />
            </motion.div>
            ) : (
            <motion.div
                key="agent-sidebar-collapsed"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 40, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="shrink-0 border-l border-border flex flex-col items-center py-3 gap-2 bg-background overflow-hidden"
                style={{ minWidth: 0 }}
            >
                <button
                    onClick={() => setAgentSidebarOpen(true)}
                    title="Show agents panel"
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                >
                    <PanelRightOpen size={15} />
                </button>
            </motion.div>
            )}
            </AnimatePresence>

            {/* ── CreateSubAgentModal ────────────────────────────────────── */}
            {showSubAgentModal && (
                <CreateSubAgentModal
                    initialName={subAgentInitialName}
                    onClose={() => setShowSubAgentModal(false)}
                    onCreate={(session) => {
                        setSessions((prev) => [...prev, session]);
                        setActiveId(session.id);
                    }}
                />
            )}
        </div>
    );
}
