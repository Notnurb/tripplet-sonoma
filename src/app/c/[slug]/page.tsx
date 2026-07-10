'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    AlertCircle, ArrowLeft, Cloud, ExternalLink, FolderOpen, Globe,
    Layers, LayoutDashboard, RefreshCw, ScrollText, Server, Settings, Terminal,
} from 'lucide-react';
import Link from 'next/link';
import { useCloudEnvironments, CloudEnvironment } from '@/hooks/useCloudEnvironments';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
    StatusPill, OverviewTab, FilesTab, LogsTab, ConsoleTab, TemplatesTab, SettingsTab,
} from './_components/CloudTabs';

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'files' | 'logs' | 'console' | 'templates' | 'settings';

const TABS: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'overview',   label: 'Overview',   icon: LayoutDashboard },
    { id: 'files',      label: 'Files',      icon: FolderOpen },
    { id: 'logs',       label: 'Logs',       icon: ScrollText },
    { id: 'console',    label: 'Console',    icon: Terminal },
    { id: 'templates',  label: 'Templates',  icon: Layers },
    { id: 'settings',   label: 'Settings',   icon: Settings },
];

const STORAGE_KEY = 'tripplet_cloud_envs';

function readEnvs(): CloudEnvironment[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

export default function CloudEnvPage() {
    const params = useParams();
    // useParams can return string | string[] — normalise to string
    const rawSlug = params?.slug;
    const slug = Array.isArray(rawSlug) ? rawSlug[0] : (rawSlug as string | undefined) ?? '';

    // Mutations still come from the hook
    const { addFile, removeFile, update, remove, usedBytes } = useCloudEnvironments();

    // Read env directly from localStorage — avoids any hook batching/timing issues
    const [env, setEnv] = useState<CloudEnvironment | null | undefined>(undefined);
    const [tab, setTab] = useState<Tab>('overview');
    const seededRef = useRef(false);

    useEffect(() => {
        if (!slug) return;
        function lookup() {
            const found = readEnvs().find(e => e.slug === slug);
            setEnv(found ?? null);
        }
        lookup();
        window.addEventListener('cloud_envs_updated', lookup);
        return () => window.removeEventListener('cloud_envs_updated', lookup);
    }, [slug]);

    // Seed welcome.md once when first visiting an empty env
    useEffect(() => {
        if (!env || seededRef.current || env.files.length > 0) return;
        seededRef.current = true;
        const welcome = `# Welcome to ${env.name}\n\nThis is your persistent cloud workspace. Files you upload or create here will always be available.\n\nTry asking Tripplet to:\n- "Create a Python script that..."\n- "Build a simple website about..."\n- "Generate a REST API for..."\n\nDelete this file whenever you are ready. Have fun building.\n`;
        addFile(env.id, { name: 'welcome.md', content: welcome, size: welcome.length, type: 'text/markdown', uploadedAt: new Date().toISOString() });
    }, [env, addFile]);

    // Auto-detect website files and notify the user
    const prevHadIndexRef = useRef(false);
    useEffect(() => {
        if (!env) return;
        const hasIndex = env.files.some(f => f.name === 'index.html');
        if (hasIndex && !prevHadIndexRef.current) {
            toast.success('Website detected! Your site is ready to preview.', {
                action: {
                    label: 'View Site',
                    onClick: () => window.open(`/c/${env.slug}/preview`, '_blank'),
                },
            });
        }
        prevHadIndexRef.current = hasIndex;
    }, [env]);

    // undefined = localStorage not read yet
    if (env === undefined) {
        return (
            <div className="flex items-center justify-center h-screen bg-background">
                <div className="flex items-center gap-2 text-muted-foreground text-sm"><RefreshCw size={14} className="animate-spin" /> Loading...</div>
            </div>
        );
    }

    // null = loaded, slug not matched
    if (env === null) {
        return (
            <div className="flex flex-col items-center justify-center h-screen gap-4 bg-background">
                <AlertCircle size={32} className="text-muted-foreground/40" />
                <p className="text-muted-foreground text-sm">Cloud environment not found.</p>
                <p className="text-[10px] text-muted-foreground/40 font-mono">slug: {slug || '(empty)'}</p>
                <Link href="/code" className="text-xs text-foreground/60 hover:text-foreground transition-colors underline underline-offset-2">← Back to Code</Link>
            </div>
        );
    }

    const used = usedBytes(env);
    const publicUrl = typeof window !== 'undefined' ? `${window.location.origin}/c/${env.slug}` : `/c/${env.slug}`;

    return (
        <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
            {/* Header */}
            <header className="shrink-0 border-b border-border bg-card/50 backdrop-blur-sm z-10">
                <div className="flex items-center gap-3 px-5 py-3 max-w-6xl mx-auto">
                    <Link href="/code" className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0">
                        <ArrowLeft size={15} />
                    </Link>
                    <div className="flex items-center gap-2.5 min-w-0">
                        {env.photoUrl
                            ? <img src={env.photoUrl} alt={env.name} className="h-8 w-8 rounded-lg object-cover shrink-0" />
                            : <div className="h-8 w-8 rounded-lg bg-foreground/8 flex items-center justify-center shrink-0 border border-border/60"><Cloud size={15} className="text-foreground/60" /></div>
                        }
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h1 className="text-sm font-semibold leading-none">{env.name}</h1>
                                <StatusPill status={env.status} />
                            </div>
                            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">/c/{env.slug}</p>
                        </div>
                    </div>
                    <div className="hidden sm:block w-px h-5 bg-border/60 mx-1" />
                    <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/30 px-2.5 py-1.5 text-[11px] font-mono text-muted-foreground max-w-[260px] min-w-0">
                        <Server size={10} className="shrink-0 text-muted-foreground/50" />
                        <span className="truncate">{publicUrl}</span>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                        {env.files.some(f => f.name === 'index.html') && (
                            <Link href={`/c/${env.slug}/preview`} target="_blank"
                                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/25 transition-colors">
                                <Globe size={12} /> View Site
                            </Link>
                        )}
                        <a href={publicUrl} target="_blank" rel="noreferrer"
                            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/60 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                            <ExternalLink size={12} /> Open
                        </a>
                    </div>
                </div>

                {/* Tab bar */}
                <div className="flex items-center gap-0 px-5 max-w-6xl mx-auto border-t border-border/40">
                    {TABS.map(({ id, label, icon: Icon }) => (
                        <button key={id} onClick={() => setTab(id)}
                            className={cn(
                                'relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px',
                                tab === id ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground/60 hover:text-muted-foreground',
                            )}>
                            <Icon size={13} />{label}
                        </button>
                    ))}
                </div>
            </header>

            {/* Content */}
            <main className="flex-1 overflow-y-auto">
                <div className="max-w-6xl mx-auto px-5 py-6 relative">
                    <AnimatePresence mode="wait">
                        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
                            {tab === 'overview'  && <OverviewTab env={env} used={used} publicUrl={publicUrl} onAddFile={f => addFile(env.id, f)} />}
                            {tab === 'files'     && <FilesTab env={env} onAddFile={f => addFile(env.id, f)} onRemoveFile={name => { removeFile(env.id, name); toast.success(`${name} deleted`); }} />}
                            {tab === 'logs'      && <LogsTab env={env} />}
                            {tab === 'console'   && <ConsoleTab env={env} onAddFile={f => addFile(env.id, f)} onRemoveFile={name => { removeFile(env.id, name); toast.success(`${name} deleted`); }} onSyncFiles={files => update(env.id, { files })} />}
                            {tab === 'templates' && <TemplatesTab env={env} onAddFile={f => addFile(env.id, f)} />}
                            {tab === 'settings'  && <SettingsTab env={env} onUpdate={patch => update(env.id, patch)} onDelete={() => { remove(env.id); window.location.href = '/code'; }} />}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </main>
        </div>
    );
}
