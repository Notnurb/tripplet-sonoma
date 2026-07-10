'use client';

import React, { memo, useMemo, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Message, CodeExecution } from '@/types';
import { formatMessageDate } from '@/lib/utils/format-date';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import AgentPanel from '@/components/Chat/AgentPanel';
import SearchResults from '@/components/Chat/SearchResults';
import { TextShimmerWave } from '@/components/ui/text-shimmer-wave';
import AnimatedCounter from '@/components/ui/animated-counter';
import { motion } from 'framer-motion';
import { getModel } from '@/lib/ai/models';
import { LockIcon, Copy, Check, ThumbsUp, ThumbsDown, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useReducedMotionPreference } from '@/hooks/useReducedMotionPreference';

const CodeBlock = dynamic(() => import('@/components/Chat/CodeBlock'), { ssr: false });


function extractText(node: React.ReactNode): string {
    if (typeof node === 'string') return node;
    if (typeof node === 'number') return String(node);
    if (!node) return '';
    if (Array.isArray(node)) return node.map(extractText).join('');
    if (typeof node === 'object' && 'props' in node) return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
    return '';
}

const MARKDOWN_REMARK_PLUGINS = [remarkGfm];
const MARKDOWN_REHYPE_PLUGINS = [rehypeHighlight];

// Error boundary so a malformed AI response doesn't crash the entire chat
class MarkdownErrorBoundary extends React.Component<
    { children: React.ReactNode; fallbackText: string },
    { hasError: boolean }
> {
    state = { hasError: false };
    static getDerivedStateFromError() { return { hasError: true }; }
    render() {
        if (this.state.hasError) {
            return <p className="text-sm whitespace-pre-wrap break-words">{this.props.fallbackText}</p>;
        }
        return this.props.children;
    }
}

function normalizeCodeLanguage(language?: string): string {
    const normalized = (language || '').toLowerCase();
    if (normalized === 'sh' || normalized === 'shell' || normalized === 'zsh') return 'bash';
    if (normalized === 'py') return 'python';
    return normalized;
}

function normalizeCodeValue(value: string): string {
    return value.replace(/\r\n/g, '\n').trim();
}

function hasMarkdownCodeFence(content: string): boolean {
    return /```/.test(content);
}

interface MessageBubbleProps {
    message: Message;
    isStreaming?: boolean;
    taskLabel?: string;
    streamingContent?: string;
    searchCount?: number;
    codeExecutions?: CodeExecution[];
    onRegenerate?: () => void;
    conversationId?: string;
}

function MessageBubble({
    message,
    isStreaming,
    taskLabel,
    streamingContent,
    searchCount,
    codeExecutions,
    onRegenerate,
    conversationId,
}: MessageBubbleProps) {
    const isUser = message.role === 'user';
    const isAssistant = message.role === 'assistant';
    const isStreamingAssistant = Boolean(isStreaming && isAssistant);
    const reducedMotion = useReducedMotionPreference();

    const [copied, setCopied] = useState(false);
    const [liked, setLiked] = useState(false);
    const [disliked, setDisliked] = useState(false);

    const handleCopy = useCallback(() => {
        const text = isStreaming && streamingContent ? streamingContent : message.content;
        if (!text) return;
        const markCopied = () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        };
        // Hidden-textarea fallback for insecure contexts (HTTP, file://),
        // older Safari, and Brave's hardened clipboard. We must NOT rely on
        // `.then().catch()` here — if `navigator.clipboard` is undefined, the
        // call throws synchronously and skips the promise chain entirely.
        const fallback = () => {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.top = '0';
                ta.style.left = '0';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                ta.setSelectionRange(0, ta.value.length);
                const ok = document.execCommand('copy');
                document.body.removeChild(ta);
                if (ok) markCopied();
            } catch {
                /* give up silently */
            }
        };

        if (navigator.clipboard?.writeText && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(markCopied).catch(fallback);
        } else {
            fallback();
        }
    }, [message.content, isStreaming, streamingContent]);

    const sendFeedback = useCallback(
        async (rating: 1 | -1 | 0) => {
            try {
                await fetch('/api/feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messageId: message.id,
                        rating,
                        conversationId: conversationId ?? null,
                        model: message.model ?? null,
                        content: message.content ?? '',
                    }),
                });
            } catch {
                // Non-fatal — UI state already updated optimistically.
            }
        },
        [message.id, message.model, message.content, conversationId],
    );

    const handleLike = useCallback(() => {
        if (liked) {
            // Toggle off — clear the rating both locally and server-side.
            setLiked(false);
            sendFeedback(0);
            return;
        }
        setLiked(true);
        setDisliked(false);
        sendFeedback(1);
        toast('Thanks — Tripplet will lean into this style.', { duration: 2500 });
    }, [liked, sendFeedback]);

    const handleDislike = useCallback(() => {
        if (disliked) {
            setDisliked(false);
            sendFeedback(0);
            return;
        }
        setDisliked(true);
        setLiked(false);
        sendFeedback(-1);
        toast('Got it — Tripplet will adjust for next time.', { duration: 2500 });
    }, [disliked, sendFeedback]);

    const modelName = useMemo(() => {
        if (!message.model) return 'Tripplet';
        try {
            return getModel(message.model).name;
        } catch {
            return message.model;
        }
    }, [message.model]);

    const displayContent = isStreaming && streamingContent ? streamingContent : message.content;
    const visibleSearchCount = typeof searchCount === 'number' ? searchCount : message.searchCount;
    const visibleCodeExecutions = codeExecutions ?? message.codeExecutions ?? [];
    const shouldRenderProvisionalExecutions = visibleCodeExecutions.length > 0 && !hasMarkdownCodeFence(displayContent);
    const markdownComponents = useMemo(() => {
        const usedExecutionIds = new Set<string>();

        const findMatchingExecution = (language: string, value: string) => {
            const normalizedLanguage = normalizeCodeLanguage(language);
            const normalizedValue = normalizeCodeValue(value);

            return visibleCodeExecutions.find((execution) => {
                if (usedExecutionIds.has(execution.id)) return false;
                if (normalizeCodeLanguage(execution.language) !== normalizedLanguage) return false;
                return normalizeCodeValue(execution.code) === normalizedValue;
            });
        };

        return {
            h1({ children, ...props }: any) {
                return <h1 {...props} className="text-2xl font-bold mt-6 mb-3 text-foreground">{children}</h1>;
            },
            h2({ children, ...props }: any) {
                return <h2 {...props} className="text-xl font-semibold mt-5 mb-2 text-foreground">{children}</h2>;
            },
            h3({ children, ...props }: any) {
                return <h3 {...props} className="text-lg font-semibold mt-4 mb-2 text-foreground">{children}</h3>;
            },
            h4({ children, ...props }: any) {
                return <h4 {...props} className="text-base font-semibold mt-3 mb-1.5 text-foreground">{children}</h4>;
            },
            p({ children, ...props }: any) {
                return <p {...props} className="mb-3 last:mb-0 leading-relaxed">{children}</p>;
            },
            strong({ children, ...props }: any) {
                return <strong {...props} className="font-bold text-foreground">{children}</strong>;
            },
            em({ children, ...props }: any) {
                return <em {...props} className="italic">{children}</em>;
            },
            ul({ children, ...props }: any) {
                return <ul {...props} className="list-disc list-outside pl-5 mb-3 space-y-1">{children}</ul>;
            },
            ol({ children, ...props }: any) {
                return <ol {...props} className="list-decimal list-outside pl-5 mb-3 space-y-1">{children}</ol>;
            },
            li({ children, ...props }: any) {
                return <li {...props} className="leading-relaxed">{children}</li>;
            },
            blockquote({ children, ...props }: any) {
                return (
                    <blockquote {...props} className="border-l-4 border-brand/40 pl-4 my-3 italic text-muted-foreground">
                        {children}
                    </blockquote>
                );
            },
            a({ children, href, ...props }: any) {
                return (
                    <a {...props} href={href} target="_blank" rel="noopener noreferrer" className="text-brand underline hover:text-brand/80 transition-colors">
                        {children}
                    </a>
                );
            },
            hr({ ...props }: any) {
                return <hr {...props} className="my-4 border-border" />;
            },
            code({ inline, className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || '');
                if (!inline && match) {
                    const value = extractText(children).replace(/\n$/, '');
                    const execution = findMatchingExecution(match[1], value);
                    if (execution) {
                        usedExecutionIds.add(execution.id);
                    }

                    return (
                        <CodeBlock
                            language={match[1]}
                            value={value}
                            execution={execution}
                            {...props}
                        />
                    );
                }

                return (
                    <code className={cn("bg-accent px-1.5 py-0.5 rounded-md font-mono text-[0.9em]", className)} {...props}>
                        {children}
                    </code>
                );
            },
            table({ children, ...props }: any) {
                return (
                    <div className="overflow-x-auto my-3">
                        <table {...props} className="w-full border-collapse text-sm">{children}</table>
                    </div>
                );
            },
            th({ children, ...props }: any) {
                return <th {...props} className="border border-border px-3 py-2 text-left font-semibold bg-muted/50">{children}</th>;
            },
            td({ children, ...props }: any) {
                return <td {...props} className="border border-border px-3 py-2">{children}</td>;
            },
        };
    }, [visibleCodeExecutions]);

    // ── User bubble ───────────────────────────────────────────────────────────
    if (isUser) {
        return (
            <motion.div
                layout={!reducedMotion}
                initial={reducedMotion ? false : { opacity: 0, y: 8, filter: 'blur(6px)', x: 20 }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)', x: 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.25, ease: 'easeOut' }}
                className="flex justify-end mb-5"
            >
                <div className="max-w-[72%] bg-gradient-to-br from-brand/15 to-brand/5 hover:from-brand/20 hover:to-brand/10 text-foreground rounded-3xl rounded-br-lg px-5 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words border border-brand/10 hover:border-brand/20 transition-all duration-300 shadow-sm hover:shadow-md">
                    {message.content}
                </div>
            </motion.div>
        );
    }

    // ── Assistant message ─────────────────────────────────────────────────────
    return (
        <motion.div
            layout={!reducedMotion}
            initial={reducedMotion ? false : { opacity: 0, y: 10, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: reducedMotion ? 0 : 0.22, ease: 'easeOut' }}
            className="flex gap-3 mb-6 group"
        >
            <Avatar className={cn(
                "h-7 w-7 mt-0.5 shrink-0 transition-all duration-600",
                // Variable-ratio micro-sparkle: ~12% of responses get a ring glow
                message.id && (parseInt(message.id.replace(/\D/g, '').slice(-2) || '0', 10) % 8 === 0)
                    && !reducedMotion
                    && "ring-2 ring-violet-400/40 ring-offset-1 ring-offset-background animate-pulse [animation-iteration-count:2]"
            )}>
                <AvatarFallback className="bg-foreground/10 text-foreground/70 text-xs font-semibold">AI</AvatarFallback>
            </Avatar>

            <div className="flex flex-col min-w-0 flex-1">
                {/* Name + timestamp */}
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-foreground/80">{modelName}</span>
                    {isStreamingAssistant && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/8 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                            <span className={cn('h-1.5 w-1.5 rounded-full bg-emerald-400', !reducedMotion && 'animate-pulse')} />
                            Live
                        </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">{formatMessageDate(message.timestamp)}</span>
                </div>

                {/* Content — no bubble */}
                <div className="text-sm leading-relaxed text-foreground">
                    {/* Shimmer task indicator */}
                    {isStreaming && isAssistant && taskLabel && !streamingContent && (
                        <div className="mb-2">
                            <TextShimmerWave className="font-mono text-sm" duration={1}>
                                {taskLabel}
                            </TextShimmerWave>
                        </div>
                    )}

                    {/* Search count */}
                    {isStreaming && isAssistant && typeof visibleSearchCount === 'number' && (
                        <div className="flex items-center gap-2 mb-3 px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 w-fit">
                            <span className="text-xs font-medium text-indigo-300">Results found:</span>
                            <AnimatedCounter
                                value={visibleSearchCount}
                                className="text-xs font-bold text-indigo-400 font-mono"
                            />
                        </div>
                    )}

                    {shouldRenderProvisionalExecutions && (
                        <div className="mb-4 space-y-4">
                            {visibleCodeExecutions.map((execution) => (
                                <CodeBlock
                                    key={execution.id}
                                    language={execution.language}
                                    value={execution.code}
                                    execution={execution}
                                />
                            ))}
                        </div>
                    )}

                    {isStreamingAssistant ? (
                        <div className="markdown-content relative">
                            <MarkdownErrorBoundary fallbackText={displayContent}>
                                <ReactMarkdown
                                    remarkPlugins={MARKDOWN_REMARK_PLUGINS}
                                    rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
                                    components={markdownComponents}
                                    className="max-w-none break-words"
                                >
                                    {displayContent}
                                </ReactMarkdown>
                            </MarkdownErrorBoundary>
                            {streamingContent ? (
                                <span
                                    className={cn(
                                        'inline-block w-[3px] h-[1em] ml-0.5 align-middle bg-foreground/60 rounded-[1px]',
                                        !reducedMotion && 'animate-[blink_1s_step-start_infinite]'
                                    )}
                                    aria-hidden="true"
                                />
                            ) : ''}
                        </div>
                    ) : message.content.includes(':::sign-in-placeholder:::') ? (
                        <div className="flex flex-col items-center justify-center p-6 bg-muted/30 border border-muted rounded-xl gap-3 text-center w-full max-w-[300px]">
                            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                                <LockIcon className="w-5 h-5 text-muted-foreground" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-medium">Sign in to view media</p>
                                <p className="text-xs text-muted-foreground">Guest users cannot generate images.</p>
                            </div>
                            <Button asChild variant="outline" size="sm" className="w-full mt-2">
                                <Link href="/sign-in">Sign In</Link>
                            </Button>
                        </div>
                    ) : (
                        <div className="markdown-content">
                            <MarkdownErrorBoundary fallbackText={displayContent}>
                                <ReactMarkdown
                                    remarkPlugins={MARKDOWN_REMARK_PLUGINS}
                                    rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
                                    components={markdownComponents}
                                    className="max-w-none break-words"
                                >
                                    {displayContent}
                                </ReactMarkdown>
                            </MarkdownErrorBoundary>
                        </div>
                    )}

                    {/* Search Results */}
                    {isAssistant && message.searchResults && message.searchResults.length > 0 && (
                        <SearchResults results={message.searchResults} />
                    )}

                    {/* Agent Collaboration Panel */}
                    {isAssistant && message.agents && message.agents.length > 0 && (
                        <AgentPanel
                            agents={message.agents}
                            isCollaborating={false}
                            synthesis={message.isCollaboration ? message.content : undefined}
                        />
                    )}
                </div>

                {/* Action row */}
                {!isStreamingAssistant && message.content && (
                    <motion.div
                        initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: -4 }}
                        whileInView={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: 0.1 }}
                        className="flex items-center gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <ActionButton onClick={handleCopy} label={copied ? 'Copied' : 'Copy'}>
                            {copied
                                ? <Check className="h-[15px] w-[15px] text-emerald-400" />
                                : <Copy className="h-[15px] w-[15px]" />}
                        </ActionButton>
                        <ActionButton
                            onClick={handleLike}
                            label="Good response"
                            active={liked}
                            className={liked ? 'text-brand' : ''}
                        >
                            <ThumbsUp className={cn('h-[15px] w-[15px]', liked && 'fill-current text-brand')} />
                        </ActionButton>
                        <ActionButton
                            onClick={handleDislike}
                            label="Bad response"
                            active={disliked}
                            className={disliked ? 'text-destructive' : ''}
                        >
                            <ThumbsDown className={cn('h-[15px] w-[15px]', disliked && 'fill-current text-destructive')} />
                        </ActionButton>
                        {onRegenerate && (
                            <ActionButton onClick={onRegenerate} label="Regenerate">
                                <RefreshCw className="h-[15px] w-[15px]" />
                            </ActionButton>
                        )}
                    </motion.div>
                )}
            </div>
        </motion.div>
    );
}

function ActionButton({
    onClick,
    label,
    active,
    className,
    children,
}: {
    onClick: () => void;
    label: string;
    active?: boolean;
    className?: string;
    children: React.ReactNode;
}) {
    const [isPressed, setIsPressed] = React.useState(false);
    const reducedMotion = useReducedMotionPreference();

    return (
        <motion.button
            type="button"
            onClick={() => {
                setIsPressed(true);
                setTimeout(() => setIsPressed(false), 200);
                onClick();
            }}
            title={label}
            aria-label={label}
            whileHover={reducedMotion ? undefined : { scale: 1.08 }}
            whileTap={reducedMotion ? undefined : { scale: 0.95 }}
            className={cn(
                'flex items-center justify-center p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all duration-200 relative',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                active && 'text-foreground bg-muted/50',
                className,
            )}
        >
            <motion.div
                initial={{ scale: 1 }}
                animate={isPressed ? { scale: 1.3, opacity: 0 } : { scale: 1, opacity: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="absolute inset-0 rounded-lg bg-muted/30"
            />
            {children}
        </motion.button>
    );
}

function areMessageBubblePropsEqual(prev: MessageBubbleProps, next: MessageBubbleProps) {
    return (
        prev.message === next.message &&
        prev.isStreaming === next.isStreaming &&
        prev.taskLabel === next.taskLabel &&
        prev.streamingContent === next.streamingContent &&
        prev.searchCount === next.searchCount &&
        prev.codeExecutions === next.codeExecutions &&
        prev.onRegenerate === next.onRegenerate
    );
}

export default memo(MessageBubble, areMessageBubblePropsEqual);
