'use client';

import { useCallback, useMemo, useState } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { getModel } from '@/lib/ai/models';
import { cn } from '@/lib/utils';
import { ThinkingTool } from '@/components/ui/thinking-tool';
import {
    SonomaLogo,
    SonomaRefresh,
    SonomaCopy,
    SonomaCheck,
    SonomaThumbUp,
    SonomaThumbDown,
    SonomaFile,
    SonomaBrowse,
    SonomaReason,
    SonomaTerminal,
} from './icons';
import { CodeBlock } from './CodeBlock';
import { FileCard } from './FileCard';
import { StreamingProvider, BundleProvider } from './message-context';
import { extractWebBlocks } from './extract-blocks';
import { extractFiles } from './extract-files';

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

const markdownComponents: Components = {
    h1: ({ children }) => (
        <div
            className="font-semibold tracking-[-0.012em]"
            style={{ fontSize: 22, color: 'currentColor', margin: '18px 0 6px' }}
        >
            {children}
        </div>
    ),
    h2: ({ children }) => (
        <div
            className="font-semibold tracking-[-0.012em]"
            style={{ fontSize: 18.5, color: 'currentColor', margin: '18px 0 6px' }}
        >
            {children}
        </div>
    ),
    h3: ({ children }) => (
        <div
            className="font-semibold tracking-[-0.012em]"
            style={{ fontSize: 16, color: 'currentColor', margin: '18px 0 6px' }}
        >
            {children}
        </div>
    ),
    p: ({ children }) => (
        <p style={{ margin: '10px 0', textWrap: 'pretty' as never }}>{children}</p>
    ),
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em>{children}</em>,
    ul: ({ children }) => (
        <ul style={{ margin: '8px 0', paddingLeft: 22, listStyle: 'disc' }}>{children}</ul>
    ),
    ol: ({ children }) => (
        <ol style={{ margin: '8px 0', paddingLeft: 22, listStyle: 'decimal' }}>{children}</ol>
    ),
    li: ({ children }) => <li style={{ margin: '4px 0' }}>{children}</li>,
    a: ({ children, href }) => (
        <a
            href={href}
            target="_blank"
            rel="noreferrer"
            style={{
                color: 'var(--sonoma-accent-2)',
                textDecoration: 'underline',
                textUnderlineOffset: 2,
            }}
        >
            {children}
        </a>
    ),
    code({ inline, className, children, ...props }: {
        inline?: boolean;
        className?: string;
        children?: React.ReactNode;
    } & React.HTMLAttributes<HTMLElement>) {
        if (inline) {
            return (
                <code
                    className={cn(className)}
                    style={{
                        fontFamily: 'var(--font-mono)',
                        background: 'var(--sonoma-bg-2)',
                        color: 'var(--sonoma-ink)',
                        padding: '1px 6px',
                        borderRadius: 6,
                        fontSize: '0.92em',
                        border: '1px solid var(--sonoma-border)',
                    }}
                    {...props}
                >
                    {children}
                </code>
            );
        }
        return (
            <code className={className} {...props}>
                {children}
            </code>
        );
    },
    pre: ({ children, className }) => (
        <CodeBlock className={className}>{children}</CodeBlock>
    ),
    table: ({ children }) => (
        <div className="my-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm">{children}</table>
        </div>
    ),
    th: ({ children }) => (
        <th
            className="text-left font-semibold"
            style={{
                border: '1px solid var(--sonoma-border)',
                padding: '8px 12px',
                background: 'var(--sonoma-bg-2)',
                color: 'var(--sonoma-ink)',
            }}
        >
            {children}
        </th>
    ),
    td: ({ children }) => (
        <td style={{ border: '1px solid var(--sonoma-border)', padding: '8px 12px' }}>
            {children}
        </td>
    ),
};

function ToolBtn({
    title,
    onClick,
    active,
    children,
}: {
    title: string;
    onClick: () => void;
    active?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            title={title}
            onClick={onClick}
            className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg transition-colors"
            style={{ color: active ? 'var(--sonoma-ink)' : 'var(--sonoma-muted)' }}
            onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--sonoma-bg-2)';
                e.currentTarget.style.color = 'var(--sonoma-ink)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = active ? 'var(--sonoma-ink)' : 'var(--sonoma-muted)';
            }}
        >
            {children}
        </button>
    );
}

// ─── User message ──────────────────────────────────────────────────────────

interface UserFile {
    id: string;
    name: string;
    preview?: string;
    type: 'image' | 'file';
}

interface UserMessageProps {
    content: string;
    files?: UserFile[];
}

export function SonomaUserMessage({ content, files = [] }: UserMessageProps) {
    return (
        <div className="sm-fadeUp mt-6 mb-2 flex flex-col items-end gap-1.5">
            {files.length > 0 && (
                <div className="flex max-w-[78%] flex-wrap justify-end gap-1.5">
                    {files.map((f) => (
                        <div
                            key={f.id}
                            className="inline-flex items-center gap-2 rounded-xl text-[12.5px]"
                            style={{
                                padding: '6px 10px 6px 8px',
                                background: 'var(--sonoma-surface)',
                                border: '1px solid var(--sonoma-border)',
                                color: 'var(--sonoma-ink-2)',
                                boxShadow: 'var(--sonoma-shadow-sm)',
                            }}
                        >
                            {f.type === 'image' && f.preview ? (
                                 
                                <img
                                    src={f.preview}
                                    alt=""
                                    style={{ width: 22, height: 22, borderRadius: 4, objectFit: 'cover' }}
                                />
                            ) : (
                                <span style={{ color: 'var(--sonoma-muted)', display: 'inline-flex' }}>
                                    <SonomaFile />
                                </span>
                            )}
                            <span
                                style={{
                                    maxWidth: 180,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                }}
                            >
                                {f.name}
                            </span>
                        </div>
                    ))}
                </div>
            )}
            {content && (
                <div
                    className="sonoma-user-bubble whitespace-pre-wrap"
                    style={{
                        maxWidth: '78%',
                        background: 'var(--sonoma-pill)',
                        border: '1px solid var(--sonoma-border)',
                        padding: '10px 18px',
                        borderRadius: 22,
                        fontSize: 15.5,
                        color: 'var(--sonoma-ink)',
                        boxShadow: 'var(--sonoma-shadow-sm)',
                        overflowWrap: 'anywhere',
                    }}
                >
                    {content}
                </div>
            )}
        </div>
    );
}

// ─── Activity card ─────────────────────────────────────────────────────────

export interface SonomaActivity {
    id: string;
    tool: string;
    args: Record<string, unknown>;
    status: 'running' | 'done';
    result?: unknown;
    /** Client-side wall clock, set when the card first appears / completes. */
    startedAt?: number;
    elapsedMs?: number;
    /** run_on_machine only: gates real execution behind an in-chat prompt. */
    permission?: 'pending' | 'approved' | 'denied';
}

export type MachineDecision = 'yes' | 'always' | 'no';

/** 'composio_GITHUB_CREATE_AN_ISSUE' → { app: 'Github', action: 'create an issue' } */
function connectorParts(tool: string): { app: string; action: string } {
    const slug = tool.slice('composio_'.length);
    const [app = '', ...rest] = slug.split('_');
    return {
        app: app ? app.charAt(0) + app.slice(1).toLowerCase() : 'connector',
        action: rest.join(' ').toLowerCase(),
    };
}

function ActivityLabel({ a }: { a: SonomaActivity }) {
    if (a.tool.startsWith('composio_')) {
        const { app, action } = connectorParts(a.tool);
        return <>Using <span style={{ color: 'var(--sonoma-accent-2)' }}>{app}</span>{action ? ` · ${action}` : ''}</>;
    }
    switch (a.tool) {
        case 'web_search':
            return <>Searching the web for <code style={{ fontFamily: 'var(--font-mono)' }}>&ldquo;{String(a.args.query ?? '')}&rdquo;</code></>;
        case 'fetch_url':
            return <>Reading <span style={{ color: 'var(--sonoma-accent-2)' }}>{String(a.args.url ?? '')}</span></>;
        case 'run_python':
            return <>Running Python</>;
        case 'run_bash':
            return <>Running bash</>;
        case 'run_on_machine':
            return <>Running on <span style={{ color: 'var(--sonoma-accent-2)' }}>{String(a.args.machine_name ?? 'your machine')}</span></>;
        case 'search_past_chats': {
            const q = String(a.args.query ?? '').trim();
            return q
                ? <>Searching your past chats for <code style={{ fontFamily: 'var(--font-mono)' }}>&ldquo;{q}&rdquo;</code></>
                : <>Looking through your past chats</>;
        }
        case 'mermaid_diagram':
            return <>Rendering diagram {a.args.title ? `· ${String(a.args.title)}` : ''}</>;
        default:
            return <>{a.tool}</>;
    }
}

function MachinePermissionCard({
    a,
    onDecision,
}: {
    a: SonomaActivity;
    onDecision: (activityId: string, decision: MachineDecision) => void;
}) {
    const [confirmingAlways, setConfirmingAlways] = useState(false);
    const machineName = String(a.args.machine_name ?? 'your machine');
    const command = String(a.args.command ?? '');

    return (
        <div
            className="my-1.5 rounded-[12px]"
            style={{
                background: 'var(--sonoma-surface)',
                border: '1px solid color-mix(in oklch, var(--sonoma-accent) 40%, var(--sonoma-border))',
                padding: '10px 12px',
            }}
        >
            <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--sonoma-ink)' }}>
                <SonomaTerminal size={14} />
                <span>
                    Run on <span style={{ color: 'var(--sonoma-accent-2)' }}>{machineName}</span>?
                </span>
            </div>
            <pre
                className="mt-2 max-h-[140px] overflow-auto text-[12px]"
                style={{
                    fontFamily: 'var(--font-mono)',
                    background: 'oklch(0.21 0.018 50)',
                    color: 'oklch(0.94 0.012 75)',
                    padding: 10,
                    borderRadius: 10,
                }}
            >
                {command}
            </pre>

            {!confirmingAlways ? (
                <div className="mt-2.5 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => onDecision(a.id, 'yes')}
                        className="rounded-full px-3.5 py-1.5 text-[12.5px] font-medium"
                        style={{ background: 'var(--sonoma-accent)', color: 'var(--sonoma-accent-ink, #fff)' }}
                    >
                        Yes
                    </button>
                    <button
                        type="button"
                        onClick={() => setConfirmingAlways(true)}
                        className="rounded-full px-3.5 py-1.5 text-[12.5px] font-medium"
                        style={{ border: '1px solid var(--sonoma-border)', color: 'var(--sonoma-ink-2)', background: 'transparent' }}
                    >
                        Always Accept
                    </button>
                    <button
                        type="button"
                        onClick={() => onDecision(a.id, 'no')}
                        className="rounded-full px-3.5 py-1.5 text-[12.5px] font-medium"
                        style={{ border: '1px solid var(--sonoma-border)', color: 'var(--destructive)', background: 'transparent' }}
                    >
                        No
                    </button>
                </div>
            ) : (
                <div
                    className="mt-2.5 rounded-[10px] p-2.5"
                    style={{ background: 'var(--sonoma-bg-2)', border: '1px solid var(--sonoma-border)' }}
                >
                    <div className="text-[12.5px]" style={{ color: 'var(--sonoma-ink)' }}>
                        Always allow Sonoma to run commands on <b>{machineName}</b> without asking, for the
                        rest of this session?
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => onDecision(a.id, 'always')}
                            className="rounded-full px-3.5 py-1.5 text-[12.5px] font-medium"
                            style={{ background: 'var(--sonoma-accent)', color: 'var(--sonoma-accent-ink, #fff)' }}
                        >
                            Confirm
                        </button>
                        <button
                            type="button"
                            onClick={() => setConfirmingAlways(false)}
                            className="rounded-full px-3.5 py-1.5 text-[12.5px] font-medium"
                            style={{ border: '1px solid var(--sonoma-border)', color: 'var(--sonoma-ink-2)', background: 'transparent' }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function ActivityCard({
    a,
    onMachineDecision,
}: {
    a: SonomaActivity;
    onMachineDecision?: (activityId: string, decision: MachineDecision) => void;
}) {
    const [open, setOpen] = useState(false);
    const running = a.status === 'running';

    if (a.tool === 'run_on_machine' && a.permission === 'pending' && onMachineDecision) {
        return <MachinePermissionCard a={a} onDecision={onMachineDecision} />;
    }

    let body: React.ReactNode = null;
    if (a.tool === 'web_search' && a.result && typeof a.result === 'object') {
        const r = a.result as { results?: { title: string; url: string; snippet: string }[]; error?: string };
        if (r.error) body = <div style={{ color: 'var(--destructive)' }}>{r.error}</div>;
        else if (r.results) {
            body = (
                <div className="flex flex-col gap-2">
                    {r.results.map((it, i) => (
                        <a
                            key={i}
                            href={it.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded-[10px] p-2.5"
                            style={{
                                background: 'var(--sonoma-bg-2)',
                                border: '1px solid var(--sonoma-border)',
                            }}
                        >
                            <div
                                className="text-[12.5px] font-medium"
                                style={{ color: 'var(--sonoma-accent-2)' }}
                            >
                                [{i + 1}] {it.title}
                            </div>
                            <div className="mt-0.5 text-[11.5px]" style={{ color: 'var(--sonoma-faint)' }}>
                                {it.url}
                            </div>
                            {it.snippet && (
                                <div className="mt-1 text-[12px]" style={{ color: 'var(--sonoma-ink-2)' }}>
                                    {it.snippet}
                                </div>
                            )}
                        </a>
                    ))}
                </div>
            );
        }
    } else if (a.tool === 'fetch_url' && a.result && typeof a.result === 'object') {
        const r = a.result as { text?: string; error?: string };
        body = (
            <div
                className="max-h-[260px] overflow-y-auto whitespace-pre-wrap text-[12.5px]"
                style={{
                    fontFamily: 'var(--font-mono)',
                    background: 'var(--sonoma-bg-2)',
                    padding: 10,
                    borderRadius: 10,
                    border: '1px solid var(--sonoma-border)',
                    color: 'var(--sonoma-ink-2)',
                }}
            >
                {r.error ? `Error: ${r.error}` : r.text}
            </div>
        );
    } else if (a.tool === 'run_python' || a.tool === 'run_bash' || a.tool === 'run_on_machine') {
        const code = String(a.tool === 'run_python' ? a.args.code ?? '' : a.args.command ?? '');
        const out =
            a.permission === 'denied'
                ? 'Command declined.'
                : a.result && typeof a.result === 'object'
                ? (a.result as { output?: string; error?: string }).output ??
                  (a.result as { error?: string }).error ??
                  ''
                : '';
        body = (
            <div className="flex flex-col gap-2">
                <pre
                    className="max-h-[200px] overflow-auto text-[12px]"
                    style={{
                        fontFamily: 'var(--font-mono)',
                        background: 'oklch(0.21 0.018 50)',
                        color: 'oklch(0.94 0.012 75)',
                        padding: 10,
                        borderRadius: 10,
                    }}
                >
                    {code}
                </pre>
                {out && (
                    <pre
                        className="max-h-[160px] overflow-auto text-[12px]"
                        style={{
                            fontFamily: 'var(--font-mono)',
                            background: 'var(--sonoma-bg-2)',
                            border: '1px solid var(--sonoma-border)',
                            padding: 10,
                            borderRadius: 10,
                            color: 'var(--sonoma-ink-2)',
                        }}
                    >
                        {out}
                    </pre>
                )}
            </div>
        );
    } else if (a.tool.startsWith('composio_') && (a.result || Object.keys(a.args ?? {}).length > 0)) {
        const r = (a.result ?? {}) as { successful?: boolean; error?: string; data?: unknown };
        body = (
            <div className="flex flex-col gap-2">
                {Object.keys(a.args ?? {}).length > 0 && (
                    <pre
                        className="max-h-[140px] overflow-auto text-[12px]"
                        style={{
                            fontFamily: 'var(--font-mono)',
                            background: 'var(--sonoma-bg-2)',
                            border: '1px solid var(--sonoma-border)',
                            padding: 10,
                            borderRadius: 10,
                            color: 'var(--sonoma-ink-2)',
                        }}
                    >
                        {JSON.stringify(a.args, null, 2)}
                    </pre>
                )}
                {r.error && <div style={{ color: 'var(--destructive)' }}>{r.error}</div>}
                {r.data !== undefined && (
                    <pre
                        className="max-h-[220px] overflow-auto whitespace-pre-wrap text-[12px]"
                        style={{
                            fontFamily: 'var(--font-mono)',
                            background: 'var(--sonoma-bg-2)',
                            border: '1px solid var(--sonoma-border)',
                            padding: 10,
                            borderRadius: 10,
                            color: 'var(--sonoma-ink-2)',
                        }}
                    >
                        {typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2)}
                    </pre>
                )}
            </div>
        );
    } else if (a.tool === 'mermaid_diagram' && a.result && typeof a.result === 'object') {
        const r = a.result as { source?: string };
        body = (
            <pre
                className="max-h-[220px] overflow-auto text-[12px]"
                style={{
                    fontFamily: 'var(--font-mono)',
                    background: 'var(--sonoma-bg-2)',
                    border: '1px solid var(--sonoma-border)',
                    padding: 10,
                    borderRadius: 10,
                    color: 'var(--sonoma-ink-2)',
                }}
            >
                {r.source}
            </pre>
        );
    }

    return (
        <div
            className="my-1.5 rounded-[12px]"
            style={{
                background: 'var(--sonoma-surface)',
                border: '1px solid var(--sonoma-border)',
                padding: '8px 10px',
            }}
        >
            <button
                type="button"
                onClick={() => body && setOpen((o) => !o)}
                className="flex w-full items-center gap-2 text-left text-[13px]"
                style={{ color: 'var(--sonoma-ink-2)' }}
            >
                <span
                    className="inline-flex h-4 w-4 items-center justify-center"
                    style={{ color: running ? 'var(--sonoma-accent)' : 'var(--sonoma-ok)' }}
                >
                    {a.tool === 'web_search' || a.tool === 'fetch_url' || a.tool.startsWith('composio_') ? (
                        <SonomaBrowse size={14} />
                    ) : a.tool === 'run_bash' || a.tool === 'run_python' || a.tool === 'run_on_machine' ? (
                        <SonomaTerminal size={14} />
                    ) : (
                        <SonomaReason size={14} />
                    )}
                </span>
                <span className="flex-1 truncate">
                    <ActivityLabel a={a} />
                </span>
                {running ? (
                    <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{
                            background: 'var(--sonoma-accent)',
                            animation: 'sm-pulse 1.4s ease-in-out infinite',
                        }}
                    />
                ) : (
                    <span
                        className="text-[11px]"
                        style={{ color: 'var(--sonoma-ok)' }}
                    >
                        done{typeof a.elapsedMs === 'number' ? ` · ${(a.elapsedMs / 1000).toFixed(1)}s` : ''}
                    </span>
                )}
            </button>
            {open && body && <div className="mt-2">{body}</div>}
        </div>
    );
}

// ─── Assistant message ─────────────────────────────────────────────────────

interface AssistantMessageProps {
    modelId?: string;
    content: string;
    thinking?: string;
    activity?: SonomaActivity[];
    isStreaming?: boolean;
    onRegenerate?: () => void;
    /** Render the body in white — used over the dark code-page background. */
    white?: boolean;
    /** run_on_machine only: called when the user picks Yes / Always Accept / No. */
    onMachineDecision?: (activityId: string, decision: MachineDecision) => void;
}

export function SonomaAssistantMessage({
    modelId,
    content,
    thinking,
    activity = [],
    isStreaming,
    onRegenerate,
    white,
    onMachineDecision,
}: AssistantMessageProps) {
    const [copied, setCopied] = useState(false);
    const [rated, setRated] = useState<'up' | 'down' | null>(null);

    const modelName = useMemo(() => {
        if (!modelId) return 'Tripplet';
        try {
            return getModel(modelId).name;
        } catch {
            return modelId;
        }
    }, [modelId]);

    const handleCopy = useCallback(() => {
        navigator.clipboard?.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
    }, [content]);


    // Pull downloadable files out of the body — they render as pills at the
    // bottom of the message instead of inline. While streaming, an unclosed
    // file block stays in the body until its closing fence arrives.
    const { body, files } = useMemo(() => extractFiles(content || ''), [content]);

    return (
        <div className="sm-fadeUp" style={{ margin: '8px 0 28px' }}>
            <div className="mb-1.5 flex items-center gap-2">
                <span
                    className="inline-flex h-[18px] w-[18px] items-center justify-center rounded"
                    style={{ color: white ? '#ffffff' : 'var(--sonoma-accent)' }}
                >
                    <SonomaLogo size={14} color="currentColor" />
                </span>
                <span
                    style={{
                        fontFamily: 'var(--font-serif)',
                        fontStyle: 'italic',
                        fontWeight: 400,
                        color: white ? 'rgba(255,255,255,0.72)' : 'var(--sonoma-muted)',
                        fontSize: 13,
                    }}
                >
                    {modelName}
                </span>
            </div>

            {/* Thinking */}
            {thinking !== undefined && (
                <div className="my-1.5">
                    <ThinkingTool
                        state={isStreaming && !content ? 'thinking' : 'thought'}
                        content={thinking}
                        defaultOpen={isStreaming && !content}
                    />
                </div>
            )}

            {/* Activity cards */}
            {activity.length > 0 && (
                <div className="my-1.5 flex flex-col">
                    {activity.map((a) => (
                        <ActivityCard key={a.id} a={a} onMachineDecision={onMachineDecision} />
                    ))}
                </div>
            )}

            {/* Markdown content */}
            <div
                className="markdown-content"
                style={{ fontSize: 15.5, color: white ? '#f5f5f5' : 'var(--sonoma-ink)', lineHeight: 1.65 }}
            >
                <StreamingProvider value={!!isStreaming}>
                    <BundleProvider value={extractWebBlocks(content || '')}>
                        <ReactMarkdown
                            remarkPlugins={REMARK_PLUGINS}
                            rehypePlugins={REHYPE_PLUGINS}
                            components={markdownComponents}
                        >
                            {body}
                        </ReactMarkdown>
                    </BundleProvider>
                </StreamingProvider>
                {isStreaming && (
                    <span
                        className="inline-block align-text-bottom"
                        style={{
                            width: 8,
                            height: 16,
                            marginLeft: 2,
                            background: 'var(--sonoma-accent)',
                            borderRadius: 2,
                            animation: 'sm-blink 1s steps(2, end) infinite',
                        }}
                    />
                )}
            </div>

            {/* Attached files — download pills at the bottom of the message */}
            {files.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                    {files.map((f, i) => (
                        <FileCard key={`${f.name}-${i}`} name={f.name} content={f.content} />
                    ))}
                </div>
            )}

            {!isStreaming && content && (
                <div className="mt-2.5 -ml-1.5 flex items-center gap-0.5">
                    {onRegenerate && (
                        <ToolBtn title="Regenerate" onClick={onRegenerate}>
                            <SonomaRefresh />
                        </ToolBtn>
                    )}
                    <ToolBtn title={copied ? 'Copied' : 'Copy'} onClick={handleCopy}>
                        {copied ? (
                            <SonomaCheck style={{ color: 'var(--sonoma-ok)' }} />
                        ) : (
                            <SonomaCopy />
                        )}
                    </ToolBtn>
                    <ToolBtn
                        title="Good response"
                        onClick={() => setRated((r) => (r === 'up' ? null : 'up'))}
                        active={rated === 'up'}
                    >
                        <SonomaThumbUp />
                    </ToolBtn>
                    <ToolBtn
                        title="Bad response"
                        onClick={() => setRated((r) => (r === 'down' ? null : 'down'))}
                        active={rated === 'down'}
                    >
                        <SonomaThumbDown />
                    </ToolBtn>
                </div>
            )}
        </div>
    );
}
