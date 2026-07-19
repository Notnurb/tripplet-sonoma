'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Camera, Check, Copy, ExternalLink, Globe, HardDrive, Package,
    Play, Power, PowerOff, ScrollText, Square, Trash2, UserPlus, X,
} from 'lucide-react';
import Link from 'next/link';
import { CloudEnvironment, CloudFile, CloudEnvVisibility } from '@/hooks/useCloudEnvironments';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
    formatBytes, formatTime, fileIcon, resolveAssets,
    generateProjectHtml, makeLog,
    BOOT_LOGS, FAKE_HTTP_MSGS, CAMERA_HTML,
    type LogLine, type LogLevel,
} from '../_lib/cloud-core';

// ─── Sub-components ───────────────────────────────────────────────────────────

export function StatusPill({ status }: { status: 'active' | 'broken' | 'stopped' }) {
    return (
        <span className={cn(
            'inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border',
            status === 'active'  && 'bg-emerald-400/10 border-emerald-400/25 text-emerald-400',
            status === 'broken'  && 'bg-red-400/10 border-red-400/25 text-red-400',
            status === 'stopped' && 'bg-muted border-border text-muted-foreground',
        )}>
            <span className={cn(
                'h-1.5 w-1.5 rounded-full',
                status === 'active'  && 'bg-emerald-400 animate-pulse',
                status === 'broken'  && 'bg-red-400',
                status === 'stopped' && 'bg-muted-foreground/50',
            )} />
            {status}
        </span>
    );
}

export function StorageBar({ used, limitMb }: { used: number; limitMb: number }) {
    const pct = Math.min((used / (limitMb * 1024 * 1024)) * 100, 100);
    return (
        <div className="space-y-1.5">
            <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{formatBytes(used)} used</span>
                <span>{limitMb} MB limit</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className={cn('h-full rounded-full', pct > 80 ? 'bg-amber-400' : 'bg-emerald-400')}
                />
            </div>
        </div>
    );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

export function OverviewTab({ env, used, publicUrl, onAddFile }: { env: CloudEnvironment; used: number; publicUrl: string; onAddFile: (f: CloudFile) => void }) {
    const [copied, setCopied] = useState(false);
    const [uptime, setUptime] = useState(0);

    useEffect(() => {
        if (env.status !== 'active') return;
        const start = Date.now() - 1000 * 60 * 3;
        const id = setInterval(() => setUptime(Math.floor((Date.now() - start) / 1000)), 1000);
        return () => clearInterval(id);
    }, [env.status]);

    const fmt = (s: number) => {
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        return h > 0 ? `${h}h ${m}m ${sec}s` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
    };

    const copy = () => {
        navigator.clipboard.writeText(publicUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const indexFile = env.files.find(f => f.name === 'index.html');
    const previewUrl = `/c/${env.slug}/preview`;

    return (
        <div className="space-y-4">
            {indexFile && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Globe size={14} className="text-emerald-400" />
                            <p className="text-sm font-semibold text-emerald-400">Your site is live!</p>
                        </div>
                        <Link href={previewUrl} target="_blank"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/25 transition-colors">
                            <ExternalLink size={12} /> Open Site
                        </Link>
                    </div>
                    <Link href={previewUrl} target="_blank" className="block rounded-lg border border-border overflow-hidden bg-black hover:border-foreground/20 transition-colors">
                        <iframe
                            srcDoc={resolveAssets(indexFile.content, env.files)}
                            title="Site preview"
                            sandbox="allow-scripts"
                            className="w-full pointer-events-none"
                            style={{ height: 300 }}
                        />
                    </Link>
                    <p className="text-[10px] text-muted-foreground">
                        Preview of your hosted site. <Link href={previewUrl} target="_blank" className="underline underline-offset-2 text-foreground/60 hover:text-foreground transition-colors">Open full page</Link>
                    </p>
                </div>
            )}

            {/* Node.js project detection */}
            {!indexFile && env.files.some(f => f.name === 'package.json') && (() => {
                const pkgFile = env.files.find(f => f.name === 'package.json');
                let pkg: Record<string, unknown> = {};
                try { pkg = JSON.parse(pkgFile!.content); } catch { /* ignore */ }
                const deps = { ...((pkg.dependencies ?? {}) as Record<string, string>), ...((pkg.devDependencies ?? {}) as Record<string, string>) };
                const techStack = [
                    deps['react'] && 'React',
                    deps['typescript'] && 'TypeScript',
                    deps['tailwindcss'] && 'Tailwind CSS',
                    deps['purescript'] && 'PureScript',
                    deps['next'] && 'Next.js',
                    deps['vue'] && 'Vue',
                    deps['svelte'] && 'Svelte',
                ].filter(Boolean);
                return (
                    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 space-y-3">
                        <div className="flex items-center gap-2">
                            <Package size={14} className="text-blue-400" />
                            <p className="text-sm font-semibold text-blue-400">Node.js project detected</p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            <span className="font-semibold text-foreground/80">{(pkg.name as string) || 'Unnamed'}</span>
                            {typeof pkg.version === 'string' && <span className="ml-1 text-muted-foreground/60">v{pkg.version}</span>}
                            {techStack.length > 0 && <span className="ml-2 text-muted-foreground/80">— {techStack.join(', ')}</span>}
                        </p>
                        <p className="text-[11px] text-muted-foreground">No <code className="text-foreground/60">index.html</code> found. Generate one to preview your project in the browser.</p>
                        <button
                            onClick={() => {
                                const html = generateProjectHtml(pkg, env.files);
                                onAddFile({ name: 'index.html', content: html, size: new Blob([html]).size, type: 'text/html', uploadedAt: new Date().toISOString() });
                                toast.success('Generated index.html from package.json!');
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/15 text-blue-400 text-xs font-semibold hover:bg-blue-500/25 transition-colors"
                        >
                            <Play size={12} /> Generate index.html
                        </button>
                    </div>
                );
            })()}

            <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Globe size={10} /> Live URL
                </p>
                <div className="flex items-center gap-2 rounded-lg bg-muted/50 border border-border/50 px-3 py-2">
                    <code className="flex-1 text-xs font-mono text-foreground/80 truncate">{publicUrl}</code>
                    <button onClick={copy} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                        {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                    </button>
                    <a href={publicUrl} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                        <ExternalLink size={13} />
                    </a>
                </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: 'Status', value: <StatusPill status={env.status} /> },
                    { label: 'Uptime', value: <span className="text-sm font-mono font-semibold">{env.status === 'active' ? fmt(uptime) : '—'}</span> },
                    { label: 'Storage', value: <span className="text-sm font-semibold">{formatBytes(used)}</span> },
                    { label: 'Files', value: <span className="text-sm font-semibold">{env.files.length}</span> },
                ].map(({ label, value }) => (
                    <div key={label} className="rounded-xl border border-border bg-card p-4">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{label}</p>
                        {value}
                    </div>
                ))}
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                    <HardDrive size={10} /> Storage
                </p>
                <StorageBar used={used} limitMb={env.storageLimitMb} />
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Environment Info</p>
                <dl className="space-y-2">
                    {[
                        ['Created', new Date(env.createdAt).toLocaleDateString()],
                        ['License', env.license.toUpperCase()],
                        ['Storage Tier', `${env.storageLimitMb} MB`],
                        ['Slug', `/${env.slug}`],
                        ['README', env.hasReadme ? 'Included' : 'None'],
                    ].map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between text-xs">
                            <dt className="text-muted-foreground">{k}</dt>
                            <dd className="font-mono text-foreground/80">{v}</dd>
                        </div>
                    ))}
                </dl>
            </div>
        </div>
    );
}

// ─── Files Tab ────────────────────────────────────────────────────────────────

export function LogsTab({ env }: { env: CloudEnvironment }) {
    const [logs, setLogs] = useState<LogLine[]>(() => BOOT_LOGS(env.name));
    const [running, setRunning] = useState(env.status === 'active');
    const [filter, setFilter] = useState<LogLevel | 'all'>('all');
    const bottomRef = useRef<HTMLDivElement>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => { setRunning(env.status === 'active'); }, [env.status]);

    const addLog = useCallback(() => {
        const template = FAKE_HTTP_MSGS[Math.floor(Math.random() * FAKE_HTTP_MSGS.length)];
        const msg = template(env.slug);
        const level: LogLevel = msg.includes('5') ? 'error' : msg.includes('warn') ? 'warn'
            : msg.includes('200') || msg.includes('passed') || msg.includes('online') ? 'success' : 'info';
        setLogs(prev => [...prev.slice(-299), makeLog(level, msg)]);
    }, [env.slug]);

    useEffect(() => {
        if (running) { intervalRef.current = setInterval(addLog, 2400 + Math.random() * 2000); }
        else { if (intervalRef.current) clearInterval(intervalRef.current); }
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [running, addLog]);

    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

    const filtered = filter === 'all' ? logs : logs.filter(l => l.level === filter);
    const LEVEL_COLORS: Record<LogLevel, string> = { info: 'text-foreground/60', warn: 'text-amber-400', error: 'text-red-400', success: 'text-emerald-400' };
    const LEVEL_BADGE: Record<LogLevel, string> = { info: 'bg-foreground/8 text-foreground/50', warn: 'bg-amber-400/10 text-amber-400', error: 'bg-red-400/10 text-red-400', success: 'bg-emerald-400/10 text-emerald-400' };

    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col" style={{ height: 520 }}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60 bg-muted/20 shrink-0">
                <ScrollText size={13} className="text-muted-foreground" />
                <span className="text-xs font-medium">Server logs</span>
                <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                    {(['all', 'success', 'info', 'warn', 'error'] as const).map(l => (
                        <button key={l} onClick={() => setFilter(l)} className={cn('px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide transition-colors', filter === l ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground/50 hover:text-muted-foreground')}>{l}</button>
                    ))}
                    <div className="w-px h-3 bg-border/60 mx-1" />
                    <button onClick={() => setRunning(r => !r)} className={cn('flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors', running ? 'bg-red-400/10 text-red-400 hover:bg-red-400/20' : 'bg-emerald-400/10 text-emerald-400 hover:bg-emerald-400/20')}>
                        {running ? <><Square size={10} fill="currentColor" /> Pause</> : <><Play size={10} fill="currentColor" /> Resume</>}
                    </button>
                    <button onClick={() => setLogs([])} className="px-2.5 py-1 rounded-lg text-[11px] text-muted-foreground hover:bg-muted transition-colors">Clear</button>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed p-3 space-y-0.5 bg-[#0d0d0d] dark:bg-[#0a0a0a]">
                <AnimatePresence initial={false}>
                    {filtered.map(log => (
                        <motion.div key={log.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.15 }}
                            className="flex items-start gap-3">
                            <span className="text-foreground/25 shrink-0 tabular-nums">{formatTime(log.ts)}</span>
                            <span className={cn('shrink-0 px-1.5 py-0 rounded text-[9px] font-bold uppercase', LEVEL_BADGE[log.level])}>{log.level}</span>
                            <span className={LEVEL_COLORS[log.level]}>{log.msg}</span>
                        </motion.div>
                    ))}
                </AnimatePresence>
                <div ref={bottomRef} />
            </div>
        </div>
    );
}

// ─── Console Tab ──────────────────────────────────────────────────────────────

export interface Template {
    id: string;
    name: string;
    desc: string;
    category: string;
    icon: string;
    files: { name: string; content: string }[];
}

export const TEMPLATES: Template[] = [
    {
        id: 'camera-system',
        name: 'Camera System',
        desc: 'Live webcam feed with toggle, mirror flip, and photo capture. Runs in any modern browser.',
        category: 'Media',
        icon: '📹',
        files: [{ name: 'index.html', content: CAMERA_HTML }],
    },
    {
        id: 'static-site',
        name: 'Static Landing Page',
        desc: 'Clean one-page site with a hero section, features grid, and CTA button.',
        category: 'Web',
        icon: '🌐',
        files: [{
            name: 'index.html',
            content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\n  <title>My Site</title>\n  <style>\n    * { margin: 0; padding: 0; box-sizing: border-box; }\n    body { font-family: system-ui; background: #fff; color: #111; }\n    .hero { padding: 80px 24px; text-align: center; }\n    h1 { font-size: clamp(2rem, 5vw, 4rem); font-weight: 800; }\n    p { color: #666; margin-top: 16px; font-size: 1.1rem; }\n    .btn { display: inline-block; margin-top: 32px; padding: 14px 32px; background: #111; color: #fff; border-radius: 999px; text-decoration: none; font-weight: 600; }\n    .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 24px; padding: 48px 24px; }\n    .card { border: 1px solid #eee; border-radius: 12px; padding: 24px; }\n    .card h3 { margin-bottom: 8px; }\n  </style>\n</head>\n<body>\n  <div class="hero">\n    <h1>Hello World</h1>\n    <p>Built with Tripplet Cloud</p>\n    <a class="btn" href="#">Get Started</a>\n  </div>\n  <div class="features">\n    <div class="card"><h3>⚡ Fast</h3><p>Deployed instantly on Tripplet Cloud infrastructure.</p></div>\n    <div class="card"><h3>🔒 Secure</h3><p>SSL by default, access controls built in.</p></div>\n    <div class="card"><h3>🌍 Global</h3><p>Served from edge locations worldwide.</p></div>\n  </div>\n</body>\n</html>`,
        }],
    },
    {
        id: 'api-mock',
        name: 'JSON API Mock',
        desc: 'A static JSON file that acts as a mock REST API endpoint. Good for testing frontends.',
        category: 'API',
        icon: '📋',
        files: [{
            name: 'api.json',
            content: JSON.stringify({
                status: 'ok',
                version: '1.0.0',
                data: [
                    { id: 1, name: 'Alice', email: 'alice@example.com' },
                    { id: 2, name: 'Bob', email: 'bob@example.com' },
                ],
                meta: { total: 2, page: 1 },
            }, null, 2),
        }],
    },
    {
        id: 'readme',
        name: 'Project README',
        desc: 'A markdown README template. Documents your project structure, setup, and usage.',
        category: 'Docs',
        icon: '📝',
        files: [{
            name: 'README.md',
            content: `# Project Name\n\n> Short description of what this project does.\n\n## Getting Started\n\n\`\`\`bash\nnpm install\nnpm start\n\`\`\`\n\n## Features\n\n- Feature one\n- Feature two\n- Feature three\n\n## License\n\nMIT\n`,
        }],
    },
];

export function CameraPreview({ onClose }: { onClose: () => void }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState('');
    const [mirrored, setMirrored] = useState(false);

    const start = useCallback(async () => {
        try {
            const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            setStream(s);
            if (videoRef.current) videoRef.current.srcObject = s;
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Camera access denied');
        }
    }, []);

    const stop = useCallback(() => {
        stream?.getTracks().forEach(t => t.stop());
        setStream(null);
        if (videoRef.current) videoRef.current.srcObject = null;
    }, [stream]);

    useEffect(() => { start(); return () => { stream?.getTracks().forEach(t => t.stop()); }; }, []);

    const takePhoto = useCallback(() => {
        if (!videoRef.current || !stream) return;
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0);
        const a = document.createElement('a');
        a.download = `photo-${Date.now()}.png`;
        a.href = canvas.toDataURL();
        a.click();
        toast.success('Photo saved!');
    }, [stream]);

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/90 backdrop-blur-md flex items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && onClose()}>
            <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
                className="rounded-2xl border border-border bg-[#0a0a0a] overflow-hidden w-full max-w-2xl shadow-2xl">
                {/* Traffic lights */}
                <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/5">
                    <button onClick={onClose} className="h-3 w-3 rounded-full bg-red-400/80 hover:bg-red-400 transition-colors" />
                    <span className="h-3 w-3 rounded-full bg-amber-400/40" />
                    <span className="h-3 w-3 rounded-full bg-emerald-400/40" />
                    <span className="ml-4 text-[10px] text-white/30 font-mono">Camera System — Live Preview</span>
                </div>

                {/* Video */}
                <div className="relative bg-black aspect-video">
                    <video ref={videoRef} autoPlay playsInline muted
                        className={cn('w-full h-full object-cover', mirrored && 'scale-x-[-1]')} />
                    {!stream && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/30">
                            <Camera size={32} />
                            {error ? <p className="text-red-400 text-sm">{error}</p> : <p className="text-sm">Starting camera…</p>}
                        </div>
                    )}
                    {stream && (
                        <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm rounded-full px-2.5 py-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
                            <span className="text-[10px] text-white/70 font-mono">LIVE</span>
                        </div>
                    )}
                </div>

                {/* Controls */}
                <div className="flex items-center gap-2 px-4 py-3 border-t border-white/5 flex-wrap">
                    <button onClick={stream ? stop : start}
                        className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                            stream ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25' : 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25')}>
                        {stream ? <><Square size={11} fill="currentColor" /> Stop</> : <><Play size={11} fill="currentColor" /> Start</>}
                    </button>
                    <button onClick={takePhoto} disabled={!stream}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/80 disabled:opacity-30 transition-colors">
                        📸 Take Photo
                    </button>
                    <button onClick={() => setMirrored(m => !m)}
                        className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                            mirrored ? 'bg-blue-500/15 text-blue-400' : 'bg-white/5 text-white/60 hover:bg-white/10')}>
                        ↔ Mirror
                    </button>
                    <button onClick={onClose} className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-white/40 hover:text-white/60 transition-colors">
                        <X size={12} /> Close
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
}

export function TemplatesTab({ env, onAddFile }: {
    env: CloudEnvironment;
    onAddFile: (f: CloudFile) => void;
}) {
    const [preview, setPreview] = useState<string | null>(null);
    const [used, setUsed] = useState<Set<string>>(new Set());

    const applyTemplate = (t: Template) => {
        t.files.forEach(f => onAddFile({
            name: f.name, content: f.content,
            size: f.content.length, type: 'text/plain',
            uploadedAt: new Date().toISOString(),
        }));
        setUsed(prev => new Set([...prev, t.id]));
        toast.success(`${t.name} files added — go to Files tab to view`);
    };

    const categories = [...new Set(TEMPLATES.map(t => t.category))];

    return (
        <>
            <AnimatePresence>
                {preview === 'camera-system' && <CameraPreview onClose={() => setPreview(null)} />}
            </AnimatePresence>

            <div className="space-y-6">
                <div>
                    <h2 className="text-sm font-semibold">Templates</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Ready-made starting points. Add them to your environment&apos;s files instantly.</p>
                </div>

                {categories.map(cat => (
                    <div key={cat}>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{cat}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {TEMPLATES.filter(t => t.category === cat).map(t => {
                                const isUsed = used.has(t.id);
                                const alreadyHasFile = t.files.some(f => env.files.some(ef => ef.name === f.name));
                                return (
                                    <div key={t.id} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
                                        <div className="flex items-start gap-3">
                                            <span className="text-2xl mt-0.5 shrink-0">{t.icon}</span>
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold">{t.name}</p>
                                                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t.desc}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {t.id === 'camera-system' && (
                                                <button onClick={() => setPreview(t.id)}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                                                    <Camera size={11} /> Live Preview
                                                </button>
                                            )}
                                            <button
                                                onClick={() => applyTemplate(t)}
                                                disabled={isUsed || alreadyHasFile}
                                                className={cn(
                                                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                                                    isUsed || alreadyHasFile
                                                        ? 'bg-muted text-muted-foreground cursor-not-allowed'
                                                        : 'bg-foreground text-background hover:bg-foreground/90',
                                                )}>
                                                {isUsed || alreadyHasFile ? <><Check size={11} /> Added</> : <>Use Template</>}
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-1 flex-wrap">
                                            {t.files.map(f => (
                                                <span key={f.name} className="text-[10px] font-mono bg-muted/50 border border-border/50 px-1.5 py-0.5 rounded text-muted-foreground">
                                                    {fileIcon(f.name)} {f.name}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </>
    );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

export function SettingsTab({ env, onUpdate, onDelete }: {
    env: CloudEnvironment;
    onUpdate: (patch: Partial<CloudEnvironment>) => void;
    onDelete: () => void;
}) {
    const vis: CloudEnvVisibility = env.visibility ?? { showFiles: true, showLogs: true, showConsole: true };
    const emails: string[] = env.authorizedEmails ?? [];
    const [emailInput, setEmailInput] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);

    const toggleVis = (key: keyof CloudEnvVisibility) =>
        onUpdate({ visibility: { ...vis, [key]: !vis[key] } });

    const addEmail = () => {
        const email = emailInput.trim().toLowerCase();
        if (!email || emails.includes(email)) return;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error('Enter a valid email'); return; }
        onUpdate({ authorizedEmails: [...emails, email] });
        setEmailInput('');
        toast.success(`${email} authorized`);
    };

    const toggleServer = () => {
        const next = env.status === 'active' ? 'stopped' : 'active';
        onUpdate({ status: next });
        toast.success(next === 'active' ? 'Server started' : 'Server stopped');
    };

    return (
        <div className="space-y-4 max-w-lg">
            {/* Server power */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <p className="text-xs font-semibold">Server</p>
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-xs font-medium">Server power</p>
                        <p className="text-[11px] text-muted-foreground">
                            {env.status === 'active' ? 'Server is running and accepting connections.' : env.status === 'stopped' ? 'Server is stopped. Visitors will see an offline page.' : 'Server is in a broken state.'}
                        </p>
                    </div>
                    <button onClick={toggleServer}
                        className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-colors',
                            env.status === 'active'
                                ? 'bg-red-500/10 text-red-400 border border-red-500/25 hover:bg-red-500/20'
                                : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/20',
                        )}>
                        {env.status === 'active' ? <><PowerOff size={12} /> Stop server</> : <><Power size={12} /> Start server</>}
                    </button>
                </div>
            </div>

            {/* Visibility */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <p className="text-xs font-semibold">Visibility</p>
                <p className="text-[11px] text-muted-foreground">Control which sections are visible to visitors.</p>
                {([
                    ['showFiles', 'File Manager', 'Let visitors browse and view files'],
                    ['showLogs', 'Server Logs', 'Show live server log output'],
                    ['showConsole', 'Console', 'Expose the interactive shell console'],
                ] as [keyof CloudEnvVisibility, string, string][]).map(([key, label, desc]) => (
                    <div key={key} className="flex items-center justify-between gap-4">
                        <div>
                            <p className="text-xs font-medium">{label}</p>
                            <p className="text-[10px] text-muted-foreground">{desc}</p>
                        </div>
                        <button onClick={() => toggleVis(key)}
                            className={cn('relative h-5 w-9 rounded-full transition-colors duration-200 shrink-0', vis[key] ? 'bg-emerald-500' : 'bg-muted')}>
                            <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200', vis[key] ? 'translate-x-4' : 'translate-x-0.5')} />
                        </button>
                    </div>
                ))}
            </div>

            {/* Authorized users */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <p className="text-xs font-semibold">Authorized Users</p>
                <p className="text-[11px] text-muted-foreground">Emails allowed to access this environment.</p>
                <div className="flex gap-2">
                    <input value={emailInput} onChange={e => setEmailInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addEmail()}
                        placeholder="user@example.com"
                        className="flex-1 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs outline-none focus:border-foreground/40 transition-colors" />
                    <button onClick={addEmail} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-foreground text-background text-xs font-semibold hover:bg-foreground/90 transition-colors">
                        <UserPlus size={12} /> Add
                    </button>
                </div>
                {emails.length > 0
                    ? <div className="space-y-1.5">{emails.map(e => (
                        <div key={e} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                            <span className="text-xs font-mono text-foreground/80">{e}</span>
                            <button onClick={() => onUpdate({ authorizedEmails: emails.filter(x => x !== e) })} className="text-muted-foreground hover:text-red-400 transition-colors"><X size={13} /></button>
                        </div>
                    ))}</div>
                    : <p className="text-[10px] text-muted-foreground/50">No authorized users — environment is private.</p>}
            </div>

            {/* Danger zone */}
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-3">
                <p className="text-xs font-semibold text-red-400">Danger Zone</p>
                {confirmDelete ? (
                    <div className="space-y-2">
                        <p className="text-[11px] text-muted-foreground">Permanently delete <strong>{env.name}</strong> and all its files. Cannot be undone.</p>
                        <div className="flex gap-2">
                            <button onClick={onDelete} className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-colors">Yes, delete</button>
                            <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
                        </div>
                    </div>
                ) : (
                    <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 text-xs hover:bg-red-500/10 transition-colors">
                        <Trash2 size={12} /> Delete environment
                    </button>
                )}
            </div>
        </div>
    );
}


// Extracted into sibling files to keep this module navigable:
export { FilesTab } from './FilesTab';
export { ConsoleTab } from './ConsoleTab';
