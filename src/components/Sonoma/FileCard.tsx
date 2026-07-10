'use client';

import { useCallback, useMemo } from 'react';
import { SonomaFile } from './icons';

interface FileCardProps {
    name: string;
    content: string;
}

const MIME_BY_EXT: Record<string, string> = {
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    json: 'application/json',
    csv: 'text/csv',
    html: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    ts: 'text/typescript',
    py: 'text/x-python',
    yml: 'text/yaml',
    yaml: 'text/yaml',
    xml: 'application/xml',
};

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileCard({ name, content }: FileCardProps) {
    const ext = useMemo(() => name.split('.').pop()?.toLowerCase() || 'txt', [name]);
    const size = useMemo(
        () => formatSize(new TextEncoder().encode(content).length),
        [content],
    );

    const handleDownload = useCallback(() => {
        const mime = MIME_BY_EXT[ext] || 'text/plain';
        const blob = new Blob([content], { type: `${mime};charset=utf-8` });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, [content, name, ext]);

    return (
        <button
            type="button"
            onClick={handleDownload}
            title={`Download ${name}`}
            className="group inline-flex max-w-full items-center gap-2.5 rounded-full transition-colors"
            style={{
                background: 'var(--sonoma-surface)',
                border: '1px solid var(--sonoma-border)',
                padding: '6px 12px 6px 8px',
                boxShadow: 'var(--sonoma-shadow-sm)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sonoma-bg-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--sonoma-surface)')}
        >
            <span
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                style={{
                    background: 'color-mix(in oklch, var(--sonoma-accent) 14%, transparent)',
                    color: 'var(--sonoma-accent)',
                }}
            >
                <SonomaFile size={15} />
            </span>
            <span className="flex min-w-0 flex-col items-start leading-tight">
                <span
                    className="max-w-[200px] truncate text-[12.5px] font-medium"
                    style={{ color: 'var(--sonoma-ink)' }}
                >
                    {name}
                </span>
                <span className="text-[10.5px]" style={{ color: 'var(--sonoma-muted)' }}>
                    {ext.toUpperCase()} · {size}
                </span>
            </span>
            <span
                className="ml-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                style={{ color: 'var(--sonoma-muted)' }}
            >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
            </span>
        </button>
    );
}
