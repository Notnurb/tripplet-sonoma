'use client';

import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

interface StreakBadgeProps {
    count: number;
    isNew: boolean;
    isGuest?: boolean;
}

function streakLabel(count: number): string {
    if (count >= 30) return `🏆 ${count}-day streak — you're basically a legend`;
    if (count >= 14) return `${count} days straight — this is your thing now`;
    if (count >= 7)  return `7-day streak — one whole week, let's go!`;
    if (count >= 3)  return `${count}-day streak — nice, keep it going!`;
    if (count === 2) return "2-day streak — you came back, respect!";
    return "Day 1 — come back tomorrow for a streak!";
}

const MILESTONES = [3, 7, 14, 30];

export function StreakBadge({ count, isNew, isGuest }: StreakBadgeProps) {
    if (count <= 0) return null;

    const isMilestone = MILESTONES.includes(count) && isNew;

    return (
        <AnimatePresence>
            <motion.div
                initial={isNew ? { opacity: 0, scale: 0.85 } : { opacity: 1, scale: 1 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                className="mx-3 mb-2"
            >
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors ${
                    isMilestone
                        ? 'bg-amber-500/10 border-amber-500/25 text-amber-400'
                        : 'bg-sidebar-accent/40 border-sidebar-border/50 text-sidebar-foreground/60'
                }`}>
                    <motion.span
                        animate={isMilestone ? { scale: [1, 1.3, 1] } : {}}
                        transition={{ duration: 0.5, delay: 0.2 }}
                        className="text-sm"
                    >
                        🔥
                    </motion.span>
                    <span className="text-[11px] font-medium leading-tight flex-1 truncate">
                        {streakLabel(count)}
                    </span>
                </div>

                {isGuest && (
                    <Link href="/register">
                        <p className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 text-center mt-1 transition-colors cursor-pointer">
                            Create free account to save your streak
                        </p>
                    </Link>
                )}
            </motion.div>
        </AnimatePresence>
    );
}
