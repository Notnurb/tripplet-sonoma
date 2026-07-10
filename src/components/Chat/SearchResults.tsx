'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SearchResult } from '@/types';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    ArrowDown01Icon,
    ArrowUp01Icon,
    Link04Icon,
    Globe02Icon
} from '@hugeicons/core-free-icons';

interface SearchResultsProps {
    results: SearchResult[];
    isSearching?: boolean;
}

export default function SearchResults({ results, isSearching }: SearchResultsProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!results?.length && !isSearching) return null;

    return (
        <div className="search-results mt-3 rounded-lg border border-white/10 bg-white/5 backdrop-blur-md overflow-hidden">
            {/* Header */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <HugeiconsIcon icon={Globe02Icon} className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-foreground/70">
                        {isSearching ? (
                            <motion.span
                                animate={{ opacity: [1, 0.5, 1] }}
                                transition={{ repeat: Infinity, duration: 1.2 }}
                            >
                                Searching the web...
                            </motion.span>
                        ) : (
                            `${results.length} source${results.length !== 1 ? 's' : ''} found`
                        )}
                    </span>
                    {/* Source badges */}
                    <div className="flex gap-1">
                        {results.some(r => r.source === 'exa') && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">Exa</span>
                        )}
                        {results.some(r => r.source === 'firecrawl') && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300">Firecrawl</span>
                        )}
                    </div>
                </div>
                {isExpanded ? (
                    <HugeiconsIcon icon={ArrowUp01Icon} className="w-3.5 h-3.5 text-foreground/40" />
                ) : (
                    <HugeiconsIcon icon={ArrowDown01Icon} className="w-3.5 h-3.5 text-foreground/40" />
                )}
            </button>

            {/* Results list */}
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="border-t border-white/5"
                    >
                        <div className="max-h-64 overflow-y-auto divide-y divide-white/5">
                            {results.map((result, i) => (
                                <motion.a
                                    key={i}
                                    href={result.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block px-3 py-2.5 hover:bg-white/5 transition-colors group"
                                    initial={{ opacity: 0, x: -5 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.05 }}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium text-foreground/90 truncate group-hover:text-foreground transition-colors">
                                                {result.title || 'Untitled'}
                                            </p>
                                            {result.url && (
                                                <p className="text-[10px] text-foreground/40 truncate mt-0.5">
                                                    {new URL(result.url).hostname}
                                                </p>
                                            )}
                                            {result.highlights?.[0] && (
                                                <p className="text-[11px] text-foreground/60 mt-1 line-clamp-2 leading-relaxed">
                                                    {result.highlights[0].slice(0, 150)}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <span className={`text-[8px] px-1 py-0.5 rounded ${result.source === 'firecrawl'
                                                ? 'bg-orange-500/20 text-orange-300'
                                                : 'bg-emerald-500/20 text-emerald-300'
                                                }`}>
                                                {result.source}
                                            </span>
                                            <HugeiconsIcon icon={Link04Icon} className="w-3 h-3 text-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    </div>
                                </motion.a>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
