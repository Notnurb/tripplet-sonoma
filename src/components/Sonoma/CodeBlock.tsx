'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useIsStreaming, useWebBundle } from './message-context';
import { openWebPreview } from './HtmlPreviewPanel';
import { hasRunnableBundle, normalizeLang } from './extract-blocks';
import { MermaidDiagram } from './MermaidDiagram';

interface CodeBlockProps {
    className?: string;
    children?: React.ReactNode;
}

function extractText(node: React.ReactNode): string {
    if (node == null || node === false) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(extractText).join('');
    if (typeof node === 'object' && 'props' in (node as { props?: { children?: unknown } })) {
        const props = (node as { props?: { children?: React.ReactNode } }).props;
        return extractText(props?.children);
    }
    return '';
}

export function CodeBlock({ className, children }: CodeBlockProps) {
    const streaming = useIsStreaming();
    const bundle = useWebBundle();
    const [copied, setCopied] = useState(false);
    const ref = useRef<HTMLPreElement | null>(null);

    const text = useMemo(() => extractText(children), [children]);

    const lang = useMemo(() => {
        const direct = /language-([\w-]+)/i.exec(className || '');
        if (direct) return normalizeLang(direct[1]);
        if (children && typeof children === 'object' && 'props' in (children as { props?: { className?: string } })) {
            const inner = (children as { props?: { className?: string } }).props?.className || '';
            const m2 = /language-([\w-]+)/i.exec(inner);
            if (m2) return normalizeLang(m2[1]);
        }
        return '';
    }, [className, children]);

    const isWebLang = lang === 'html' || lang === 'css' || lang === 'js' || lang === 'ts' || lang === 'jsx' || lang === 'tsx';
    const canRun = isWebLang && hasRunnableBundle(bundle);

    const handleCopy = useCallback(async () => {
        // Read text DIRECTLY from the rendered <pre> first — this is the
        // ground truth regardless of how rehype-highlight or future plugins
        // mangle the React children tree. Fall back to extractText only if
        // the ref isn't mounted (shouldn't happen, but defensive).
        const domText = ref.current?.textContent ?? '';
        const value = domText || text;
        if (!value) return;

        // Prefer the modern Clipboard API, but fall back to a hidden textarea
        // for insecure contexts (HTTP, file://) and browsers that reject the
        // permission. The previous empty catch silently failed and looked like
        // the button was broken.
        const fallbackCopy = (val: string) => {
            try {
                const ta = document.createElement('textarea');
                ta.value = val;
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
                return ok;
            } catch {
                return false;
            }
        };

        let ok = false;
        try {
            if (navigator.clipboard?.writeText && window.isSecureContext) {
                await navigator.clipboard.writeText(value);
                ok = true;
            } else {
                ok = fallbackCopy(value);
            }
        } catch {
            ok = fallbackCopy(value);
        }

        if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }
    }, [text]);

    const handleRun = useCallback(() => {
        if (streaming) return;
        const runText = ref.current?.textContent ?? text;
        // Prefer the bundle (siblings in the same message); fall back to this block alone.
        const blocks = bundle.length > 0 ? bundle : [{ lang: lang || 'html', code: runText }];
        openWebPreview(blocks);
    }, [streaming, bundle, lang, text]);

    // Copy is allowed even mid-stream — partial code is still useful. Run
    // still requires the full bundle so it stays gated on streaming. Copy is
    // NEVER disabled — even if React-tree extraction returns empty, the DOM
    // ref will pick up whatever's rendered.
    const runDisabled = streaming;
    const copyDisabled = false;

    // Mermaid blocks render as actual diagrams (flowcharts, sequence, class,
    // ER, gantt, etc.) instead of a plain code block.
    if (lang === 'mermaid') {
        return <MermaidDiagram code={text} />;
    }

    return (
        <div
            className="group relative my-3 overflow-hidden rounded-xl border"
            style={{
                background: 'oklch(0.21 0.018 50)',
                borderColor: 'oklch(0.30 0.020 50)',
            }}
        >
            <div
                className="flex items-center justify-between border-b px-3 py-1.5"
                style={{
                    background: 'oklch(0.24 0.020 50)',
                    borderColor: 'oklch(0.30 0.020 50)',
                }}
            >
                <span
                    className="text-[11px] font-medium uppercase tracking-wider"
                    style={{ color: 'oklch(0.70 0.018 75)', fontFamily: 'var(--font-mono)' }}
                >
                    {lang || 'code'}
                </span>
                <div className="flex items-center gap-1.5">
                    {canRun && (
                        <button
                            type="button"
                            onClick={handleRun}
                            disabled={runDisabled}
                            title={runDisabled ? 'Wait until done streaming' : 'Run web bundle (HTML/CSS/JS/TS)'}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                            style={{
                                color: 'oklch(0.86 0.014 75)',
                                background: 'oklch(0.30 0.025 50)',
                            }}
                            onMouseEnter={(e) => {
                                if (!runDisabled) e.currentTarget.style.background = 'oklch(0.36 0.030 50)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'oklch(0.30 0.025 50)';
                            }}
                        >
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden>
                                <path d="M8 5v14l11-7z" />
                            </svg>
                            Run
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleCopy}
                        disabled={copyDisabled}
                        aria-label={copied ? 'Copied' : 'Copy code'}
                        title={copyDisabled ? 'Nothing to copy' : copied ? 'Copied' : 'Copy code'}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                        style={{
                            color: copied ? 'oklch(0.88 0.14 145)' : 'oklch(0.86 0.014 75)',
                            background: 'oklch(0.30 0.025 50)',
                        }}
                        onMouseEnter={(e) => {
                            if (!copyDisabled) e.currentTarget.style.background = 'oklch(0.36 0.030 50)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'oklch(0.30 0.025 50)';
                        }}
                    >
                        {copied ? (
                            <>
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                                Copied
                            </>
                        ) : (
                            <>
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                                Copy
                            </>
                        )}
                    </button>
                </div>
            </div>
            <pre
                ref={ref}
                style={{
                    margin: 0,
                    padding: '14px 16px',
                    fontSize: 13,
                    lineHeight: 1.55,
                    fontFamily: 'var(--font-mono)',
                    color: 'oklch(0.94 0.012 75)',
                    overflow: 'auto',
                }}
            >
                {children}
            </pre>
        </div>
    );
}
