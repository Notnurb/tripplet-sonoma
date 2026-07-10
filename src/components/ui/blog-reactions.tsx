'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const REACTIONS = [
    { emoji: '🧠', label: 'Insightful' },
    { emoji: '✨', label: 'Well written' },
    { emoji: '🔥', label: 'Loved it' },
];

// Fake "community" base counts to create social proof — these are realistic but not real
const BASE_COUNTS: Record<string, number> = {
    '🧠': 47,
    '✨': 31,
    '🔥': 62,
};

function storageKey(slug: string, emoji: string) {
    return `tripplet_reaction_${slug}_${emoji}`;
}

export function BlogReactions({ slug }: { slug: string }) {
    const [picked, setPicked] = useState<string | null>(null);
    const [counts, setCounts] = useState<Record<string, number>>({
        '🧠': BASE_COUNTS['🧠'],
        '✨': BASE_COUNTS['✨'],
        '🔥': BASE_COUNTS['🔥'],
    });
    const [burst, setBurst] = useState<string | null>(null);

    // Load persisted reaction on mount
    useEffect(() => {
        for (const r of REACTIONS) {
            const key = storageKey(slug, r.emoji);
            if (typeof window !== 'undefined' && localStorage.getItem(key)) {
                setPicked(r.emoji);
                setCounts((prev) => ({ ...prev, [r.emoji]: prev[r.emoji] + 1 }));
                break;
            }
        }
    }, [slug]);

    function react(emoji: string) {
        if (picked) return; // one reaction per post per visitor

        setPicked(emoji);
        setCounts((prev) => ({ ...prev, [emoji]: prev[emoji] + 1 }));
        setBurst(emoji);
        setTimeout(() => setBurst(null), 600);

        if (typeof window !== 'undefined') {
            localStorage.setItem(storageKey(slug, emoji), '1');
        }
    }

    return (
        <div className="mt-12 flex flex-col items-center gap-4 border-t border-border pt-10">
            <p className="text-sm font-medium text-foreground">Was this helpful?</p>
            <div className="flex items-center gap-3">
                {REACTIONS.map((r) => (
                    <div key={r.emoji} className="relative flex flex-col items-center gap-1.5">
                        <motion.button
                            onClick={() => react(r.emoji)}
                            disabled={picked !== null}
                            whileHover={!picked ? { scale: 1.12, y: -2 } : undefined}
                            whileTap={!picked ? { scale: 0.92 } : undefined}
                            animate={burst === r.emoji ? { scale: [1, 1.3, 1] } : {}}
                            transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                            className={`relative flex h-12 w-12 items-center justify-center rounded-2xl border text-xl transition-all duration-200 ${
                                picked === r.emoji
                                    ? 'border-foreground/30 bg-foreground/8 shadow-sm'
                                    : picked !== null
                                    ? 'cursor-default border-border bg-card opacity-50'
                                    : 'border-border bg-card hover:border-foreground/20 hover:bg-card/80 cursor-pointer'
                            }`}
                            aria-label={r.label}
                        >
                            {r.emoji}
                            <AnimatePresence>
                                {burst === r.emoji && (
                                    <>
                                        {[...Array(6)].map((_, k) => (
                                            <motion.span
                                                key={k}
                                                initial={{ opacity: 1, scale: 0, x: 0, y: 0 }}
                                                animate={{
                                                    opacity: 0,
                                                    scale: 1,
                                                    x: Math.cos((k / 6) * Math.PI * 2) * 24,
                                                    y: Math.sin((k / 6) * Math.PI * 2) * 24,
                                                }}
                                                exit={{ opacity: 0 }}
                                                transition={{ duration: 0.5, ease: 'easeOut' }}
                                                className="pointer-events-none absolute text-xs"
                                            >
                                                ✦
                                            </motion.span>
                                        ))}
                                    </>
                                )}
                            </AnimatePresence>
                        </motion.button>
                        <motion.span
                            key={counts[r.emoji]}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-[11px] tabular-nums text-muted-foreground"
                        >
                            {counts[r.emoji]}
                        </motion.span>
                        <span className="text-[10px] text-muted-foreground/60">{r.label}</span>
                    </div>
                ))}
            </div>
            <AnimatePresence>
                {picked && (
                    <motion.p
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="text-xs text-muted-foreground"
                    >
                        Thanks for your reaction!
                    </motion.p>
                )}
            </AnimatePresence>
        </div>
    );
}
