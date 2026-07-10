'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useChatActions, useChatConversations } from '@/context/ChatContext';
import { MessageSquare, Code2, BookOpen, Plus, ArrowRight, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATIC_ACTIONS = [
    { id: 'new-chat',     label: 'New chat',          icon: Plus,         href: '',          action: 'new-chat' },
    { id: 'code',         label: 'Code workspace',    icon: Code2,        href: '/code',     action: 'nav' },
    { id: 'triplepedia',  label: 'Triplepedia',        icon: BookOpen,     href: '/triplepedia', action: 'nav' },
];

export function CommandPalette() {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [selectedIdx, setSelectedIdx] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const router = useRouter();
    const { conversations } = useChatConversations();
    const { createConversation, selectConversation } = useChatActions();

    // ⌘K / Ctrl+K to open
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setOpen((v) => !v);
            }
            if (e.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    // Focus input when opened
    useEffect(() => {
        if (open) {
            setQuery('');
            setSelectedIdx(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open]);

    const recentConvs = conversations.slice(0, 5);

    const filteredActions = query.trim()
        ? STATIC_ACTIONS.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()))
        : STATIC_ACTIONS;

    const filteredConvs = query.trim()
        ? recentConvs.filter((c) =>
            (c.title || 'New Chat').toLowerCase().includes(query.toLowerCase())
          )
        : recentConvs;

    const totalItems = filteredActions.length + filteredConvs.length;

    useEffect(() => {
        setSelectedIdx(0);
    }, [query]);

    const execute = useCallback((actionIdx: number) => {
        if (actionIdx < filteredActions.length) {
            const action = filteredActions[actionIdx];
            if (action.action === 'new-chat') {
                const id = createConversation();
                router.push(`/chat/${id}`);
            } else {
                router.push(action.href);
            }
        } else {
            const conv = filteredConvs[actionIdx - filteredActions.length];
            selectConversation(conv.id);
            router.push(`/chat/${conv.id}`);
        }
        setOpen(false);
    }, [filteredActions, filteredConvs, createConversation, selectConversation, router]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIdx((i) => Math.min(i + 1, totalItems - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIdx((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (totalItems > 0) execute(selectedIdx);
        }
    };

    return (
        <AnimatePresence>
            {open && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        onClick={() => setOpen(false)}
                        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
                    />

                    {/* Palette */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.96, y: -12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: -8 }}
                        transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
                        className="fixed top-[20vh] left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4"
                    >
                        <div className="rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
                            {/* Search input */}
                            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <input
                                    ref={inputRef}
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Search or jump to…"
                                    className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none"
                                />
                                <kbd className="text-[10px] font-mono text-muted-foreground/40 border border-border rounded px-1.5 py-0.5">esc</kbd>
                            </div>

                            <div className="py-2 max-h-[360px] overflow-y-auto">
                                {/* Actions */}
                                {filteredActions.length > 0 && (
                                    <div>
                                        <p className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider">
                                            Actions
                                        </p>
                                        {filteredActions.map((action, i) => {
                                            const Icon = action.icon;
                                            return (
                                                <button
                                                    key={action.id}
                                                    onClick={() => execute(i)}
                                                    onMouseEnter={() => setSelectedIdx(i)}
                                                    className={cn(
                                                        'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                                                        selectedIdx === i ? 'bg-muted/60' : 'hover:bg-muted/30',
                                                    )}
                                                >
                                                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                                                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                                                    </div>
                                                    <span className="text-sm font-medium">{action.label}</span>
                                                    {selectedIdx === i && (
                                                        <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground/50" />
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* Recent conversations */}
                                {filteredConvs.length > 0 && (
                                    <div className={filteredActions.length > 0 ? 'mt-1' : ''}>
                                        <p className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider">
                                            Recent chats
                                        </p>
                                        {filteredConvs.map((conv, i) => {
                                            const idx = filteredActions.length + i;
                                            return (
                                                <button
                                                    key={conv.id}
                                                    onClick={() => execute(idx)}
                                                    onMouseEnter={() => setSelectedIdx(idx)}
                                                    className={cn(
                                                        'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                                                        selectedIdx === idx ? 'bg-muted/60' : 'hover:bg-muted/30',
                                                    )}
                                                >
                                                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                                                        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                                                    </div>
                                                    <span className="text-sm text-foreground/80 truncate">{conv.title || 'New Chat'}</span>
                                                    {selectedIdx === idx && (
                                                        <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}

                                {totalItems === 0 && (
                                    <p className="px-4 py-6 text-center text-sm text-muted-foreground/50">No results for &ldquo;{query}&rdquo;</p>
                                )}
                            </div>

                            <div className="border-t border-border px-4 py-2 flex items-center gap-3 text-[10px] text-muted-foreground/40">
                                <span><kbd className="font-mono">↑↓</kbd> navigate</span>
                                <span><kbd className="font-mono">↵</kbd> select</span>
                                <span><kbd className="font-mono">esc</kbd> close</span>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
