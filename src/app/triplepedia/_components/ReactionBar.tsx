'use client';

import { motion } from 'framer-motion';
import { REACTIONS } from '@/lib/triplepedia/constants';
import { useTriplepediaReactions } from '@/hooks/useTriplepediaReactions';
import type { ReactionType } from '@/lib/triplepedia/constants';

interface ReactionBarProps {
    articleId: string;
}

export default function ReactionBar({ articleId }: ReactionBarProps) {
    const { react, getCount, hasReacted, loading } = useTriplepediaReactions(articleId);

    if (loading) return null;

    return (
        <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground/50 mr-1">React:</span>
            {REACTIONS.map((r) => {
                const count = getCount(r.id as ReactionType);
                const reacted = hasReacted(r.id as ReactionType);

                return (
                    <motion.button
                        key={r.id}
                        onClick={() => react(r.id as ReactionType)}
                        disabled={reacted}
                        whileTap={reacted ? {} : { scale: 0.85 }}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-sm transition-all ${
                            reacted
                                ? 'border-foreground/20 bg-foreground/5 cursor-default'
                                : 'border-border hover:border-foreground/20 hover:bg-muted/50 cursor-pointer'
                        }`}
                        title={r.label}
                    >
                        <span className="text-base leading-none">{r.emoji}</span>
                        {count > 0 && (
                            <motion.span
                                key={count}
                                initial={{ scale: 1.4, opacity: 0.5 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="text-xs font-medium text-muted-foreground tabular-nums"
                            >
                                {count}
                            </motion.span>
                        )}
                    </motion.button>
                );
            })}
        </div>
    );
}
