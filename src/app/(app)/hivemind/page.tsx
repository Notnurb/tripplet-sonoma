'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Shield } from 'lucide-react';
import { useRouter } from 'next/navigation';
import InputBox from '@/components/Chat/InputBox';
import ModelSelector from '@/components/Chat/ModelSelector';
import { ChatMode, ToneType, AutoSkillSetting, Message } from '@/types';
import { toggleMode } from '@/lib/ai/modes';
import { loadSettings, updateSetting } from '@/lib/settings';
import { Model } from '@/lib/ai/models';
import { cn } from '@/lib/utils';
import {
    AGENT_COUNT,
    getRandomAgent,
    hasHivemindConsent,
    setHivemindConsent,
    HivemindAgent,
} from '@/lib/hivemind';
import MessageBubble from '@/components/Chat/MessageBubble';

const HIVEMIND_MODELS: Model[] = [
    {
        id: 'taipei4',
        name: 'Taipei 3.1',
        description: 'Advanced reasoning and analysis',
    },
    {
        id: 'majuli4',
        name: 'Majuli 3.1',
        description: 'Fast and concise responses',
    },
    {
        id: 'suzhou4',
        name: 'Suzhou 3.1',
        description: 'Creative and detailed generation',
    },
];

const RESPONSE_QUALITY_LEVELS: Model[] = [
    {
        id: 'low',
        name: 'Low',
        description: 'Prioritize speed and brevity',
    },
    {
        id: 'medium',
        name: 'Medium',
        description: 'Balanced quality and speed',
    },
    {
        id: 'high',
        name: 'High',
        description: 'More thorough reasoning',
    },
    {
        id: 'extra-high',
        name: 'Extra High',
        description: 'Deep, highest-quality responses',
    },
];

// ─── Consent Modal ───────────────────────────────────────────────────────────

function ConsentModal({ onAccept, onExit }: { onAccept: () => void; onExit: () => void }) {
    const [countdown, setCountdown] = useState(10);

    useEffect(() => {
        if (countdown <= 0) return;
        const id = setInterval(() => setCountdown((c) => c - 1), 1000);
        return () => clearInterval(id);
    }, [countdown]);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.92, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92, y: 20 }}
                transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
            >
                {/* Header */}
                <div className="px-8 pt-8 pb-4">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="h-10 w-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
                            <AlertTriangle size={20} className="text-amber-400" />
                        </div>
                        <h2 className="text-xl font-bold text-foreground">Welcome to the Hivemind</h2>
                    </div>

                    <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                        All thoughts in the Hivemind are shared across <span className="text-foreground font-semibold">{AGENT_COUNT} AI agents</span>. When one agent learns something, every other agent gains that knowledge instantly.
                    </p>

                    <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3">
                        <p className="text-sm font-semibold text-rose-400 flex items-center gap-2">
                            <Shield size={14} />
                            Important Warning
                        </p>
                        <p className="text-xs text-rose-400/80 mt-1 leading-relaxed">
                            Never input sensitive, personal, or confidential information. All messages are visible to the collective. This includes passwords, API keys, personal details, and private data.
                        </p>
                    </div>
                </div>

                {/* Actions */}
                <div className="px-8 pb-8 pt-4 flex items-center gap-3">
                    <button
                        onClick={onExit}
                        className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
                    >
                        Exit
                    </button>
                    <button
                        onClick={onAccept}
                        disabled={countdown > 0}
                        className={cn(
                            'flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all',
                            countdown > 0
                                ? 'bg-muted text-muted-foreground/50 cursor-not-allowed'
                                : 'bg-foreground text-background hover:opacity-90'
                        )}
                    >
                        {countdown > 0 ? `I Understand (${countdown}s)` : 'I Understand'}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HivemindPage() {
    const router = useRouter();
    const [consented, setConsented] = useState(false);
    const [checkingConsent, setCheckingConsent] = useState(true);
    const [messages, setMessages] = useState<Message[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingContent, setStreamingContent] = useState('');
    const [currentAgent, setCurrentAgent] = useState<HivemindAgent>(() => getRandomAgent());

    // Chat state (same as regular chat)
    const [selectedModel, setSelectedModel] = useState(HIVEMIND_MODELS[0].id);
    const [extendedThinking, setExtendedThinking] = useState(false);
    const [multiAgent, setMultiAgent] = useState(false);
    const [activeModes, setActiveModes] = useState<ChatMode[]>([]);
    const [activeTone, setActiveTone] = useState<ToneType | null>(null);
    const [autoSkillSetting, setAutoSkillSetting] = useState<AutoSkillSetting>(() => {
        try { return loadSettings().autoSkills ?? 'off'; } catch { return 'off'; }
    });
    const handleAutoSkillSettingChange = useCallback((s: AutoSkillSetting) => {
        setAutoSkillSetting(s);
        updateSetting('autoSkills', s);
    }, []);
    const [responseQuality, setResponseQuality] = useState(RESPONSE_QUALITY_LEVELS[1].id);

    const bottomRef = useRef<HTMLDivElement>(null);
    const qualitySelector = useMemo(
        () => (
            <ModelSelector
                selectedModelId={responseQuality}
                onSelectModel={setResponseQuality}
                extendedThinking={false}
                models={RESPONSE_QUALITY_LEVELS}
                menuTitle="Response quality"
                showExtendedToggle={false}
            />
        ),
        [responseQuality]
    );

    // Check consent on mount
    useEffect(() => {
        setConsented(hasHivemindConsent());
        setCheckingConsent(false);
    }, []);

    // Auto-scroll
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length, streamingContent]);

    const handleAccept = useCallback(() => {
        setHivemindConsent();
        setConsented(true);
    }, []);

    const handleExit = useCallback(() => {
        router.push('/chat');
    }, [router]);

    const handleToggleMode = useCallback((mode: ChatMode) => {
        setActiveModes((current) => toggleMode(current, mode));
    }, []);

    const handleSetTone = useCallback((tone: ToneType | null) => {
        setActiveTone(tone);
    }, []);

    const toggleExtendedThinking = useCallback(() => {
        setExtendedThinking((current) => !current);
    }, []);

    const toggleMultiAgent = useCallback(() => {
        setMultiAgent((current) => !current);
    }, []);

    // Streams a single agent response and appends the final message
    const streamAgentResponse = useCallback(async (agent: HivemindAgent, content: string, agentIndex?: number) => {
        setCurrentAgent(agent);
        setStreamingContent('');

        const assistantId = `agent-${agent.id}-${Date.now()}`;
        const prefix = agentIndex !== undefined ? `[Agent ${agentIndex + 1}/3] ` : '';

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [...messages.map(m => ({ role: m.role, content: m.content })), { role: 'user', content }],
                    model: selectedModel,
                    isHivemind: true,
                    // Give the agent a personality by injecting its label into the context
                    // if needed, or just let it be part of the hive.
                }),
            });

            if (!res.ok) throw new Error('Failed to connect to the Collective Intelligence Hive.');

            const reader = res.body?.getReader();
            if (!reader) throw new Error('No response body');

            const decoder = new TextDecoder();
            let accumulated = '';
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const data = trimmed.slice(6);
                    if (data === '[DONE]') break;

                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.content) {
                            accumulated += parsed.content;
                            setStreamingContent(prefix + accumulated);
                        }
                    } catch { /* ignore */ }
                }
            }

            const assistantMsg: Message = {
                id: assistantId,
                role: 'assistant',
                content: prefix + accumulated,
                timestamp: new Date(),
                model: agent.label,
            };
            setMessages((prev) => [...prev, assistantMsg]);
        } catch (error: unknown) {
            const errorMsg: Message = {
                id: `error-${Date.now()}`,
                role: 'assistant',
                content: `⚠️ Connection Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                timestamp: new Date(),
                model: 'Hivemind Error',
            };
            setMessages((prev) => [...prev, errorMsg]);
        } finally {
            setStreamingContent('');
        }
    }, [messages, selectedModel]);

    const handleSend = useCallback(async (content: string) => {
        if (!content.trim() || isStreaming) return;

        // Add user message
        const userMsg: Message = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: content.trim(),
            timestamp: new Date(),
        };
        setMessages((prev) => [...prev, userMsg]);
        setIsStreaming(true);

        if (multiAgent) {
            // Pick 3 distinct random agents and run them sequentially
            const picked: HivemindAgent[] = [];
            while (picked.length < 3) {
                const a = getRandomAgent();
                if (!picked.find((p) => p.id === a.id)) picked.push(a);
            }
            for (let i = 0; i < picked.length; i++) {
                await streamAgentResponse(picked[i], content, i);
                if (i < picked.length - 1) {
                    await new Promise((r) => setTimeout(r, 400));
                }
            }
        } else {
            const agent = getRandomAgent();
            await streamAgentResponse(agent, content);
        }

        setIsStreaming(false);
    }, [isStreaming, multiAgent, streamAgentResponse]);

    const handleRegenerate = useCallback(() => {
        const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
        if (!lastUserMsg || isStreaming) return;
        handleSend(lastUserMsg.content);
    }, [messages, isStreaming, handleSend]);

    const isEmpty = messages.length === 0 && !isStreaming;

    if (checkingConsent) return null;

    return (
        <div className="flex flex-col h-full relative overflow-hidden">
            {/* Consent modal */}
            <AnimatePresence>
                {!consented && (
                    <ConsentModal onAccept={handleAccept} onExit={handleExit} />
                )}
            </AnimatePresence>

            {/* Top bar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
                {/* Left: Agent count */}
                <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    <span className="text-xs font-medium text-muted-foreground">
                        <span className="text-foreground font-semibold">{AGENT_COUNT}</span> agents
                    </span>
                </div>

                {/* Center: Current agent */}
                <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Talking to:</span>
                    <span className="text-xs font-semibold text-foreground">
                        {multiAgent ? '3 agents simultaneously' : currentAgent.label}
                    </span>
                    {multiAgent && (
                        <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-violet-500/15 text-violet-400 border border-violet-500/25 rounded-full">
                            Multi
                        </span>
                    )}
                </div>

                {/* Right: Warning */}
                <div className="flex items-center gap-1.5 text-rose-400">
                    <AlertTriangle size={12} />
                    <span className="text-[11px] font-medium">Don&apos;t input sensitive info</span>
                </div>
            </div>

            {/* Chat area */}
            {!isEmpty ? (
                <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 scroll-smooth">
                    <div className="max-w-3xl mx-auto flex flex-col pb-4">
                        {messages.map((msg) => (
                            <MessageBubble
                                key={msg.id}
                                message={msg}
                                onRegenerate={msg.role === 'assistant' ? handleRegenerate : undefined}
                            />
                        ))}

                        {/* Streaming bubble */}
                        {isStreaming && streamingContent && (
                            <MessageBubble
                                key="streaming"
                                message={{
                                    id: 'streaming',
                                    role: 'assistant',
                                    content: '',
                                    timestamp: new Date(),
                                    model: currentAgent.label,
                                }}
                                isStreaming={true}
                                streamingContent={streamingContent}
                            />
                        )}

                        {/* Shimmer while waiting */}
                        {isStreaming && !streamingContent && (
                            <div className="flex items-center gap-3 mb-6">
                                <div className="h-7 w-7 rounded-full bg-foreground/10 flex items-center justify-center shrink-0">
                                    <span className="text-[9px] font-bold text-foreground/70">AI</span>
                                </div>
                                <span className="text-sm text-muted-foreground animate-pulse">
                                    {currentAgent.label} is thinking...
                                </span>
                            </div>
                        )}

                        <div ref={bottomRef} className="h-4" />
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                    <div className="animate-in fade-in zoom-in-95 duration-500">
                        <h1 className="text-3xl font-extrabold mb-3 tracking-tight">Hivemind</h1>
                        <p className="text-muted-foreground max-w-md text-base font-medium mb-1">
                            {AGENT_COUNT} agents. One collective intelligence.
                        </p>
                        <p className="text-muted-foreground/50 text-sm">
                            Ask anything — the entire hive processes your query.
                        </p>
                    </div>
                </div>
            )}

            {/* Input area */}
            <div className={cn(
                'w-full flex flex-col items-center shrink-0',
                isEmpty ? 'transform -translate-y-16' : 'py-4',
            )}>
                <div className={cn(
                    'w-full transition-all duration-500',
                    isEmpty ? 'max-w-3xl px-4' : 'max-w-4xl',
                )}>
                    <InputBox
                        selectedModel={selectedModel}
                        extendedThinking={extendedThinking}
                        isStreaming={isStreaming}
                        activeModes={activeModes}
                        activeTone={activeTone}
                        onSend={handleSend}
                        onModelChange={setSelectedModel}
                        onExtendedThinkingChange={toggleExtendedThinking}
                        onSelectModel={setSelectedModel}
                        onToggleExtended={toggleExtendedThinking}
                        onToggleMode={handleToggleMode}
                        onSetTone={handleSetTone}
                        autoSkillSetting={autoSkillSetting}
                        onAutoSkillSettingChange={handleAutoSkillSettingChange}
                        modelOptions={HIVEMIND_MODELS}
                        modelSelectorTitle="Select Hivemind model"
                        secondarySelector={qualitySelector}
                        multiAgent={multiAgent}
                        onToggleMultiAgent={toggleMultiAgent}
                    />
                </div>
                {!isEmpty && (
                    <div className="py-2 text-[10px] text-muted-foreground/40">
                        All messages are shared with the collective.
                    </div>
                )}
            </div>
        </div>
    );
}
