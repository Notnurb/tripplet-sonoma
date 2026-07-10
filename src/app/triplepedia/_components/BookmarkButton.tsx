'use client';

import { motion } from 'framer-motion';
import { Heart } from 'lucide-react';
import { useTriplepediaBookmarks } from '@/hooks/useTriplepediaBookmarks';

interface BookmarkButtonProps {
    articleId: string;
    variant?: 'icon' | 'button';
}

export default function BookmarkButton({ articleId, variant = 'icon' }: BookmarkButtonProps) {
    const { isBookmarked, toggle } = useTriplepediaBookmarks();
    const active = isBookmarked(articleId);

    if (variant === 'icon') {
        return (
            <motion.button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(articleId); }}
                whileTap={{ scale: 0.8 }}
                className="p-1 rounded-full hover:bg-muted/50 transition-colors"
                title={active ? 'Remove bookmark' : 'Bookmark'}
            >
                <motion.div
                    animate={active ? { scale: [1, 1.4, 1] } : { scale: 1 }}
                    transition={{ duration: 0.3 }}
                >
                    <Heart
                        size={14}
                        className={active
                            ? 'fill-red-500 text-red-500'
                            : 'text-muted-foreground hover:text-foreground'
                        }
                    />
                </motion.div>
            </motion.button>
        );
    }

    return (
        <motion.button
            onClick={() => toggle(articleId)}
            whileTap={{ scale: 0.9 }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-colors ${
                active
                    ? 'border-red-500/30 bg-red-500/10 text-red-400'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
            }`}
        >
            <motion.div
                animate={active ? { scale: [1, 1.3, 1] } : { scale: 1 }}
                transition={{ duration: 0.3 }}
            >
                <Heart
                    size={14}
                    className={active ? 'fill-red-500 text-red-500' : ''}
                />
            </motion.div>
            <span>{active ? 'Bookmarked' : 'Bookmark'}</span>
        </motion.button>
    );
}
