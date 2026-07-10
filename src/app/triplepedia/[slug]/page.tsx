'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Search, RefreshCw, Clock, Sparkles } from 'lucide-react';
import ThemeToggle from '@/components/Layout/ThemeToggle';
import SuggestArticleModal from '../_components/SuggestArticleModal';
import TriplepediaUserButton from '../_components/TriplepediaUserButton';
import ReactionBar from '../_components/ReactionBar';
import BookmarkButton from '../_components/BookmarkButton';
import WormholeButton from '../_components/WormholeButton';
import StreakBadge from '../_components/StreakBadge';
import { LiquidMetalButton } from '@/components/ui/liquid-metal-button';
import { ArticleChatPanel, type AskRequest } from '@/components/Triplepedia/ArticleChatPanel';
import { useTriplepediaView } from '@/hooks/useTriplepediaView';
import { useTriplepediaStreak } from '@/hooks/useTriplepediaStreak';
import { estimateReadingTime } from '@/lib/triplepedia/constants';

function timeAgo(date: string): string {
    const diff = Date.now() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    if (days === 1) return '1 day ago';
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    if (months === 1) return '1 month ago';
    return `${months} months ago`;
}

interface Section {
    heading: string;
    content?: string;
    subheadings?: Array<{ heading: string; content: string }>;
}

interface InfoboxEntry {
    label: string;
    value: string | string[];
}

interface Article {
    id: string;
    title: string;
    slug: string;
    summary: string;
    sections: Section[];
    infobox: InfoboxEntry[];
    category: string | null;
    view_count: number;
    submitted_by: string | null;
    fact_checked_at: string;
    created_at: string;
    status: string;
}

interface RelatedArticle {
    id: string;
    title: string;
    slug: string;
    summary: string;
    category: string | null;
}

export default function ArticlePage() {
    const params = useParams();
    const router = useRouter();
    const slug = params?.slug as string;

    const [article, setArticle] = useState<Article | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [query, setQuery] = useState('');
    const [suggestions, setSuggestions] = useState<{ title: string; slug: string }[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [suggestOpen, setSuggestOpen] = useState(false);
    const [activeSection, setActiveSection] = useState('');
    const [relatedArticles, setRelatedArticles] = useState<RelatedArticle[]>([]);
    const [chatOpen, setChatOpen] = useState(false);
    const [askRequest, setAskRequest] = useState<AskRequest | null>(null);
    const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
    const searchRef = useRef<HTMLDivElement>(null);
    const articleEndRef = useRef<HTMLDivElement>(null);
    const articleRef = useRef<HTMLElement>(null);
    const askNonce = useRef(0);

    // Open the chat and seed it with a question about the given passage.
    const askAbout = useCallback((passage: string) => {
        const text = passage.trim();
        askNonce.current += 1;
        setAskRequest({
            prompt: text
                ? `Explain this passage from the article:\n\n"${text}"`
                : '',
            nonce: askNonce.current,
        });
        setChatOpen(true);
        setSelection(null);
    }, []);

    // Show a floating "Ask about this" button when the user highlights article text.
    useEffect(() => {
        const onMouseUp = () => {
            // Defer so the browser has committed the selection.
            requestAnimationFrame(() => {
                const sel = window.getSelection();
                const text = sel?.toString().trim() ?? '';
                if (!sel || sel.isCollapsed || text.length < 8 || !articleRef.current) {
                    setSelection(null);
                    return;
                }
                const range = sel.getRangeAt(0);
                if (!articleRef.current.contains(range.commonAncestorContainer)) {
                    setSelection(null);
                    return;
                }
                const rect = range.getBoundingClientRect();
                setSelection({
                    text,
                    x: rect.left + rect.width / 2,
                    y: rect.top,
                });
            });
        };
        const onScroll = () => setSelection(null);
        document.addEventListener('mouseup', onMouseUp);
        window.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('scroll', onScroll, true);
        };
    }, []);

    // Track view
    useTriplepediaView(article?.id);

    // Streak tracking
    const { markArticleRead } = useTriplepediaStreak();

    // Mark article read when user scrolls past 90%
    useEffect(() => {
        if (!article || !articleEndRef.current) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    markArticleRead(article.id);
                    observer.disconnect();
                }
            },
            { threshold: 0.1 }
        );
        observer.observe(articleEndRef.current);
        return () => observer.disconnect();
    }, [article, markArticleRead]);

    // Fetch article by slug (the API also returns related articles by category)
    useEffect(() => {
        if (!slug) return;
        setLoading(true);
        setNotFound(false);
        let cancelled = false;
        fetch(`/api/triplepedia/article?slug=${encodeURIComponent(String(slug))}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (cancelled) return;
                if (!data?.article) {
                    setNotFound(true);
                } else {
                    setArticle(data.article as Article);
                    setRelatedArticles((data.related as RelatedArticle[]) ?? []);
                }
                setLoading(false);
            })
            .catch(() => {
                if (cancelled) return;
                setNotFound(true);
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [slug]);

    // Search suggestions
    useEffect(() => {
        if (!query.trim()) { setSuggestions([]); return; }
        const t = setTimeout(async () => {
            try {
                const res = await fetch(
                    `/api/triplepedia/articles?q=${encodeURIComponent(query)}&limit=5`,
                );
                if (!res.ok) return;
                const data = await res.json();
                const items = (data.articles ?? []).map((a: { title: string; slug: string }) => ({
                    title: a.title,
                    slug: a.slug,
                }));
                setSuggestions(items);
            } catch {
                /* best-effort */
            }
        }, 180);
        return () => clearTimeout(t);
    }, [query]);

    // Close search dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Intersection observer for TOC active state
    useEffect(() => {
        if (!article) return;
        const headings = document.querySelectorAll('h2[data-section]');
        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries.find((e) => e.isIntersecting);
                if (visible) setActiveSection(visible.target.getAttribute('data-section') ?? '');
            },
            { rootMargin: '-20% 0px -70% 0px' }
        );
        headings.forEach((h) => observer.observe(h));
        return () => observer.disconnect();
    }, [article]);

    const handleSearchSubmit = useCallback(() => {
        if (suggestions.length > 0) {
            router.push(`/triplepedia/${suggestions[0].slug}`);
            setShowSuggestions(false);
        }
    }, [suggestions, router]);

    if (loading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="h-6 w-6 rounded-full border-2 border-foreground/20 border-t-foreground/60 animate-spin" />
            </div>
        );
    }

    if (notFound) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
                <p className="text-4xl">📖</p>
                <h1 className="text-xl font-bold text-foreground">Article not found</h1>
                <p className="text-sm text-muted-foreground">This article may not exist yet.</p>
                <Link
                    href="/triplepedia"
                    className="mt-2 px-4 py-2 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                    Back to Triplepedia
                </Link>
            </div>
        );
    }

    const sectionId = (heading: string) => heading.toLowerCase().replace(/\s+/g, '-');
    const renderParagraphs = (text?: string, className = '') => {
        if (!text) return null;
        const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
        return (
            <div className={`space-y-4 ${className}`}>
                {paragraphs.map((p, i) => (
                    <p key={i} className="text-base text-foreground/85 leading-relaxed">
                        {p}
                    </p>
                ))}
            </div>
        );
    };

    return (
        <div
            className={`min-h-screen bg-background text-foreground transition-[padding] duration-300 ease-out ${
                chatOpen ? 'lg:pr-[440px]' : ''
            }`}
        >
            {/* ── Top bar ─────────────────────────────────── */}
            <div className="sticky top-0 z-50 flex items-center gap-4 px-5 py-2.5 border-b border-border bg-background/95 backdrop-blur-sm">
                {/* Logo */}
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
                            onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit()}
                            placeholder="Search"
                            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none"
                        />
                        <kbd className="hidden sm:block text-[10px] text-muted-foreground/35 font-mono border border-border/60 rounded px-1 py-0.5 leading-none">
                            ⌘K
                        </kbd>
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
                        href="/triplepedia/explore"
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Explore
                    </Link>
                    <Link
                        href="/chat"
                        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <span className="text-base leading-none">←</span>
                        <span className="hidden sm:inline">Chat</span>
                    </Link>
                    <div className="w-px h-4 bg-border" />
                    <ThemeToggle />
                    <LiquidMetalButton
                        label="Ask about this article"
                        onClick={() => setChatOpen(true)}
                    />
                    <button
                        onClick={() => setSuggestOpen(true)}
                        className="px-4 py-1.5 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                    >
                        Suggest Article
                    </button>
                    <TriplepediaUserButton />
                </div>
            </div>

            {/* ── Three-column body ───────────────────────── */}
            <div className="flex max-w-[1300px] mx-auto px-6 py-8 gap-8">

                {/* Left: TOC */}
                <aside className="w-48 shrink-0 hidden lg:block">
                    <nav className="sticky top-20">
                        <ul className="space-y-0.5">
                            {article!.sections.map((s) => (
                                <li key={s.heading}>
                                    <a
                                        href={`#${sectionId(s.heading)}`}
                                        className={`block text-sm py-1 px-2 rounded-md transition-colors ${
                                            activeSection === sectionId(s.heading)
                                                ? 'text-foreground bg-muted/50'
                                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                                        }`}
                                    >
                                        {s.heading}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </nav>
                </aside>

                {/* Center: Article body */}
                <article ref={articleRef} className="flex-1 min-w-0 max-w-2xl">
                    {/* Meta row: fact-check + reading time + bookmark */}
                    <div className="flex items-center flex-wrap gap-3 mb-5">
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <RefreshCw size={13} className="shrink-0" />
                            <span>
                                Fact-checked by{' '}
                                <strong className="text-foreground font-semibold">Taipei 3.1 Extended</strong>{' '}
                                {timeAgo(article!.fact_checked_at)}
                            </span>
                        </div>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Clock size={13} />
                            <span>{estimateReadingTime(article!.sections)} min read</span>
                        </div>
                        <div className="ml-auto">
                            <BookmarkButton articleId={article!.id} variant="button" />
                        </div>
                    </div>

                    {/* Title */}
                    <h1 className="font-serif text-[42px] font-bold text-foreground mb-6 leading-tight">
                        {article!.title}
                    </h1>

                    {/* Summary */}
                    {article!.summary && (
                        <div className="mb-8 font-light">
                            {renderParagraphs(article!.summary)}
                        </div>
                    )}

                    {/* Sections */}
                    {article!.sections.map((section) => (
                        <div key={section.heading} className="mb-10">
                            <h2
                                id={sectionId(section.heading)}
                                data-section={sectionId(section.heading)}
                                className="font-serif text-[28px] font-bold text-foreground mb-4 border-b border-border pb-2 scroll-mt-24"
                            >
                                {section.heading}
                            </h2>

                            {section.content && (
                                <div className="mb-4">
                                    {renderParagraphs(section.content)}
                                </div>
                            )}

                            {section.subheadings?.map((sub) => (
                                <div key={sub.heading} className="mb-5">
                                    <h3 className="font-serif text-xl font-semibold text-foreground mt-5 mb-2">
                                        {sub.heading}
                                    </h3>
                                    {renderParagraphs(sub.content)}
                                </div>
                            ))}
                        </div>
                    ))}

                    {/* Reactions */}
                    <div className="mt-10 pt-6 border-t border-border">
                        <ReactionBar articleId={article!.id} />
                    </div>

                    {/* Footer attribution */}
                    <div className="mt-8 pt-6 border-t border-border text-xs text-muted-foreground/50 space-y-1">
                        {article!.submitted_by && (
                            <p>Submitted by {article!.submitted_by}</p>
                        )}
                        <p>
                            Fact-checked by{' '}
                            <span className="font-medium text-muted-foreground">Taipei 3.1 Extended</span>
                        </p>
                    </div>

                    {/* Scroll completion marker for streak tracking */}
                    <div ref={articleEndRef} className="h-px" />

                    {/* Related articles */}
                    {relatedArticles.length > 0 && (
                        <div className="mt-10 pt-6 border-t border-border">
                            <h2 className="font-serif text-xl font-bold text-foreground mb-4">Related Articles</h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {relatedArticles.map((rel) => (
                                    <Link
                                        key={rel.id}
                                        href={`/triplepedia/${rel.slug}`}
                                        className="group block rounded-xl border border-border p-4 hover:border-foreground/20 hover:bg-muted/30 transition-all"
                                    >
                                        <h3 className="font-serif text-sm font-semibold text-foreground group-hover:text-foreground/80 transition-colors line-clamp-2">
                                            {rel.title}
                                        </h3>
                                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
                                            {rel.summary}
                                        </p>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}
                </article>

                {/* Right: Infobox */}
                {article!.infobox && article!.infobox.length > 0 && (() => {
                    const imageEntry = article!.infobox.find((e) => e.label === '__image__');
                    const captionEntry = article!.infobox.find((e) => e.label === '__image_caption__');
                    const dataEntries = article!.infobox.filter(
                        (e) => e.label !== '__image__' && e.label !== '__image_caption__'
                    );

                    return (
                        <aside className="w-64 shrink-0 hidden xl:block">
                            <div className="sticky top-20 border border-border rounded-xl overflow-hidden">
                                {/* Infobox image — Wikipedia style */}
                                {imageEntry && (
                                    <div className="border-b border-border bg-muted/10">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={imageEntry.value as string}
                                            alt={captionEntry?.value as string || article!.title}
                                            className="w-full object-cover max-h-52"
                                        />
                                        {captionEntry && (
                                            <p className="px-3 py-1.5 text-[11px] text-muted-foreground/70 italic text-center leading-snug">
                                                {captionEntry.value as string}
                                            </p>
                                        )}
                                    </div>
                                )}

                                {/* Title row */}
                                <div className="bg-muted/40 px-4 py-3 border-b border-border">
                                    <h3 className="text-sm font-semibold text-foreground truncate">
                                        {article!.title}
                                    </h3>
                                </div>

                                {/* Data rows */}
                                {dataEntries.length > 0 && (
                                    <div className="divide-y divide-border">
                                        {dataEntries.map((entry) => (
                                            <div
                                                key={entry.label}
                                                className="flex items-start justify-between px-4 py-3 gap-3"
                                            >
                                                <span className="text-sm font-medium text-muted-foreground shrink-0 min-w-0">
                                                    {entry.label}
                                                </span>
                                                <span className="text-sm text-muted-foreground text-right">
                                                    {Array.isArray(entry.value)
                                                        ? entry.value.map((v, i) => (
                                                              <span key={i} className="block">{v}</span>
                                                          ))
                                                        : entry.value}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </aside>
                    );
                })()}
            </div>

            <SuggestArticleModal open={suggestOpen} onClose={() => setSuggestOpen(false)} />

            {/* Floating "ask about selection" affordance */}
            {selection && (
                <button
                    onMouseDown={(e) => e.preventDefault()} // keep the text selection alive through the click
                    onClick={() => askAbout(selection.text)}
                    style={{
                        position: 'fixed',
                        left: selection.x,
                        top: selection.y - 10,
                        transform: 'translate(-50%, -100%)',
                    }}
                    className="z-[150] flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-lg transition-transform hover:scale-105"
                >
                    <Sparkles size={13} className="text-primary" />
                    Ask about this
                </button>
            )}

            {/* Docked article chat panel */}
            {article && (
                <ArticleChatPanel
                    article={article}
                    open={chatOpen}
                    ask={askRequest}
                    onClose={() => setChatOpen(false)}
                />
            )}
        </div>
    );
}
