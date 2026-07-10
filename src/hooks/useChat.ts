'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Message, TaskStatusType, ToneType, ChatMode, AutoSkillSetting, CodeExecution } from '@/types';
import { MODE_CONFIGS } from '@/lib/ai/modes';
import { v4 as uuidv4 } from 'uuid';
import { useSubscription } from '@/context/SubscriptionContext';
import { useConversations } from '@/hooks/useConversations';

// ─── Taipei 3 shimmer labels (cycled while waiting for first token) ───────────

const TURA_LABELS = [
    'Understanding request...',
    'Analyzing context...',
    'Reasoning deeply...',
    'Confirming approach...',
];

const EXTENDED_LABELS = [
    'Understanding request...',
    'Deep analysis...',
    'Searching knowledge...',
    'Reading context...',
    'Reasoning through options...',
    'Confirming approach...',
];

// ─── Hook ─────────────────────────────────────────────────────────────────────
//
// Streaming domain: everything about turning a user message into a streamed
// assistant reply — the SSE read loop, shimmer labels, abort/idle-timeout, and
// the streaming UI state. Conversation list/CRUD/persistence lives in
// `useConversations`, which this composes.

export function useChat() {
    const {
        conversations,
        setConversations,
        activeConversationId,
        setActiveConversationId,
        historyLoaded,
        activeConversation,
        conversationsRef,
        activeConversationIdRef,
        createConversation: createConversationBase,
        saveConversation,
        selectConversation: selectConversationBase,
        deleteConversation,
        renameConversation,
    } = useConversations();

    const [isLoading, setIsLoading] = useState(false);
    const [currentTask, setCurrentTask] = useState<TaskStatusType>('idle');
    const [currentTaskLabel, setCurrentTaskLabel] = useState('');
    const [streamingContent, setStreamingContent] = useState('');
    const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
    const [streamingSearchCount, setStreamingSearchCount] = useState<number | undefined>(undefined);
    const [streamingCodeExecutions, setStreamingCodeExecutions] = useState<CodeExecution[]>([]);
    const [autoActivatedModes, setAutoActivatedModes] = useState<ChatMode[]>([]);

    const { plan } = useSubscription();

    const abortRef = useRef<AbortController | null>(null);
    const shimmerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const lastMessageTime = useRef<number>(0);

    const getTaskLabel = useCallback(() => currentTaskLabel, [currentTaskLabel]);

    // Create/select wrappers: run the conversation-domain action, then reset the
    // streaming UI so a stale in-flight answer never bleeds into the new view.
    const createConversation = useCallback(
        (modelId?: string, id?: string, initialMessages: Message[] = []) => {
            const newId = createConversationBase(modelId, id, initialMessages);
            setStreamingContent('');
            setStreamingMessageId(null);
            setCurrentTask('idle');
            setCurrentTaskLabel('');
            setStreamingSearchCount(undefined);
            setStreamingCodeExecutions([]);
            return newId;
        },
        [createConversationBase],
    );

    const selectConversation = useCallback(
        (id: string) => {
            selectConversationBase(id);
            setStreamingContent('');
            setStreamingMessageId(null);
            setCurrentTask('idle');
            setCurrentTaskLabel('');
            setStreamingCodeExecutions([]);
        },
        [selectConversationBase],
    );

    // Start cycling shimmer labels (non-blocking)
    const startShimmer = useCallback((labels: string[]) => {
        if (shimmerRef.current) clearInterval(shimmerRef.current);

        let idx = 0;
        setCurrentTask('thinking');
        setCurrentTaskLabel(labels[0]);

        shimmerRef.current = setInterval(() => {
            idx = (idx + 1) % labels.length;
            setCurrentTaskLabel(labels[idx]);
        }, 1200);
    }, []);

    const stopShimmer = useCallback(() => {
        if (shimmerRef.current) {
            clearInterval(shimmerRef.current);
            shimmerRef.current = null;
        }
    }, []);

    useEffect(() => {
        return () => {
            abortRef.current?.abort();
            stopShimmer();
        };
    }, [stopShimmer]);

    const sendMessage = useCallback(
        async (
            content: string,
            modelId: string,
            extendedThinking: boolean,
            _tone: ToneType,
            _onAddMessage?: (msg: Message) => void,
            imageDescription?: string,
            activeModes: ChatMode[] = [],
            activeTone: ToneType | null = null,
            isRegenerate: boolean = false,
            autoSkillSetting: AutoSkillSetting = 'off',
        ) => {
            const conversationId = activeConversationIdRef.current;
            if (!conversationId) return;

            // Prevent double-sends while already streaming
            if (isLoading && !isRegenerate) return;

            // Slowmode check for 'Max' plan
            if (plan === 'max') {
                const now = Date.now();
                if (now - lastMessageTime.current < 6000) {
                    return;
                }
                lastMessageTime.current = now;
            }

            // Abort any in-flight stream before starting a new one —
            // prevents orphaned streams when the user sends messages rapidly
            abortRef.current?.abort();

            const controller = new AbortController();
            abortRef.current = controller;
            setIsLoading(true);

            const updateConversationMessages = (msg: Message) => {
                setConversations((prev) =>
                    prev.map((c) => {
                        if (c.id === conversationId) {
                            return {
                                ...c,
                                messages: [...c.messages, msg],
                                updatedAt: new Date(),
                                title: c.messages.length === 0 ? content.slice(0, 40) : c.title,
                            };
                        }
                        return c;
                    })
                );
            };

            // For regenerate: remove the last assistant message instead of adding a user message
            if (isRegenerate) {
                setConversations((prev) =>
                    prev.map((c) => {
                        if (c.id !== conversationId) return c;
                        const msgs = [...c.messages];
                        // Remove trailing assistant message(s)
                        while (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
                            msgs.pop();
                        }
                        return { ...c, messages: msgs, updatedAt: new Date() };
                    })
                );
            } else {
                // Add user message
                const userMessage: Message = {
                    id: uuidv4(),
                    role: 'user',
                    content,
                    timestamp: new Date(),
                    model: modelId,
                };
                updateConversationMessages(userMessage);
            }

            // Start shimmer — use mode-specific labels if any modes are active
            const modeLabels = activeModes.length > 0
                ? activeModes.flatMap((m) => MODE_CONFIGS[m].shimmerLabels)
                : null;

            if (modeLabels) {
                startShimmer(modeLabels);
            } else {
                const isTaipei = modelId === 'tura-3';
                if (isTaipei || extendedThinking) {
                    startShimmer(extendedThinking ? EXTENDED_LABELS : TURA_LABELS);
                } else {
                    setCurrentTask('thinking');
                    setCurrentTaskLabel('Thinking...');
                }
            }

            const assistantId = uuidv4();
            setStreamingMessageId(assistantId);
            setStreamingContent('');
            setStreamingSearchCount(undefined);
            setStreamingCodeExecutions([]);
            setAutoActivatedModes([]);

            // Build history — for regenerate, we need to use a freshly trimmed copy
            // because the setConversations call above hasn't flushed to the ref yet
            const targetConv = conversationsRef.current.find(c => c.id === conversationId);
            const existingMessages = (targetConv?.messages || []).map(m => ({ role: m.role, content: m.content }));

            let history: { role: string; content: string }[];
            if (isRegenerate) {
                // Strip trailing assistant messages from our local copy
                const trimmed = [...existingMessages];
                while (trimmed.length > 0 && trimmed[trimmed.length - 1].role === 'assistant') {
                    trimmed.pop();
                }
                // Safety check: ensure there's at least one user message left
                if (trimmed.length === 0) {
                    setIsLoading(false);
                    stopShimmer();
                    setCurrentTask('idle');
                    return;
                }
                history = trimmed;
            } else {
                history = [...existingMessages, { role: 'user' as const, content }];
            }

            let streamFrame: number | null = null;
            let latestBufferedContent = '';
            const isCurrentRequest = () => abortRef.current === controller;
            const flushStreamingContent = () => {
                if (streamFrame !== null) {
                    cancelAnimationFrame(streamFrame);
                    streamFrame = null;
                }
                if (!isCurrentRequest()) return;
                setStreamingContent(latestBufferedContent);
            };

            const scheduleStreamingContent = () => {
                if (streamFrame !== null) return;
                streamFrame = requestAnimationFrame(() => {
                    streamFrame = null;
                    if (!isCurrentRequest()) return;
                    setStreamingContent(latestBufferedContent);
                });
            };

            // Abort only if the stream goes completely silent (no bytes) for a
            // while — an IDLE timeout, not a wall-clock one. A fixed total
            // timeout was cutting off long "thinking" responses mid-stream.
            // The server sends heartbeat pings during silent reasoning gaps,
            // so a healthy stream will always reset this well before it fires.
            const STREAM_IDLE_TIMEOUT_MS = 180_000;
            let streamTimeout = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT_MS);
            const resetStreamTimeout = () => {
                clearTimeout(streamTimeout);
                streamTimeout = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT_MS);
            };

            try {
                const res = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: history,
                        model: modelId,
                        extendedThinking,
                        tone: _tone,
                        activeModes,
                        activeTone,
                        imageDescription,
                        conversationId, // Pass ID for persistence
                        autoSkillSetting,
                    }),
                    signal: controller.signal,
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
                    throw new Error(err.error || `API error: ${res.status}`);
                }

                const reader = res.body?.getReader();
                if (!reader) throw new Error('No response body');

                const decoder = new TextDecoder();
                let accumulated = '';
                let buffer = '';
                let gotFirstToken = false;
                let latestSearchCount: number | undefined;
                let streamDone = false;
                const executionMap = new Map<string, CodeExecution>();
                const syncExecutions = () => {
                    const executions = Array.from(executionMap.values());
                    if (isCurrentRequest()) {
                        setStreamingCodeExecutions(executions);
                    }
                    return executions;
                };
                const upsertExecution = (execution: CodeExecution) => {
                    executionMap.set(execution.id, execution);
                    return syncExecutions();
                };
                const appendExecutionChunk = (
                    executionId: string,
                    field: 'stdout' | 'stderr',
                    chunk: string,
                ) => {
                    const current = executionMap.get(executionId);
                    if (!current) return syncExecutions();
                    executionMap.set(executionId, {
                        ...current,
                        status: 'running',
                        [field]: `${current[field] || ''}${chunk}`,
                    });
                    return syncExecutions();
                };

                while (!streamDone) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    // Any bytes (including server heartbeats) mean the stream is alive.
                    resetStreamTimeout();

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split(/\r?\n/);
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || !trimmed.startsWith('data: ')) continue;
                        const data = trimmed.slice(6);
                        if (data === '[DONE]') { streamDone = true; break; }

                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.error) throw new Error(parsed.error);

                            // Server heartbeat during silent thinking gaps — keep-alive only.
                            if (parsed.type === 'ping') continue;

                            // Handle custom events
                            if (parsed.type === 'search_stats') {
                                // A failed search arrives as {count: 0, failed: true} —
                                // don't trigger the "Searching the web" success UI for it;
                                // the model explains the failure in its response.
                                if (typeof parsed.count === 'number' && parsed.count > 0) {
                                    if (isCurrentRequest()) {
                                        setStreamingSearchCount(parsed.count);
                                    }
                                    latestSearchCount = parsed.count;
                                }
                                continue;
                            }

                            if (parsed.type === 'auto_skills') {
                                if (isCurrentRequest()) {
                                    setAutoActivatedModes(parsed.modes as ChatMode[]);
                                }
                                continue;
                            }

                            if (parsed.type === 'code_execution_started' && parsed.execution) {
                                if (isCurrentRequest()) {
                                    stopShimmer();
                                    setCurrentTask('processing');
                                    setCurrentTaskLabel(`Running ${(parsed.execution.language as string) || 'code'}...`);
                                }
                                upsertExecution(parsed.execution as CodeExecution);
                                continue;
                            }

                            if (parsed.type === 'code_execution_stdout' && typeof parsed.executionId === 'string' && typeof parsed.chunk === 'string') {
                                appendExecutionChunk(parsed.executionId, 'stdout', parsed.chunk);
                                continue;
                            }

                            if (parsed.type === 'code_execution_stderr' && typeof parsed.executionId === 'string' && typeof parsed.chunk === 'string') {
                                appendExecutionChunk(parsed.executionId, 'stderr', parsed.chunk);
                                continue;
                            }

                            if (parsed.type === 'code_execution_finished' && parsed.execution) {
                                upsertExecution(parsed.execution as CodeExecution);
                                if (isCurrentRequest()) {
                                    setCurrentTask('processing');
                                    setCurrentTaskLabel('Finishing response...');
                                }
                                continue;
                            }

                            // Long-term memory tool events. The server emits these when the
                            // AI calls remember_fact / update_fact / forget_fact mid-stream.
                            // memory_saved and memory_updated carry a `content` field (the
                            // saved fact) — they MUST be handled before the generic
                            // `parsed.content` branch below, or the fact text gets appended
                            // into the visible assistant reply and corrupts the output.
                            if (
                                parsed.type === 'memory_saved' ||
                                parsed.type === 'memory_updated' ||
                                parsed.type === 'memory_deleted'
                            ) {
                                continue;
                            }

                            // Plain text chunks are shaped `{ content }` with no `type`. The
                            // `!parsed.type` guard is defense-in-depth so any future typed
                            // control event that also carries `content` can never leak into
                            // the message body.
                            if (parsed.content && !parsed.type) {
                                if (!gotFirstToken) {
                                    gotFirstToken = true;
                                    if (isCurrentRequest()) {
                                        stopShimmer();
                                        setCurrentTask('generating');
                                        setCurrentTaskLabel('');
                                    }
                                }
                                accumulated += parsed.content;
                                latestBufferedContent = accumulated;
                                scheduleStreamingContent();
                            }
                        } catch (e: any) {
                            if (e.message && !e.message.includes('JSON')) throw e;
                        }
                    }
                }

                if (latestBufferedContent !== accumulated) {
                    latestBufferedContent = accumulated;
                }
                flushStreamingContent();
                const finalizedExecutions = syncExecutions();

                const assistantMessage: Message = {
                    id: assistantId,
                    role: 'assistant',
                    content: accumulated || 'No response received.',
                    timestamp: new Date(),
                    model: modelId,
                    searchCount: latestSearchCount,
                    codeExecutions: finalizedExecutions.length > 0 ? finalizedExecutions : undefined,
                };
                updateConversationMessages(assistantMessage);

                // Generate AI title if this is the first message
                if (targetConv && targetConv.messages.length === 0) {
                    try {
                        fetch('/api/chat/title', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ message: content }),
                        })
                            .then(res => res.json())
                            .then(data => {
                                if (data.title) {
                                    setConversations(prev => prev.map(c => {
                                        if (c.id === conversationId) {
                                            return { ...c, title: data.title };
                                        }
                                        return c;
                                    }));
                                }
                            })
                            .catch(e => console.error('Failed to generate title:', e));
                    } catch (e) {
                        // Ignore title generation errors
                    }
                }

            } catch (error: unknown) {
                const isAbort = error instanceof Error && error.name === 'AbortError';
                if (!isAbort && abortRef.current === controller) {
                    const errMsg = error instanceof Error ? error.message : 'An error occurred';
                    const errorMessage: Message = {
                        id: assistantId || uuidv4(),
                        role: 'assistant',
                        content: `⚠️ **Error:** ${errMsg}`,
                        timestamp: new Date(),
                        model: modelId,
                    };
                    updateConversationMessages(errorMessage);
                }
            } finally {
                clearTimeout(streamTimeout);
                if (streamFrame !== null) {
                    cancelAnimationFrame(streamFrame);
                    streamFrame = null;
                }

                if (abortRef.current === controller) {
                    abortRef.current = null;
                    stopShimmer();
                    setStreamingContent('');
                    setStreamingMessageId(null);
                    setStreamingCodeExecutions([]);
                    setIsLoading(false);
                    setCurrentTask('idle');
                    setCurrentTaskLabel('');
                }
            }
        },
        // Refs and state setters are stable; conversation actions are memoized in
        // useConversations. (isLoading is intentionally NOT tracked — matching the
        // original: rapid double-sends are prevented by the abort() above, not by
        // this closure's isLoading value.)
        [plan, startShimmer, stopShimmer, setConversations, activeConversationIdRef, conversationsRef],
    );

    const stopGeneration = useCallback(() => {
        abortRef.current?.abort();
    }, []);

    return {
        conversations,
        activeConversation,
        activeConversationId,
        setActiveConversationId,
        historyLoaded,
        isLoading,
        currentTask,
        currentTaskLabel,
        streamingContent,
        streamingMessageId,
        streamingSearchCount,
        streamingCodeExecutions,
        autoActivatedModes,
        sendMessage,
        stopGeneration,
        getTaskLabel,
        createConversation,
        selectConversation,
        saveConversation,
        deleteConversation,
        renameConversation,
    };
}
