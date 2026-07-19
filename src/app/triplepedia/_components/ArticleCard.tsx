'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Eye, Clock } from 'lucide-react';
import BookmarkButton from './BookmarkButton';
import { estimateReadingTime } from '@/lib/triplepedia/constants';

interface Section {
    heading: string;
    content?: string;
    subheadings?: Array<{ heading: string; content: string }>;
}

interface InfoboxEntry {
    label: string;
    value: string | string[];
}

export interface ArticleCardData {
    id: string;
    slug: string;
    title: string;
    summary: string;
    category?: string | null;
    view_count?: number;
    sections: Section[];
    infobox?: InfoboxEntry[];
}

interface ArticleCardProps {
    article: ArticleCardData;
    index?: number;
}

export default function ArticleCard({ article, index = 0 }: ArticleCardProps) {
    const imageEntry = article.infobox?.find((e) => e.label === '__image__');
    const imageUrl = imageEntry ? (imageEntry.value as string) : null;
    const readTime = estimateReadingTime(article.sections);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: index * 0.05, ease: 'easeOut' }}
        >
            <Link
                href={`/triplepedia/${article.slug}`}
                className="group block rounded-2xl border border-border bg-card overflow-hidden card-hover transition-all"
            >
                {/* Thumbnail */}
                {imageUrl && (
                    <div className="relative h-36 overflow-hidden bg-muted/20">
                        { }
                        <img
                            src={imageUrl}
                            alt={article.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                    </div>
                )}

                <div className="p-4">
                    {/* Top row: bookmark */}
                    <div className="flex items-start justify-end gap-2 mb-2">
                        <BookmarkButton articleId={article.id} variant="icon" />
                    </div>

                    {/* Title */}
                    <h3 className="font-serif text-base font-semibold text-foreground mb-1.5 line-clamp-2 group-hover:text-foreground/80 transition-colors">
                        {article.title}
                    </h3>

                    {/* Summary */}
                    <p className="text-sm text-muted-foreground line-clamp-3 mb-3 leading-relaxed">
                        {article.summary}
                    </p>

                    {/* Footer meta */}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
                        {typeof article.view_count === 'number' && (
                            <span className="inline-flex items-center gap-1">
                                <Eye size={11} />
                                {article.view_count.toLocaleString()}
                            </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                            <Clock size={11} />
                            {readTime} min read
                        </span>
                    </div>
                </div>
            </Link>
        </motion.div>
    );
}
