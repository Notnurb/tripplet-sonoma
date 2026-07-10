'use client';

import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';
import { useTriplepediaStreak } from '@/hooks/useTriplepediaStreak';

interface StreakBadgeProps {
    showLabel?: boolean;
}

export default function StreakBadge({ showLabel = false }: StreakBadgeProps) {
    const { currentStreak, title, nextMilestone, totalArticlesRead } = useTriplepediaStreak();

    if (currentStreak === 0 && totalArticlesRead === 0) return null;

    // Flame intensity: brighter at higher streaks
    const hue = Math.min(currentStreak * 3, 40); // 0-40 degrees shift
    const brightness = Math.min(1 + currentStreak * 0.02, 1.5);

    return (
        <div className="relative group">
            <motion.div
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-orange-500/20 bg-orange-500/10 cursor-default"
                whileHover={{ scale: 1.05 }}
            >
                <motion.div
                    animate={currentStreak > 0 ? {
                        scale: [1, 1.15, 1],
                        filter: [`hue-rotate(${hue}deg) brightness(${brightness})`, `hue-rotate(${hue + 10}deg) brightness(${brightness + 0.1})`, `hue-rotate(${hue}deg) brightness(${brightness})`],
                    } : {}}
                    transition={{ duration: 1.5, repeat: Infinity }}
                >
                    <Flame size={14} className={currentStreak > 0 ? 'text-orange-400' : 'text-muted-foreground/40'} />
                </motion.div>
                <span className="text-xs font-semibold text-orange-400 tabular-nums">
                    {currentStreak}
                </span>
                {showLabel && (
                    <span className="text-xs text-orange-400/70">{title}</span>
                )}
            </motion.div>

            {/* Tooltip */}
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs whitespace-nowrap">
                    <p className="font-semibold text-foreground">{title}</p>
                    <p className="text-muted-foreground">{currentStreak} day streak</p>
                    <p className="text-muted-foreground">{totalArticlesRead} articles read</p>
                    {nextMilestone && (
                        <p className="text-muted-foreground/60 mt-1">
                            Next: {nextMilestone.title} ({nextMilestone.days - currentStreak} days to go)
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
