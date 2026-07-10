'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { Globe, RefreshCw, ArrowLeft } from 'lucide-react';

const STORAGE_KEY = 'tripplet_cloud_envs';

interface CloudFile {
    name: string;
    content: string;
    size: number;
    type: string;
    uploadedAt: string;
}

interface CloudEnvironment {
    id: string;
    name: string;
    slug: string;
    files: CloudFile[];
    status: string;
    [key: string]: unknown;
}

function readEnvs(): CloudEnvironment[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

/**
 * Inlines CSS/JS files, resolves binary data URIs, and injects CDN scripts
 * for TypeScript, React, Tailwind, and JSX transpilation.
 */
function resolveAssets(html: string, files: CloudFile[]): string {
    let resolved = html;
    let needsBabel = false;
    let needsReact = false;
    let needsTailwind = false;

    const findFile = (ref: string) =>
        files.find(f => f.name === ref || f.name === ref.replace(/^\.\//, ''));

    // Detect Tailwind usage in HTML classes or CSS @tailwind directives
    if (/<[^>]+class=["'][^"']*(?:flex |grid |p-|m-|text-|bg-|rounded|border-|shadow|w-|h-|gap-|items-|justify-)/i.test(html)) {
        needsTailwind = true;
    }
    files.forEach(f => {
        if (f.name.endsWith('.css') && f.content.includes('@tailwind')) needsTailwind = true;
    });

    // Inline CSS: <link rel="stylesheet" href="...">
    resolved = resolved.replace(
        /<link\b[^>]*?href=["']([^"']+?)["'][^>]*?>/gi,
        (match, href) => {
            if (!match.toLowerCase().includes('stylesheet')) return match;
            const file = findFile(href);
            if (!file) return match;
            if (file.content.includes('@tailwind')) { needsTailwind = true; return ''; }
            return `<style>\n${file.content}\n</style>`;
        }
    );

    // Inline scripts: <script src="..."></script>
    resolved = resolved.replace(
        /<script\b[^>]*?src=["']([^"']+?)["'][^>]*?><\/script>/gi,
        (match, src) => {
            if (src.startsWith('http') || src.startsWith('//')) return match;
            const file = findFile(src);
            if (!file) return match;

            const ext = src.split('.').pop()?.toLowerCase();
            const isTS = ext === 'ts' || ext === 'tsx';
            const isJSX = ext === 'jsx' || ext === 'tsx';

            if (isTS || isJSX) {
                needsBabel = true;
                if (isJSX || file.content.includes('React') || file.content.includes('createRoot') || file.content.includes('jsx')) needsReact = true;
                const presets = [isTS ? 'typescript' : null, isJSX ? 'react' : null].filter(Boolean).join(',');
                return `<script type="text/babel" data-presets="${presets}">\n${file.content}\n</script>`;
            }

            return `<script>\n${file.content}\n</script>`;
        }
    );

    // Resolve data URI references for binary files (images, fonts, etc.)
    files.forEach(file => {
        if (file.content.startsWith('data:')) {
            const escaped = file.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            resolved = resolved.replace(
                new RegExp(`(["'(])(\\.?\\/?)${escaped}(["')])`, 'g'),
                `$1${file.content}$3`
            );
        }
    });

    // Inject CDN scripts for Tailwind, React, Babel
    const injections: string[] = [];
    if (needsTailwind) injections.push('<script src="https://cdn.tailwindcss.com"></script>');
    if (needsReact) {
        injections.push('<script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>');
        injections.push('<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>');
    }
    if (needsBabel) injections.push('<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>');

    if (injections.length > 0) {
        const injection = injections.join('\n');
        if (resolved.includes('</head>')) {
            resolved = resolved.replace('</head>', `${injection}\n</head>`);
        } else if (resolved.includes('<body')) {
            resolved = resolved.replace(/<body[^>]*>/, `$&\n${injection}`);
        } else {
            resolved = `${injection}\n${resolved}`;
        }
    }

    return resolved;
}

export default function CloudEnvPreview() {
    const params = useParams();
    const rawSlug = params?.slug;
    const slug = Array.isArray(rawSlug) ? rawSlug[0] : (rawSlug as string | undefined) ?? '';

    const [env, setEnv] = useState<CloudEnvironment | null | undefined>(undefined);

    useEffect(() => {
        if (!slug) return;
        const found = readEnvs().find(e => e.slug === slug);
        setEnv(found ?? null);

        const handler = () => {
            const updated = readEnvs().find(e => e.slug === slug);
            setEnv(updated ?? null);
        };
        window.addEventListener('cloud_envs_updated', handler);
        return () => window.removeEventListener('cloud_envs_updated', handler);
    }, [slug]);

    const indexFile = env?.files.find(f => f.name === 'index.html');
    const resolvedHtml = useMemo(
        () => indexFile && env ? resolveAssets(indexFile.content, env.files) : null,
        [indexFile, env]
    );

    // Loading
    if (env === undefined) {
        return (
            <div className="flex items-center justify-center h-screen bg-[#0a0a0a] text-[#555] font-sans">
                <RefreshCw size={16} className="animate-spin mr-2" />
                Loading...
            </div>
        );
    }

    // Not found
    if (!env) {
        return (
            <div className="flex flex-col items-center justify-center h-screen gap-4 bg-[#0a0a0a] text-[#888] font-sans">
                <p className="text-[15px]">Environment not found</p>
                <p className="text-xs text-[#555] font-mono">/{slug}</p>
                <a href="/code" className="text-[13px] text-[#aaa] underline">Back to Code</a>
            </div>
        );
    }

    // No index.html
    if (!resolvedHtml) {
        return (
            <div className="flex flex-col items-center justify-center h-screen gap-4 bg-[#0a0a0a] text-[#888] font-sans">
                <Globe size={32} className="text-[#444]" />
                <p className="text-[15px]">No index.html found</p>
                <p className="text-xs text-[#555]">Upload an index.html file to host your site</p>
                <a href={`/c/${slug}`} className="text-[13px] text-[#aaa] underline">Go to dashboard</a>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen bg-black">
            {/* Admin bar */}
            <div className="flex items-center gap-3 px-4 py-2 bg-[#111] border-b border-[#222] text-xs text-[#888] shrink-0 font-sans">
                <a href={`/c/${slug}`} className="flex items-center gap-1.5 text-[#aaa] hover:text-white transition-colors no-underline">
                    <ArrowLeft size={12} />
                    Dashboard
                </a>
                <span className="text-[#333]">|</span>
                <span className="text-[#555]">{env.name}</span>
                <span className="ml-auto text-[10px] text-[#444]">Hosted on Tripplet Cloud</span>
            </div>

            {/* Site iframe */}
            <iframe
                srcDoc={resolvedHtml}
                title={env.name}
                sandbox="allow-scripts allow-forms allow-popups allow-modals"
                className="flex-1 w-full border-none"
            />
        </div>
    );
}
