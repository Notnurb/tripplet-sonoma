'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft, Search, Loader2, CheckCircle2, AlertTriangle,
    Info, Download, ExternalLink, ImagePlus, X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import ThemeToggle from '@/components/Layout/ThemeToggle';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExtractedArticle {
    title: string;
    summary: string;
    sections: Array<{ heading: string; content: string }>;
    infobox: Array<{ label: string; value: string }>;
    references: Array<{ text: string; url?: string }>;
    imageUrl: string | null;
    sourceUrl: string;
    sourceLabel: string;
    license: string;
    attribution: string;
}

// ─── Legality badge ───────────────────────────────────────────────────────────

function LegalityBadge({ url }: { url: string }) {
    const isWikipedia = url.includes('wikipedia.org');

    if (isWikipedia) {
        return (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                <span className="text-xs text-emerald-400 font-medium">
                    Wikipedia content is CC BY-SA 4.0 — free to reuse with attribution ✓
                </span>
            </div>
        );
    }

    if (url) {
        return (
            <div className="flex items-center gap-2 rounded-xl bg-blue-500/10 border border-blue-500/20 px-3 py-2">
                <Info size={14} className="text-blue-400 shrink-0" />
                <span className="text-xs text-blue-400 font-medium">
                    Always verify the source&apos;s license before publishing. Attribution will be included automatically.
                </span>
            </div>
        );
    }

    return null;
}

// ─── Main page ────────────────────────────────────────────────────────────────

function slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

export default function TriplepediaGrabberPage() {
    const router = useRouter();
    const { user } = useAuth();

    const [url, setUrl] = useState('');
    const [extracting, setExtracting] = useState(false);
    const [extractError, setExtractError] = useState('');
    const [article, setArticle] = useState<ExtractedArticle | null>(null);

    // Editable fields (pre-filled from extraction)
    const [title, setTitle] = useState('');
    const [summary, setSummary] = useState('');
    const [sections, setSections] = useState<Array<{ heading: string; content: string }>>([]);
    const [infobox, setInfobox] = useState<Array<{ label: string; value: string }>>([]);
    const [references, setReferences] = useState<Array<{ text: string; url?: string }>>([]);

    // Image state
    const [imageUrl, setImageUrl] = useState<string | null>(null);   // from extraction
    const [imageFile, setImageFile] = useState<File | null>(null);   // custom override
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [imageCaption, setImageCaption] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);
    const [submitError, setSubmitError] = useState('');

    // ── Extract ────────────────────────────────────────────────────────────
    const handleExtract = useCallback(async () => {
        if (!url.trim()) return;
        setExtracting(true);
        setExtractError('');
        setArticle(null);
        setDone(false);
        setSubmitError('');

        try {
            const res = await fetch('/api/triplepedia/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url.trim() }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? 'Extraction failed.');

            setArticle(data);
            setTitle(data.title);
            setSummary(data.summary);
            setSections(data.sections);
            setInfobox(data.infobox);
            setReferences(data.references ?? []);
            setImageUrl(data.imageUrl);
            setImagePreview(null);
            setImageFile(null);
            setImageCaption('');
        } catch (e: unknown) {
            setExtractError(e instanceof Error ? e.message : 'Something went wrong.');
        } finally {
            setExtracting(false);
        }
    }, [url]);

    // ── Image override ────────────────────────────────────────────────────
    const handleImageFile = useCallback((file: File) => {
        if (!file.type.startsWith('image/')) return;
        if (imagePreview) URL.revokeObjectURL(imagePreview);
        setImageFile(file);
        setImageUrl(null);
        setImagePreview(URL.createObjectURL(file));
    }, [imagePreview]);

    const clearImage = useCallback(() => {
        if (imagePreview) URL.revokeObjectURL(imagePreview);
        setImageFile(null);
        setImagePreview(null);
        setImageUrl(article?.imageUrl ?? null);
    }, [imagePreview, article]);

    // ── Submit ────────────────────────────────────────────────────────────
    const handleImport = useCallback(async () => {
        if (!title.trim() || !summary.trim()) {
            setSubmitError('Title and summary are required.');
            return;
        }
        setSubmitError('');
        setSubmitting(true);

        // Upload image override if user picked one
        let finalImageUrl: string | null = imageUrl;
        if (imageFile) {
            const fd = new FormData();
            fd.append('file', imageFile);
            const up = await fetch('/api/triplepedia/upload', { method: 'POST', body: fd });
            if (up.ok) {
                const { url: uploaded } = await up.json();
                finalImageUrl = uploaded;
            }
        }

        const finalInfobox = [
            ...(finalImageUrl
                ? [
                      { label: '__image__', value: finalImageUrl },
                      ...(imageCaption.trim() ? [{ label: '__image_caption__', value: imageCaption }] : []),
                  ]
                : []),
            ...infobox.filter((e) => e.label.trim() && e.value.trim()),
        ];

        // Append attribution as the last infobox entry
        if (article) {
            finalInfobox.push({ label: 'Source', value: article.sourceUrl });
        }

        const slug = slugify(title.trim()) + '-' + Date.now().toString(36);

        let ok = false;
        try {
            const res = await fetch('/api/triplepedia/articles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title.trim(),
                    slug,
                    summary: summary.trim(),
                    sections: sections.filter((s) => s.heading.trim() || s.content.trim()),
                    infobox: finalInfobox,
                    submitted_by: user?.email ?? null,
                    status: 'published',
                }),
            });
            ok = res.ok;
        } catch {
            ok = false;
        }

        setSubmitting(false);

        if (!ok) {
            setSubmitError('Failed to save. Please try again.');
            return;
        }

        setDone(true);
        setTimeout(() => router.push(`/triplepedia/${slug}`), 1600);
    }, [title, summary, sections, infobox, references, imageUrl, imageFile, imageCaption, article, user, router]);

    const displayImage = imagePreview ?? imageUrl;

    return (
        <div className="min-h-screen bg-background text-foreground">
            {/* Top bar */}
            <div className="sticky top-0 z-40 flex items-center justify-between px-6 py-3 border-b border-border bg-background/95 backdrop-blur-sm">
                <div className="flex items-center gap-3">
                    <Link href="/triplepedia" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                        <ArrowLeft size={14} />
                        Triplepedia
                    </Link>
                    <span className="text-border/60">·</span>
                    <span className="text-sm font-semibold text-foreground">Article Grabber</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider bg-violet-500/15 text-violet-400 border border-violet-500/20 px-1.5 py-0.5 rounded-full">
                        Beta
                    </span>
                    <Link
                        href="/tgrablockbatch"
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors border border-border/60 rounded-lg px-2 py-1"
                    >
                        Batch mode →
                    </Link>
                </div>
                <ThemeToggle />
            </div>

            <div className="max-w-3xl mx-auto px-6 py-10">

                {/* Hero */}
                <div className="mb-8">
                    <h1 className="font-serif text-3xl font-bold text-foreground mb-2">
                        Import an article
                    </h1>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                        Paste a <strong className="text-foreground">Wikipedia</strong> URL to extract its title, summary, sections, and infobox — then publish it to Triplepedia with full attribution. Works best with Wikipedia.
                    </p>
                </div>

                {/* URL input */}
                <div className="mb-4">
                    <div className="flex gap-2">
                        <div className="flex-1 flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2.5 focus-within:border-foreground/30 transition-colors">
                            <Search size={14} className="text-muted-foreground shrink-0" />
                            <input
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleExtract()}
                                placeholder="https://en.wikipedia.org/wiki/Artificial_intelligence"
                                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none"
                            />
                            {url && (
                                <button onClick={() => { setUrl(''); setArticle(null); }} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                                    <X size={13} />
                                </button>
                            )}
                        </div>
                        <button
                            onClick={handleExtract}
                            disabled={extracting || !url.trim()}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-foreground text-background text-sm font-semibold hover:opacity-80 transition-opacity disabled:opacity-40"
                        >
                            {extracting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                            {extracting ? 'Extracting…' : 'Extract'}
                        </button>
                    </div>
                </div>

                {/* Legality badge */}
                <div className="mb-6">
                    <LegalityBadge url={url} />
                </div>

                {/* Extraction error */}
                {extractError && (
                    <div className="mb-6 flex items-center gap-2 rounded-xl bg-destructive/10 border border-destructive/20 px-3 py-2.5">
                        <AlertTriangle size={14} className="text-destructive shrink-0" />
                        <span className="text-sm text-destructive">{extractError}</span>
                    </div>
                )}

                {/* Extracted content editor */}
                <AnimatePresence>
                    {article && (
                        <motion.div
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3 }}
                            className="space-y-6"
                        >
                            {/* Attribution banner */}
                            <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 flex items-start gap-3">
                                <Info size={14} className="text-muted-foreground shrink-0 mt-0.5" />
                                <div className="text-xs text-muted-foreground leading-relaxed">
                                    <span className="font-semibold text-foreground">Source: </span>
                                    <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer"
                                        className="underline hover:text-foreground transition-colors">
                                        {article.sourceUrl}
                                    </a>
                                    <span className="ml-2 text-muted-foreground/60">({article.license})</span>
                                    <span className="block mt-1 text-muted-foreground/60">{article.attribution}</span>
                                </div>
                                <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer"
                                    className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                                    <ExternalLink size={12} />
                                </a>
                            </div>

                            {/* Title */}
                            <div>
                                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Title</label>
                                <input
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-foreground/30 transition-colors"
                                />
                            </div>

                            {/* Summary */}
                            <div>
                                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Summary</label>
                                <textarea
                                    value={summary}
                                    onChange={(e) => setSummary(e.target.value)}
                                    rows={4}
                                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-foreground/30 transition-colors resize-none"
                                />
                            </div>

                            {/* Infobox image */}
                            <div>
                                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
                                    Infobox Image
                                </label>
                                {displayImage ? (
                                    <div className="rounded-xl border border-border overflow-hidden">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={displayImage} alt={title} className="w-full max-h-56 object-contain bg-muted/20" />
                                        <div className="px-3 py-2.5 border-t border-border flex items-center gap-2">
                                            <input
                                                value={imageCaption}
                                                onChange={(e) => setImageCaption(e.target.value)}
                                                placeholder="Caption (optional)…"
                                                className="flex-1 bg-transparent text-xs text-foreground/80 placeholder:text-muted-foreground/40 outline-none"
                                            />
                                            {imageFile && (
                                                <button onClick={clearImage} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0">
                                                    <X size={12} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/25 transition-colors"
                                    >
                                        <ImagePlus size={14} />
                                        Add image manually
                                    </button>
                                )}
                                <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); }} />
                            </div>

                            {/* Sections preview */}
                            {sections.length > 0 && (
                                <div>
                                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
                                        Sections ({sections.length} extracted)
                                    </label>
                                    <div className="space-y-0 max-h-96 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                                        {sections.map((s, i) => (
                                            <div key={i} className="px-4 py-3">
                                                <p className="text-xs font-semibold text-foreground mb-1.5">{s.heading}</p>
                                                <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                                                    {s.content}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Infobox preview */}
                            {infobox.length > 0 && (
                                <div>
                                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
                                        Infobox ({infobox.length} entries)
                                    </label>
                                    <div className="rounded-xl border border-border divide-y divide-border max-h-80 overflow-y-auto">
                                        {infobox.map((e, i) => (
                                            <div key={i} className="flex items-start justify-between px-4 py-2.5 gap-4">
                                                <span className="text-xs font-semibold text-foreground shrink-0 max-w-[120px]">{e.label}</span>
                                                <span className="text-xs text-muted-foreground text-right break-words">{e.value}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* References */}
                            {references.length > 0 && (
                                <div>
                                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
                                        References ({references.length})
                                    </label>
                                    <div className="rounded-xl border border-border divide-y divide-border max-h-64 overflow-y-auto">
                                        {references.map((ref, i) => (
                                            <div key={i} className="px-4 py-2.5 flex items-start gap-2">
                                                <span className="text-[10px] text-muted-foreground/50 font-mono shrink-0 mt-0.5 w-5 text-right">{i + 1}.</span>
                                                <div className="min-w-0">
                                                    <p className="text-xs text-muted-foreground leading-relaxed">{ref.text}</p>
                                                    {ref.url && (
                                                        <a
                                                            href={ref.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-[10px] text-blue-400 hover:text-blue-300 underline break-all transition-colors"
                                                        >
                                                            {ref.url}
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {submitError && (
                                <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                                    {submitError}
                                </p>
                            )}

                            {/* Import button */}
                            <div className="flex items-center justify-between pt-2 pb-8">
                                <p className="text-xs text-muted-foreground/50">
                                    Attribution to <strong>{article.sourceLabel}</strong> will be saved with the article.
                                </p>

                                {done ? (
                                    <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                                        <CheckCircle2 size={16} />
                                        Imported! Redirecting…
                                    </div>
                                ) : (
                                    <button
                                        onClick={handleImport}
                                        disabled={submitting}
                                        className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-foreground text-background text-sm font-semibold hover:opacity-80 transition-opacity disabled:opacity-50"
                                    >
                                        {submitting && <Loader2 size={14} className="animate-spin" />}
                                        {submitting ? 'Importing…' : 'Import to Triplepedia'}
                                    </button>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Empty state */}
                {!article && !extracting && !extractError && (
                    <div className="text-center py-16 text-muted-foreground/40">
                        <p className="text-4xl mb-3">📖</p>
                        <p className="text-sm">Paste a Wikipedia link above to get started.</p>
                        <p className="text-xs mt-1">
                            e.g.{' '}
                            <button
                                className="underline hover:text-muted-foreground transition-colors"
                                onClick={() => setUrl('https://en.wikipedia.org/wiki/Artificial_intelligence')}
                            >
                                en.wikipedia.org/wiki/Artificial_intelligence
                            </button>
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
