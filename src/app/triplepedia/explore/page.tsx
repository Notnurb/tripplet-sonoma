'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import ThemeToggle from '@/components/Layout/ThemeToggle';
import TriplepediaUserButton from '../_components/TriplepediaUserButton';
import ArticleCard from '../_components/ArticleCard';
import WormholeButton from '../_components/WormholeButton';
import StreakBadge from '../_components/StreakBadge';
import type { ArticleCardData } from '../_components/ArticleCard';

const PAGE_SIZE = 24;

type SortMode = 'newest' | 'most_viewed';

export default function ExplorePage() {
    const router = useRouter();

    const [articles, setArticles] = useState<ArticleCardData[]>([]);
    const [sort, setSort] = useState<SortMode>('newest');
    const [serviceUnavailable, setServiceUnavailable] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [query, setQuery] = useState('');
    const [suggestions, setSuggestions] = useState<{ title: string; slug: string }[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);
    const offsetRef = useRef(0);

    // Fetch articles via API route
    const fetchArticles = useCallback(async (reset = false) => {
        if (reset) {
            offsetRef.current = 0;
            setLoading(true);
        } else {
            setLoadingMore(true);
        }

        try {
            const res = await fetch(
                `/api/triplepedia/articles?sort=${sort}&limit=${PAGE_SIZE}&offset=${offsetRef.current}`
            );
            if (!res.ok) {
                setServiceUnavailable(true);
                setHasMore(false);
                if (reset) setArticles([]);
                return;
            }

            const data = await res.json();
            if (data.available === false) {
                setServiceUnavailable(true);
                setHasMore(false);
                if (reset) setArticles([]);
                return;
            }

            const items = (data.articles ?? []) as ArticleCardData[];
            setServiceUnavailable(false);

            if (reset) {
                setArticles(items);
            } else {
                setArticles((prev) => [...prev, ...items]);
            }

            offsetRef.current += items.length;
            setHasMore(items.length === PAGE_SIZE);
        } catch {
            if (reset) setArticles([]);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [sort]);

    useEffect(() => {
        fetchArticles(true);
    }, [fetchArticles]);

    // Search suggestions via API
    useEffect(() => {
        if (!query.trim()) { setSuggestions([]); return; }
        const t = setTimeout(async () => {
            try {
                const res = await fetch(`/api/triplepedia/articles?q=${encodeURIComponent(query)}&limit=5`);
                if (!res.ok) {
                    setSuggestions([]);
                    return;
                }

                const data = await res.json();
                if (data.available === false) {
                    setSuggestions([]);
                    return;
                }

                const matched = (data.articles ?? [])
                    .map((a: ArticleCardData) => ({ title: a.title, slug: a.slug }));
                setSuggestions(matched);
            } catch {
                setSuggestions([]);
            }
        }, 200);
        return () => clearTimeout(t);
    }, [query]);

    // Outside click for search
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    return (
        <div className="min-h-screen bg-background text-foreground">
            {/* ── Top bar ─────────────────────────────────── */}
            <div className="sticky top-0 z-50 flex items-center gap-4 px-5 py-2.5 border-b border-border bg-background/95 backdrop-blur-sm">
                <Link href="/triplepedia" className="flex items-center gap-1 shrink-0 group">
                    <span className="font-serif text-xl font-normal text-foreground group-hover:opacity-80 transition-opacity">
                        Triplepedia
                    </span>
                    <span className="text-xs text-muted-foreground/40 italic ml-0.5">v0.2</span>
                </Link>

                {/* Search */}
                <div className="flex-1 max-w-md relative" ref={searchRef}>
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 focus-within:border-foreground/25 transition-colors">
                        <Search size={13} className="text-muted-foreground shrink-0" />
                        <input
                            value={query}
                            onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && suggestions.length > 0) {
                                    router.push(`/triplepedia/${suggestions[0].slug}`);
                                    setShowSuggestions(false);
                                }
                            }}
                            placeholder="Search articles..."
                            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none"
                        />
                    </div>

                    {showSuggestions && suggestions.length > 0 && (
                        <div className="absolute top-full mt-1 left-0 right-0 rounded-xl border border-border bg-card shadow-xl overflow-hidden z-50">
                            {suggestions.map((s) => (
                                <button
                                    key={s.slug}
                                    onClick={() => {
                                        router.push(`/triplepedia/${s.slug}`);
                                        setShowSuggestions(false);
                                    }}
                                    className="flex items-center gap-2 w-full px-3 py-2.5 text-left hover:bg-muted/50 transition-colors border-t border-border first:border-t-0"
                                >
                                    <Search size={12} className="text-muted-foreground shrink-0" />
                                    <span className="text-sm">{s.title}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Right controls */}
                <div className="ml-auto flex items-center gap-2.5">
                    <StreakBadge />
                    <WormholeButton />
                    <div className="w-px h-4 bg-border" />
                    <Link
                        href="/chat"
                        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <span className="text-base leading-none">&larr;</span>
                        <span className="hidden sm:inline">Back to chat</span>
                    </Link>
                    <ThemeToggle />
                    <TriplepediaUserButton />
                </div>
            </div>

            {/* ── Sort ────────────────────────────────── */}
            <div className="max-w-7xl mx-auto px-6 pt-6">
                <div className="flex items-center gap-2 mb-6">
                    <span className="text-xs text-muted-foreground/50">Sort by:</span>
                    {(['newest', 'most_viewed'] as SortMode[]).map((s) => (
                        <button
                            key={s}
                            onClick={() => setSort(s)}
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                                sort === s
                                    ? 'bg-muted text-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            {s === 'newest' ? 'Newest' : 'Most Viewed'}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Article grid ───────────────────────────── */}
            <div className="max-w-7xl mx-auto px-6 pb-12">
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 size={24} className="animate-spin text-muted-foreground" />
                    </div>
                ) : serviceUnavailable ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <p className="text-4xl mb-3">⚠️</p>
                        <p className="text-lg font-medium text-foreground mb-1">Triplepedia is unavailable</p>
                        <p className="text-sm text-muted-foreground max-w-md">
                            The article index could not be loaded right now, so this is not an empty wiki state.
                        </p>
                    </div>
                ) : articles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <p className="text-4xl mb-3">🔍</p>
                        <p className="text-lg font-medium text-foreground mb-1">No articles found</p>
                        <p className="text-sm text-muted-foreground">
                            The knowledge base is still growing!
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {articles.map((article, i) => (
                                <ArticleCard key={article.id} article={article} index={i} />
                            ))}
                        </div>

                        {/* Load more */}
                        {hasMore && (
                            <div className="flex justify-center mt-8">
                                <motion.button
                                    onClick={() => fetchArticles(false)}
                                    disabled={loadingMore}
                                    whileTap={{ scale: 0.95 }}
                                    className="px-6 py-2.5 rounded-full border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50"
                                >
                                    {loadingMore ? (
                                        <span className="inline-flex items-center gap-2">
                                            <Loader2 size={14} className="animate-spin" />
                                            Loading...
                                        </span>
                                    ) : (
                                        'Load More'
                                    )}
                                </motion.button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
