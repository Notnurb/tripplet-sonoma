'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WebBlock } from './message-context';

type PreviewState = { open: boolean; blocks: WebBlock[] };

const subscribers: ((s: PreviewState) => void)[] = [];
let current: PreviewState = { open: false, blocks: [] };

function publish(s: PreviewState) {
    current = s;
    subscribers.forEach((fn) => fn(s));
}

export function openWebPreview(blocks: WebBlock[]) {
    publish({ open: true, blocks });
}

export function closeWebPreview() {
    publish({ open: false, blocks: [] });
}

function escapeForScript(s: string): string {
    // Make a string safe to embed inside a <script>...</script> tag literal.
    return s
        .replace(/<\/script/gi, '<\\/script')
        .replace(/<!--/g, '<\\!--');
}

export function buildPreviewSrcDoc(blocks: WebBlock[]): string {
    const htmlBlocks = blocks.filter((b) => b.lang === 'html');
    const cssBlocks = blocks.filter((b) => b.lang === 'css');
    const jsBlocks = blocks.filter((b) => b.lang === 'js' || b.lang === 'jsx');
    const tsBlocks = blocks.filter((b) => b.lang === 'ts' || b.lang === 'tsx');

    // Pick a primary HTML source — first full document if present, otherwise synthesize.
    let baseHtml = '';
    if (htmlBlocks.length > 0) {
        baseHtml = htmlBlocks.map((b) => b.code).join('\n');
    }
    const isFullDoc = /<html[\s>]/i.test(baseHtml);

    const cssCombined = cssBlocks.map((b) => b.code).join('\n\n');
    const jsCombined = jsBlocks.map((b) => b.code).join('\n;\n');
    const tsCombined = tsBlocks.map((b) => b.code).join('\n;\n');

    // The bridge shim — exposes window.tripplet.{ai,image} to the iframe via postMessage.
    const bridgeShim = `
(function () {
    if (window.tripplet && window.tripplet.__installed) return;
    var pending = new Map();
    var counter = 0;
    function call(kind, payload) {
        var id = 'cb_' + (++counter) + '_' + Math.random().toString(36).slice(2, 8);
        return new Promise(function (resolve, reject) {
            pending.set(id, { resolve: resolve, reject: reject });
            window.parent.postMessage({ __tripplet: true, kind: kind, id: id, payload: payload }, '*');
        });
    }
    window.addEventListener('message', function (e) {
        var data = e.data;
        if (!data || data.__tripplet_response !== true) return;
        var p = pending.get(data.id);
        if (!p) return;
        pending.delete(data.id);
        if (data.error) p.reject(new Error(data.error));
        else p.resolve(data.result);
    });
    window.tripplet = {
        __installed: true,
        /**
         * Ask the host AI for a completion. Returns Promise<string>.
         * Subject to per-user rate limits.
         */
        ai: function (prompt, opts) {
            opts = opts || {};
            return call('ai', { prompt: String(prompt || ''), system: opts.system, maxTokens: opts.maxTokens });
        },
    };
})();
`;

    const userScripts = [];
    if (jsCombined) {
        userScripts.push(`<script>${escapeForScript(jsCombined)}<\/script>`);
    }
    if (tsCombined) {
        // Transpile TS in-browser via Sucrase from esm.sh.
        const tsLoader = `
(async function () {
    try {
        const { transform } = await import('https://esm.sh/sucrase@3.35.0?bundle');
        const src = ${JSON.stringify(tsCombined)};
        const { code } = transform(src, { transforms: ['typescript', 'jsx'], jsxRuntime: 'classic' });
        const s = document.createElement('script');
        s.textContent = code;
        document.body.appendChild(s);
    } catch (err) {
        const pre = document.createElement('pre');
        pre.style.cssText = 'color:#b22; padding:12px; font: 12px ui-monospace, monospace; white-space: pre-wrap;';
        pre.textContent = 'TypeScript transpile failed: ' + (err && err.message || err);
        document.body.appendChild(pre);
    }
})();
`;
        userScripts.push(`<script type="module">${escapeForScript(tsLoader)}<\/script>`);
    }

    if (isFullDoc) {
        // Inject CSS into <head> and scripts before </body>.
        let doc = baseHtml;
        if (cssCombined) {
            const styleTag = `<style>${escapeForScript(cssCombined)}</style>`;
            if (/<head[\s>]/i.test(doc)) {
                doc = doc.replace(/<head([^>]*)>/i, `<head$1>${styleTag}`);
            } else {
                doc = doc.replace(/<html([^>]*)>/i, `<html$1><head>${styleTag}</head>`);
            }
        }
        const bridgeTag = `<script>${bridgeShim}<\/script>`;
        const tail = bridgeTag + userScripts.join('\n');
        if (/<\/body>/i.test(doc)) {
            doc = doc.replace(/<\/body>/i, `${tail}</body>`);
        } else {
            doc = doc + tail;
        }
        return doc;
    }

    // Synthesize a minimal page when no full doc was provided.
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Preview</title>
<style>body { font-family: system-ui, -apple-system, sans-serif; padding: 16px; line-height: 1.45; }</style>
${cssCombined ? `<style>${escapeForScript(cssCombined)}</style>` : ''}
</head>
<body>
${baseHtml || ''}
<script>${bridgeShim}<\/script>
${userScripts.join('\n')}
</body>
</html>`;
}

interface BridgeMessage {
    __tripplet?: boolean;
    kind?: 'ai';
    id?: string;
    payload?: { prompt?: string; system?: string; maxTokens?: number };
}

export function HtmlPreviewHost() {
    const [state, setState] = useState<PreviewState>(current);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        subscribers.push(setState);
        return () => {
            const idx = subscribers.indexOf(setState);
            if (idx !== -1) subscribers.splice(idx, 1);
        };
    }, []);

    useEffect(() => {
        if (!state.open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeWebPreview();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [state.open]);

    useEffect(() => {
        const handler = async (e: MessageEvent) => {
            const data = e.data as BridgeMessage;
            if (!data || data.__tripplet !== true || !data.id || !data.kind) return;
            const source = e.source as Window | null;
            const reply = (body: { result?: unknown; error?: string }) => {
                if (!source) return;
                source.postMessage({ __tripplet_response: true, id: data.id, ...body }, '*');
            };

            try {
                if (data.kind === 'ai') {
                    const prompt = (data.payload?.prompt || '').toString();
                    const system = data.payload?.system?.toString();
                    const maxTokens = Number(data.payload?.maxTokens) || undefined;
                    const res = await fetch('/api/sandbox/ai', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ prompt, system, maxTokens }),
                    });
                    const json = await res.json().catch(() => ({}));
                    if (!res.ok) {
                        reply({ error: typeof json.error === 'string' ? json.error : `AI request failed (${res.status})` });
                        return;
                    }
                    reply({ result: json.content });
                    return;
                }
                reply({ error: 'Unknown bridge call' });
            } catch (err) {
                reply({ error: err instanceof Error ? err.message : 'Bridge failure' });
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    if (!mounted) return null;

    const srcDoc = state.open ? buildPreviewSrcDoc(state.blocks) : '';
    const langSummary = state.blocks.map((b) => b.lang.toUpperCase()).join(' + ') || 'PREVIEW';

    return createPortal(
        <div
            aria-hidden={!state.open}
            className={`fixed inset-0 z-[60] transition-opacity duration-200 ${
                state.open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
            }`}
        >
            <div
                className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
                onClick={closeWebPreview}
            />
            <aside
                className={`absolute right-0 top-0 bottom-0 w-full max-w-[720px] bg-card border-l border-border shadow-[-12px_0_40px_rgba(0,0,0,0.18)] transition-transform duration-250 ${
                    state.open ? 'translate-x-0' : 'translate-x-full'
                }`}
                role="dialog"
                aria-label="Web preview"
            >
                <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
                    <div className="flex items-center gap-2 text-sm">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M8 5v14l11-7z" />
                        </svg>
                        <span className="font-medium text-foreground">Preview</span>
                        <span className="text-[10px] font-mono tracking-wider text-muted-foreground">{langSummary}</span>
                    </div>
                    <button
                        type="button"
                        onClick={closeWebPreview}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        aria-label="Close preview"
                    >
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </header>
                <iframe
                    title="Web preview"
                    sandbox="allow-scripts allow-forms allow-popups allow-modals"
                    srcDoc={srcDoc}
                    className="h-[calc(100%-44px)] w-full bg-white"
                />
            </aside>
        </div>,
        document.body,
    );
}
