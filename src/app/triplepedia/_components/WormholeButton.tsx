'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Shuffle } from 'lucide-react';

const HISTORY_KEY = 'triplepedia_wormhole_history';
const MAX_HISTORY = 10;

interface WormholeEntry {
    slug: string;
    title: string;
}

function loadHistory(): WormholeEntry[] {
    if (typeof window === 'undefined') return [];
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch { return []; }
}

function saveHistory(entries: WormholeEntry[]) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY))); } catch { /* */ }
}

interface WormholeButtonProps {
    variant?: 'icon' | 'full';
    category?: string | null;
}

export default function WormholeButton({ variant = 'icon', category }: WormholeButtonProps) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [showTrail, setShowTrail] = useState(false);
    const [history, setHistory] = useState<WormholeEntry[]>([]);
    const trailRef = useRef<HTMLDivElement>(null);

    useEffect(() => setHistory(loadHistory()), []);

    // Close trail on outside click
    useEffect(() => {
        if (!showTrail) return;
        const handler = (e: MouseEvent) => {
            if (trailRef.current && !trailRef.current.contains(e.target as Node)) {
                setShowTrail(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showTrail]);

    const handleWormhole = async () => {
        if (loading) return;
        setLoading(true);
        try {
            const params = category ? `?category=${category}` : '';
            const res = await fetch(`/api/triplepedia/random${params}`);
            if (!res.ok) return;
            const data = await res.json();

            const entry: WormholeEntry = { slug: data.slug, title: data.title };
            const newHistory = [entry, ...loadHistory().filter((h) => h.slug !== data.slug)].slice(0, MAX_HISTORY);
            saveHistory(newHistory);
            setHistory(newHistory);

            router.push(`/triplepedia/${data.slug}`);
        } catch { /* ignore */ }
        finally { setLoading(false); }
    };

    if (variant === 'icon') {
        return (
            <div className="relative" ref={trailRef}>
                <motion.button
                    onClick={handleWormhole}
                    onContextMenu={(e) => { e.preventDefault(); setShowTrail(!showTrail); }}
                    whileTap={{ scale: 0.85, rotate: 180 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    disabled={loading}
                    className="h-8 w-8 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50"
                    title="Random article (right-click for history)"
                >
                    <motion.div
                        animate={loading ? { rotate: 360 } : { rotate: 0 }}
                        transition={loading ? { duration: 0.6, repeat: Infinity, ease: 'linear' } : {}}
                    >
                        <Shuffle size={14} />
                    </motion.div>
                </motion.button>

                {/* Wormhole trail popover */}
                <AnimatePresence>
                    {showTrail && history.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0, y: -4, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -4, scale: 0.95 }}
                            className="absolute top-full mt-2 right-0 w-56 rounded-xl border border-border bg-card shadow-xl z-50 overflow-hidden"
                        >
                            <div className="px-3 py-2 text-[11px] text-muted-foreground/50 uppercase tracking-wider border-b border-border">
                                Wormhole Trail
                            </div>
                            {history.map((entry, i) => (
                                <button
                                    key={entry.slug}
                                    onClick={() => {
                                        setShowTrail(false);
                                        router.push(`/triplepedia/${entry.slug}`);
                                    }}
                                    className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors text-sm"
                                >
                                    <span className="text-muted-foreground/40 text-xs font-mono w-4 shrink-0">{i + 1}</span>
                                    <span className="truncate text-foreground/80">{entry.title}</span>
                                </button>
                            ))}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        );
    }

    // Full variant with label
    return (
        <motion.button
            onClick={handleWormhole}
            whileTap={{ scale: 0.92 }}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50"
        >
            <motion.div
                animate={loading ? { rotate: 360 } : { rotate: 0 }}
                transition={loading ? { duration: 0.6, repeat: Infinity, ease: 'linear' } : {}}
            >
                <Shuffle size={14} />
            </motion.div>
            <span>The Wormhole</span>
        </motion.button>
    );
}
