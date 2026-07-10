'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useIsStreaming } from './message-context';

let mermaidInit = false;

async function getMermaid() {
    const mod = await import('mermaid');
    const mermaid = mod.default;
    if (!mermaidInit) {
        mermaid.initialize({
            startOnLoad: false,
            theme: 'neutral',
            securityLevel: 'strict',
            fontFamily: 'var(--font-sans, ui-sans-serif, system-ui)',
        });
        mermaidInit = true;
    }
    return mermaid;
}

interface MermaidDiagramProps {
    code: string;
}

export function MermaidDiagram({ code }: MermaidDiagramProps) {
    const streaming = useIsStreaming();
    const rawId = useId().replace(/[^a-zA-Z0-9]/g, '');
    const [svg, setSvg] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [showSource, setShowSource] = useState(false);
    const lastRendered = useRef('');

    useEffect(() => {
        // Don't try to render half-streamed, almost-certainly-invalid source.
        if (streaming) return;
        const source = code.trim();
        if (!source || source === lastRendered.current) return;

        let cancelled = false;
        (async () => {
            try {
                const mermaid = await getMermaid();
                // Validate first so a syntax error doesn't throw uncaught.
                await mermaid.parse(source);
                const { svg: out } = await mermaid.render(`mmd-${rawId}`, source);
                if (!cancelled) {
                    lastRendered.current = source;
                    setSvg(out);
                    setError(null);
                }
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : 'Could not render diagram.');
                    setSvg('');
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [code, streaming, rawId]);

    // While streaming, show the raw source so the user sees progress.
    if (streaming) {
        return (
            <pre
                className="my-3 overflow-auto rounded-xl p-3 text-[12.5px]"
                style={{
                    fontFamily: 'var(--font-mono)',
                    background: 'var(--sonoma-bg-2)',
                    border: '1px solid var(--sonoma-border)',
                    color: 'var(--sonoma-ink-2)',
                }}
            >
                {code}
            </pre>
        );
    }

    if (error) {
        return (
            <div
                className="my-3 rounded-xl p-3"
                style={{
                    background: 'var(--sonoma-bg-2)',
                    border: '1px solid var(--sonoma-border)',
                }}
            >
                <div className="mb-2 text-[12px]" style={{ color: 'var(--destructive)' }}>
                    Couldn&apos;t render diagram — showing source.
                </div>
                <pre
                    className="overflow-auto text-[12.5px]"
                    style={{ fontFamily: 'var(--font-mono)', color: 'var(--sonoma-ink-2)' }}
                >
                    {code}
                </pre>
            </div>
        );
    }

    if (!svg) {
        return (
            <div
                className="my-3 rounded-xl p-4 text-[12.5px]"
                style={{
                    background: 'var(--sonoma-bg-2)',
                    border: '1px solid var(--sonoma-border)',
                    color: 'var(--sonoma-muted)',
                }}
            >
                Rendering diagram…
            </div>
        );
    }

    return (
        <div
            className="group relative my-3 overflow-hidden rounded-xl"
            style={{
                background: 'var(--sonoma-surface)',
                border: '1px solid var(--sonoma-border)',
            }}
        >
            <button
                type="button"
                onClick={() => setShowSource((s) => !s)}
                className="absolute right-2 top-2 z-10 rounded-md px-2 py-1 text-[11px] font-medium opacity-0 transition-opacity group-hover:opacity-100"
                style={{
                    background: 'var(--sonoma-bg-2)',
                    border: '1px solid var(--sonoma-border)',
                    color: 'var(--sonoma-muted)',
                }}
            >
                {showSource ? 'Diagram' : 'Source'}
            </button>
            {showSource ? (
                <pre
                    className="overflow-auto p-4 text-[12.5px]"
                    style={{ fontFamily: 'var(--font-mono)', color: 'var(--sonoma-ink-2)' }}
                >
                    {code}
                </pre>
            ) : (
                <div
                    className="flex justify-center overflow-auto p-4 [&_svg]:max-w-full [&_svg]:h-auto"
                    dangerouslySetInnerHTML={{ __html: svg }}
                />
            )}
        </div>
    );
}
