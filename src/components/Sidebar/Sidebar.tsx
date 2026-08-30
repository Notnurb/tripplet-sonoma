'use client';

import dynamic from 'next/dynamic';
import { useCallback, useState, useEffect, useMemo } from 'react';
import { loadSettings, SETTINGS_EVENT, SIDEBAR_WIDTHS } from '@/lib/settings';
import { APP_NAME } from '@/lib/branding';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatActions, useChatConversations } from '@/context/ChatContext';
import ConversationItem from './ConversationItem';
import UserProfile from '../Layout/UserProfile';
import ThemeToggle from '../Layout/ThemeToggle';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    Add01Icon,
    Image01Icon,
    SourceCodeIcon,
    Search01Icon,
    SidebarLeft01Icon,
} from '@hugeicons/core-free-icons';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { Settings, BookOpen, Cloud, Zap } from 'lucide-react';
import { useCloudEnvironments } from '@/hooks/useCloudEnvironments';
import { cn } from '@/lib/utils';
import { Conversation } from '@/types';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { ProgressRing } from '@/components/ui/progress-ring';

// Portal-rendered modal — keep its chunk (and framer-motion) out of the
// initial page JS; it loads after hydration, before the user can open it.
const SettingsModal = dynamic(
    () => import('@/components/ui/settings-modal').then((m) => m.SettingsModal),
    { ssr: false },
);

interface SidebarProps {
    isOpen: boolean;
    onToggle: () => void;
    collapsed?: boolean;
    onCollapseToggle?: () => void;
}

function LiveClock() {
    const [time, setTime] = useState('');
    useEffect(() => {
        const update = () => {
            const now = new Date();
            let h = now.getHours();
            const m = now.getMinutes().toString().padStart(2, '0');
            const s = now.getSeconds().toString().padStart(2, '0');
            const ampm = h >= 12 ? 'PM' : 'AM';
            h = h % 12 || 12;
            setTime(`${h}:${m}:${s} ${ampm}`);
        };
        update();
        const id = setInterval(update, 1000);
        return () => clearInterval(id);
    }, []);
    return (
        <span className="text-[10px] font-mono text-muted-foreground/45 tabular-nums tracking-tight select-none">
            {time}
        </span>
    );
}

// Social proof micro-line — honest platform stats, rotated subtly
const SOCIAL_LINES = [
    'No credit card needed — ever',
    'Takes about 10 seconds',
    'Your conversations, saved forever',
];

function SocialProofLine() {
    const [idx, setIdx] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setIdx((i) => (i + 1) % SOCIAL_LINES.length), 6000);
        return () => clearInterval(t);
    }, []);
    return (
        <p className="text-[9px] text-muted-foreground/30 text-center select-none transition-opacity duration-500">
            {SOCIAL_LINES[idx]}
        </p>
    );
}

function groupConversationsByTime(conversations: Conversation[]): { label: string; items: Conversation[] }[] {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfToday.getDate() - 1);
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() - 7);
    const startOfMonth = new Date(startOfToday);
    startOfMonth.setDate(startOfToday.getDate() - 30);

    const today: Conversation[] = [];
    const yesterday: Conversation[] = [];
    const thisWeek: Conversation[] = [];
    const older: Conversation[] = [];

    for (const conv of conversations) {
        const t = new Date(conv.updatedAt ?? conv.createdAt ?? 0).getTime();
        if (t >= startOfToday.getTime()) today.push(conv);
        else if (t >= startOfYesterday.getTime()) yesterday.push(conv);
        else if (t >= startOfWeek.getTime()) thisWeek.push(conv);
        else older.push(conv);
    }

    return [
        { label: 'Today', items: today },
        { label: 'Yesterday', items: yesterday },
        { label: 'Last 7 days', items: thisWeek },
        { label: 'Older', items: older },
    ].filter((g) => g.items.length > 0);
}

export default function Sidebar({ isOpen, onToggle, collapsed = false, onCollapseToggle }: SidebarProps) {
    const { conversations, activeConversationId } = useChatConversations();
    const { selectConversation, deleteConversation, createConversation, renameConversation } = useChatActions();
    const router = useRouter();
    const pathname = usePathname();
    const { user, isLoading } = useAuth();
    const isLoaded = !isLoading;
    const isSignedIn = !!user;
    const [search, setSearch] = useState('');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(260);

    useEffect(() => {
        const update = () => setSidebarWidth(SIDEBAR_WIDTHS[loadSettings().sidebarWidth]);
        update();
        window.addEventListener(SETTINGS_EVENT, update);
        return () => window.removeEventListener(SETTINGS_EVENT, update);
    }, []);

    const handleNewChat = useCallback(() => {
        const newId = createConversation();
        router.push(`/chat/${newId}`);
    }, [createConversation, router]);

    const handleSelectConversation = useCallback((conversationId: string) => {
        selectConversation(conversationId);
        router.push(`/chat/${conversationId}`);
    }, [selectConversation, router]);

    const handleDeleteConversation = useCallback((conversationId: string) => {
        deleteConversation(conversationId);
    }, [deleteConversation]);

    const handleRenameConversation = useCallback((conversationId: string, newTitle: string) => {
        renameConversation(conversationId, newTitle);
    }, [renameConversation]);

    const { envs: cloudEnvs, loaded: cloudLoaded } = useCloudEnvironments();
    const isCodeActive = pathname?.startsWith('/code');
    const filteredConversations = useMemo(() => {
        if (!search.trim()) return conversations;
        const q = search.toLowerCase();
        return conversations.filter((c) =>
            (c.title || 'New Chat').toLowerCase().includes(q)
        );
    }, [conversations, search]);

    const grouped = useMemo(() => groupConversationsByTime(filteredConversations), [filteredConversations]);

    const isGenerateActive = pathname?.startsWith('/generate');
    const isHyperAgentActive = pathname?.startsWith('/hyperagent');
    const navLinks = [
        { href: '/hyperagent', icon: null, label: 'HyperAgent', active: isHyperAgentActive, lucide: true, lucideIcon: Zap },
        { href: '/generate', icon: Image01Icon, label: 'Generative', active: isGenerateActive, lucide: false },
        { href: '/code', icon: SourceCodeIcon, label: 'Code', active: isCodeActive, lucide: false },
    ];

    // ── Icon-only collapsed sidebar ──────────────────────────────────────────
    if (collapsed) {
        return (
            <motion.aside
                initial={false}
                animate={{ width: 56, opacity: 1 }}
                transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="h-screen flex-shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar flex flex-col items-center py-3 gap-1"
                role="navigation"
                aria-label="Chat sidebar"
            >
                {/* Expand toggle */}
                <button
                    onClick={onCollapseToggle}
                    title="Expand sidebar"
                    className="w-9 h-9 flex items-center justify-center rounded-xl text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-all duration-150 mb-1"
                >
                    <HugeiconsIcon icon={SidebarLeft01Icon} size={18} />
                </button>

                {/* New chat */}
                <button
                    onClick={handleNewChat}
                    title="New chat"
                    className="w-9 h-9 flex items-center justify-center rounded-xl bg-sidebar-accent/60 hover:bg-sidebar-accent text-sidebar-foreground transition-all duration-150"
                >
                    <HugeiconsIcon icon={Add01Icon} size={17} />
                </button>

                {/* Search */}
                <button
                    title="Search chats"
                    className="w-9 h-9 flex items-center justify-center rounded-xl text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-all duration-150"
                >
                    <HugeiconsIcon icon={Search01Icon} size={17} />
                </button>

                <div className="w-6 border-t border-sidebar-border/50 my-1" />

                {/* Nav links — icon only */}
                {navLinks.map((link) => (
                    <Link
                        key={link.href}
                        href={link.href}
                        title={link.label}
                        className={cn(
                            'w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-150',
                            link.active
                                ? 'bg-sidebar-accent text-sidebar-foreground'
                                : 'text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                        )}
                    >
                        {link.lucide ? (
                            (() => { const LIcon = link.lucideIcon!; return <LIcon size={17} />; })()
                        ) : (
                            <HugeiconsIcon icon={link.icon!} size={17} />
                        )}
                    </Link>
                ))}

                <div className="flex-1" />

                {/* Settings */}
                <button
                    onClick={() => setSettingsOpen(true)}
                    title="Settings"
                    className="w-9 h-9 flex items-center justify-center rounded-xl text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-all duration-150"
                >
                    <Settings size={17} />
                </button>

                <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
            </motion.aside>
        );
    }

    return (
        <motion.aside
            initial={false}
            animate={{ width: isOpen ? sidebarWidth : 0, opacity: isOpen ? 1 : 0 }}
            transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="h-screen flex-shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar"
            role="navigation"
            aria-label="Chat sidebar"
        >
            <div className="flex flex-col h-full" style={{ width: sidebarWidth }}>

                {/* ── Header ─────────────────────────── */}
                <div className="px-3 pt-3 pb-2 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 px-1 py-1 rounded-lg hover:bg-sidebar-accent/50 transition-colors">
                        <Logo size={24} />
                        <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">
                            {APP_NAME}
                        </span>
                    </Link>
                    <div className="flex items-center gap-1">
                        <LiveClock />
                        <ThemeToggle />
                        {onCollapseToggle && (
                            <button
                                onClick={onCollapseToggle}
                                title="Collapse sidebar"
                                className="p-1.5 rounded-lg text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all duration-150"
                            >
                                <HugeiconsIcon icon={SidebarLeft01Icon} size={14} />
                            </button>
                        )}
                    </div>
                </div>

                {/* ── New Chat ────────────────────────── */}
                <div className="px-3 pb-2">
                    <button
                        onClick={handleNewChat}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-sidebar-accent/60 hover:bg-sidebar-accent text-sidebar-foreground/90 hover:text-sidebar-foreground text-sm font-medium transition-all duration-150 group"
                    >
                        <HugeiconsIcon icon={Add01Icon} size={15} className="shrink-0 transition-transform duration-150 group-hover:rotate-90" />
                        <span>New chat</span>
                        <span className="ml-auto text-[10px] text-muted-foreground/40 font-mono hidden group-hover:inline-block">
                            ⌘ N
                        </span>
                    </button>
                </div>

                {/* ── Command palette hint ────────────── */}
                <div className="px-4 pb-1 -mt-0.5">
                    <span className="text-[9px] font-mono text-muted-foreground/30 select-none">
                        ⌘K to jump anywhere
                    </span>
                </div>

                {/* ── Nav Links ───────────────────────── */}
                <div className="px-3 pb-2">
                    <div className="flex items-center gap-1">
                        {navLinks.map((link) => (
                            <Link
                                key={link.href}
                                href={link.href}
                                className={cn(
                                    'flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-[10px] font-medium transition-all duration-150',
                                    link.active
                                        ? 'bg-sidebar-accent text-sidebar-foreground'
                                        : 'text-sidebar-foreground/60 hover:text-sidebar-foreground text-sidebar-foreground hover:bg-sidebar-accent/40',
                                )}
                            >
                                {link.lucide ? (
                                    (() => { const LIcon = link.lucideIcon!; return <LIcon size={15} />; })()
                                ) : (
                                    <HugeiconsIcon icon={link.icon!} size={15} />
                                )}
                                <span>{link.label}</span>
                            </Link>
                        ))}
                    </div>
                </div>

                {/* ── Divider ─────────────────────────── */}
                <div className="mx-3 mb-2 border-t border-sidebar-border/50" />

                {/* ── Cloud Environments ──────────────── */}
                {cloudLoaded && cloudEnvs.length > 0 && (
                    <div className="px-3 mb-2">
                        <p className="text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider px-1 mb-1 select-none flex items-center gap-1">
                            <Cloud size={9} />
                            Cloud Envs
                        </p>
                        <div className="flex flex-col gap-0.5">
                            {cloudEnvs.slice(0, 5).map((env) => (
                                <Link
                                    key={env.id}
                                    href={`/c/${env.slug}`}
                                    className={cn(
                                        'flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all duration-150',
                                        pathname === `/c/${env.slug}`
                                            ? 'bg-sidebar-accent text-sidebar-foreground'
                                            : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                                    )}
                                >
                                    {env.status === 'active' ? (
                                        <span className="relative flex h-1.5 w-1.5 shrink-0">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50 [animation-duration:2.5s]" />
                                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
                                        </span>
                                    ) : (
                                        <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-red-400/70" />
                                    )}
                                    <span className="truncate flex-1">{env.name}</span>
                                </Link>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Search ──────────────────────────── */}
                {(isSignedIn || conversations.length > 0) && (
                    <div className="px-3 mb-1">
                        <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent/40 px-2.5 py-1.5 text-sm text-sidebar-foreground/70 focus-within:text-sidebar-foreground focus-within:bg-sidebar-accent/70 transition-all duration-150">
                            <HugeiconsIcon icon={Search01Icon} size={13} className="shrink-0" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search chats..."
                                className="flex-1 bg-transparent text-xs text-sidebar-foreground placeholder:text-sidebar-foreground/70 outline-none"
                            />
                        </div>
                    </div>
                )}

                {/* ── Conversation List ────────────────── */}
                <div className="flex-1 overflow-y-auto py-1 px-2 scrollbar-thin flex flex-col">
                    {!isLoaded ? null : (isSignedIn || conversations.length > 0) ? (
                        conversations.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-32 text-center px-4">
                                <p className="text-xs text-muted-foreground/50">No conversations yet</p>
                                <p className="text-xs text-muted-foreground/30 mt-1">Start a new chat above</p>
                            </div>
                        ) : grouped.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-20">
                                <p className="text-xs text-muted-foreground/40">No results</p>
                            </div>
                        ) : (
                            <AnimatePresence mode="popLayout">
                                {grouped.map((group) => (
                                    <div key={group.label} className="mb-2">
                                        <p className="text-[10px] font-medium text-sidebar-foreground/30 uppercase tracking-wider px-2 mb-1 select-none">
                                            {group.label}
                                        </p>
                                        {group.items.map((conv, i) => (
                                            <ConversationItem
                                                key={conv.id}
                                                conversation={conv}
                                                isActive={activeConversationId === conv.id}
                                                index={i}
                                                onSelect={handleSelectConversation}
                                                onDelete={handleDeleteConversation}
                                                onRename={handleRenameConversation}
                                            />
                                        ))}
                                    </div>
                                ))}
                            </AnimatePresence>
                        )
                    ) : (
                        <div className="flex-1 flex flex-col px-3 pt-4 gap-3">
                            <div>
                                <p className="text-xs font-semibold text-sidebar-foreground/80 mb-0.5">
                                    {conversations.length >= 5
                                        ? 'You\'re a power user'
                                        : conversations.length >= 2
                                            ? 'You\'re getting the hang of this'
                                            : 'Guest mode'}
                                </p>
                                <p className="text-[11px] text-muted-foreground/55 leading-relaxed">
                                    {conversations.length >= 5
                                        ? `You'll lose ${conversations.length} conversations when you close this tab. Save everything with a free account.`
                                        : conversations.length >= 2
                                            ? `${conversations.length} unsaved conversations. Close the tab and they're gone forever.`
                                            : 'Sign up free for unlimited messages, image generation, and AI memory.'}
                                </p>
                            </div>
                            <Link href="/register" className="w-full block">
                                <button className="w-full text-xs font-semibold text-violet-400 hover:text-violet-300 border border-violet-500/25 hover:border-violet-500/40 bg-violet-500/5 hover:bg-violet-500/10 rounded-lg px-3 py-2 transition-all duration-150 text-left">
                                    {conversations.length >= 3 ? 'Save your work — create account →' : 'Create free account →'}
                                </button>
                            </Link>
                        </div>
                    )}
                </div>

                {/* ── Settings + Triplepedia buttons ──────── */}
                <div className="px-3 pb-1 space-y-0.5">
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setSettingsOpen(true)}
                            className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/80 text-sm transition-all duration-150"
                        >
                            <Settings size={14} className="shrink-0" />
                            <span>Settings</span>
                        </button>
                        <ProgressRing />
                    </div>
                    <Link
                        href="/triplepedia"
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/80 text-sm transition-all duration-150"
                    >
                        <BookOpen size={14} className="shrink-0" />
                        <span>Triplepedia</span>
                        <span className="ml-auto text-[9px] font-bold uppercase tracking-wide bg-amber-500/15 text-amber-500 px-1.5 py-0.5 rounded-full">
                            Beta
                        </span>
                    </Link>
                </div>

                {/* ── Footer ──────────────────────────── */}
                {!isLoaded ? null : isSignedIn ? (
                    <UserProfile />
                ) : (
                    <div className="p-3 border-t border-sidebar-border space-y-1.5">
                        <Link href="/register" className="w-full block">
                            <Button className="w-full font-semibold rounded-full text-sm h-9" variant="default">
                                Create free account
                            </Button>
                        </Link>
                        <Link href="/login" className="w-full block">
                            <Button className="w-full rounded-full text-sm h-8" variant="ghost">
                                Sign in
                            </Button>
                        </Link>
                        <SocialProofLine />
                    </div>
                )}
            </div>

            <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </motion.aside>
    );
}
