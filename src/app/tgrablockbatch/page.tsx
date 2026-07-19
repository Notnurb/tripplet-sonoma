'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
    ArrowLeft, Loader2, CheckCircle2, AlertTriangle,
    Zap, ZapOff, ExternalLink, Trash2, Sparkles,
    Rocket, Gauge, Square,
} from 'lucide-react';
import { loadSettings, SETTINGS_EVENT } from '@/lib/settings';
import { useAuth } from '@/context/AuthContext';
import ThemeToggle from '@/components/Layout/ThemeToggle';

// ─── Types ────────────────────────────────────────────────────────────────────

type SlotStatus = 'idle' | 'extracting' | 'importing' | 'done' | 'error';
type FinderSubmitMode = 'burst' | 'throttled';
type TurboSpeed = 'fast' | 'veryfast' | 'ultrafast' | 'ultraplus';

interface Slot {
    id: string;
    url: string;
    status: SlotStatus;
    title: string;
    slug: string;
    error: string;
}

interface TurboStats {
    inserted: number;
    failed: number;
    skipped: number;
    rate: number;
    startTime: number;
    wikiCalls: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SPEED_CONFIG: Record<TurboSpeed, { workers: number; label: string; desc: string; staggerMs: number }> = {
    fast:      { workers: 8,    label: 'Fast',       desc: '~15-25 articles/sec',   staggerMs: 0 },
    veryfast:  { workers: 20,   label: 'Very Fast',  desc: '~40-70 articles/sec',   staggerMs: 0 },
    ultrafast: { workers: 600,  label: 'Ultra Fast',  desc: '~800-1500 articles/sec', staggerMs: 0 },
    ultraplus: { workers: 6500, label: 'Ultra+',      desc: '~5k-12k articles/sec',   staggerMs: 1 },
};

const EXTRACT_BATCH = 20;
const DB_BATCH = 50;
const MIN_EXTRACT = 40;

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _id = 0;
function newSlot(url = ''): Slot {
    return { id: String(_id++), url, status: 'idle', title: '', slug: '', error: '' };
}

function slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80);
}

const WIKI_RANDOM_BATCH = 50;
const MAX_CONCURRENT_IMPORTS = 12;
const MAX_PAUSE_EVERY = 5000;
const MAX_PAUSE_SECONDS = 120;

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

async function fetchRandomWikipediaUrls(count: number): Promise<string[]> {
    const target = Math.max(1, Math.floor(count));
    const batches = Math.ceil(target / WIKI_RANDOM_BATCH);

    const requests = Array.from({ length: batches }, (_, i) => {
        const remaining = target - i * WIKI_RANDOM_BATCH;
        const limit = clamp(remaining, 1, WIKI_RANDOM_BATCH);
        const url = `https://en.wikipedia.org/w/api.php?origin=*&action=query&format=json&list=random&rnnamespace=0&rnlimit=${limit}`;
        return fetch(url)
            .then(async (res) => {
                if (!res.ok) throw new Error('Wikipedia API error.');
                return res.json();
            })
            .then((data) => {
                const titles: string[] = (data?.query?.random ?? []).map((r: { title: string }) => r.title);
                return titles.map((t) => `https://en.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}`);
            });
    });

    const results = await Promise.all(requests);
    const flattened = results.flat();
    return Array.from(new Set(flattened)).slice(0, target);
}

// ─── Turbo Wikipedia API ─────────────────────────────────────────────────────

async function fetchRandomTitles(count: number): Promise<string[]> {
    const limit = Math.min(count, 500);
    const url = `https://en.wikipedia.org/w/api.php?origin=*&action=query&format=json&list=random&rnnamespace=0&rnlimit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Wikipedia random API failed`);
    const data = await res.json();
    return (data?.query?.random ?? []).map((r: { title: string }) => r.title);
}

interface TurboArticle {
    title: string;
    summary: string;
    sections: Array<{ heading: string; content: string }>;
    imageUrl: string | null;
}

async function fetchExtracts(titles: string[]): Promise<TurboArticle[]> {
    const joined = titles.map(t => encodeURIComponent(t)).join('|');
    const url = `https://en.wikipedia.org/w/api.php?origin=*&action=query&format=json&titles=${joined}&prop=extracts|pageimages&exintro=true&explaintext=true&exlimit=${titles.length}&pithumbsize=800&pilimit=${titles.length}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Wikipedia extract API failed`);
    const data = await res.json();
     
    const pages: Record<string, any> = data?.query?.pages ?? {};
    const articles: TurboArticle[] = [];
    for (const p of Object.values(pages)) {
        if (p.missing !== undefined) continue;
        const ext = (p.extract as string)?.trim();
        if (!ext || ext.length < MIN_EXTRACT) continue;
        if (ext.includes('may refer to:') || ext.includes('can refer to:')) continue;
        articles.push({
            title: p.title as string,
            summary: ext.slice(0, 500),
            sections: [{ heading: 'Introduction', content: ext }],
            imageUrl: (p.thumbnail as { source?: string })?.source ?? null,
        });
    }
    return articles;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
}

// ─── Status indicator ─────────────────────────────────────────────────────────

function StatusDot({ status }: { status: SlotStatus }) {
    if (status === 'extracting' || status === 'importing') {
        return <Loader2 size={14} className="animate-spin text-muted-foreground shrink-0" />;
    }
    if (status === 'done') {
        return <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />;
    }
    if (status === 'error') {
        return <AlertTriangle size={14} className="text-destructive shrink-0" />;
    }
    return <span className="w-3.5 h-3.5 rounded-full border border-border/60 bg-muted/40 shrink-0 inline-block" />;
}

function StatusLabel({ status }: { status: SlotStatus }) {
    if (status === 'extracting') return <span className="text-[10px] text-muted-foreground">Extracting...</span>;
    if (status === 'importing') return <span className="text-[10px] text-muted-foreground">Importing...</span>;
    return null;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BatchGrabberPage() {
    const { user } = useAuth();
    const [slots, setSlots] = useState<Slot[]>(() => [newSlot()]);
    const [autoSubmit, setAutoSubmit] = useState(true);
    const [finderCount, setFinderCount] = useState(1000);
    const [finderSubmitMode, setFinderSubmitMode] = useState<FinderSubmitMode>('throttled');
    const [pauseEvery, setPauseEvery] = useState(25);
    const [pauseSeconds, setPauseSeconds] = useState(10);
    const [backgroundEnabled, setBackgroundEnabled] = useState(false);
    const [finderRunning, setFinderRunning] = useState(false);
    const [finderError, setFinderError] = useState('');
    const [queuedCount, setQueuedCount] = useState(0);
    const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
    const focusIdRef = useRef<string | null>(null);
    const queueRef = useRef<Array<{ id: string; url: string }>>([]);
    const activeRef = useRef(0);
    const processedRef = useRef(0);
    const pauseUntilRef = useRef(0);
    const resumeTimerRef = useRef<number | null>(null);

    // ── Turbo mode state ────────────────────────────────────────────────────
    const [turboMode, setTurboMode] = useState(false);
    const [turboSpeed, setTurboSpeed] = useState<TurboSpeed>('fast');
    const [turboTarget, setTurboTarget] = useState(10000);
    const [turboRunning, setTurboRunning] = useState(false);
    const [turboStats, setTurboStats] = useState<TurboStats>({
        inserted: 0, failed: 0, skipped: 0, rate: 0, startTime: 0, wikiCalls: 0,
    });
    const turboAbortRef = useRef<AbortController | null>(null);
    const turboStatsRef = useRef<TurboStats>({ inserted: 0, failed: 0, skipped: 0, rate: 0, startTime: 0, wikiCalls: 0 });

    // After every render, focus the pending slot if its input is in the DOM
    useEffect(() => {
        const id = focusIdRef.current;
        if (!id) return;
        const el = inputRefs.current.get(id);
        if (el) {
            el.focus();
            focusIdRef.current = null;
        }
    });

    useEffect(() => {
        const read = () => setBackgroundEnabled(loadSettings().trainTriplepediaModels);
        read();
        const handler = () => read();
        window.addEventListener(SETTINGS_EVENT, handler);
        return () => window.removeEventListener(SETTINGS_EVENT, handler);
    }, []);

    // ── Process a single slot (normal mode) ─────────────────────────────────
    const processSlot = useCallback(async (slotId: string, url: string) => {
        const trimmed = url.trim();
        if (!trimmed) return;

        setSlots(prev => prev.map(s =>
            s.id === slotId ? { ...s, status: 'extracting', error: '' } : s
        ));

        try {
            const res = await fetch('/api/triplepedia/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: trimmed }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? 'Extraction failed.');

            setSlots(prev => prev.map(s =>
                s.id === slotId ? { ...s, status: 'importing' } : s
            ));

            const slug = slugify(data.title || 'article') + '-' + Date.now().toString(36);

            const finalInfobox = [
                ...(data.imageUrl ? [{ label: '__image__', value: data.imageUrl }] : []),
                ...(data.infobox ?? []),
                { label: 'Source', value: data.sourceUrl },
            ];

            const insertRes = await fetch('/api/triplepedia/articles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: data.title,
                    slug,
                    summary: data.summary,
                    sections: data.sections,
                    infobox: finalInfobox,
                    submitted_by: user?.email ?? null,
                    status: 'published',
                }),
            });

            if (!insertRes.ok) {
                const err = await insertRes.json().catch(() => ({}));
                throw new Error(err.error ?? 'Failed to save article.');
            }

            setSlots(prev => prev.map(s =>
                s.id === slotId ? { ...s, status: 'done', title: data.title, slug } : s
            ));
        } catch (e) {
            setSlots(prev => prev.map(s =>
                s.id === slotId
                    ? { ...s, status: 'error', error: e instanceof Error ? e.message : 'Failed.' }
                    : s
            ));
        }
    }, [user]);

    // ── Queue runner (caps concurrent imports) ────────────────────────────
    const pumpQueue = useCallback(() => {
        const now = Date.now();
        if (pauseUntilRef.current > now) {
            if (resumeTimerRef.current == null) {
                const delay = pauseUntilRef.current - now;
                resumeTimerRef.current = window.setTimeout(() => {
                    resumeTimerRef.current = null;
                    pumpQueue();
                }, delay);
            }
            return;
        }

        while (activeRef.current < MAX_CONCURRENT_IMPORTS && queueRef.current.length > 0) {
            const next = queueRef.current.shift();
            if (!next) break;
            setQueuedCount(queueRef.current.length);
            activeRef.current += 1;
            processedRef.current += 1;

            const shouldPause =
                pauseEvery > 0 &&
                pauseSeconds > 0 &&
                processedRef.current % pauseEvery === 0;
            if (shouldPause) {
                pauseUntilRef.current = Date.now() + pauseSeconds * 1000;
            }

            processSlot(next.id, next.url).finally(() => {
                activeRef.current -= 1;
                setQueuedCount(queueRef.current.length);
                pumpQueue();
            });

            if (pauseUntilRef.current > Date.now()) {
                break;
            }
        }
    }, [processSlot, pauseEvery, pauseSeconds]);

    const enqueueSlots = useCallback((items: Array<{ id: string; url: string }>) => {
        if (items.length === 0) return;
        queueRef.current.push(...items);
        setQueuedCount(queueRef.current.length);
        pumpQueue();
    }, [pumpQueue]);

    // ── Add a new slot below the current one and focus it ───────────────────
    const addNextSlot = useCallback((afterId: string) => {
        const next = newSlot();
        focusIdRef.current = next.id;
        setSlots(prev => {
            const idx = prev.findIndex(s => s.id === afterId);
            const copy = [...prev];
            copy.splice(idx + 1, 0, next);
            return copy;
        });
    }, []);

    // ── Handle Enter key on an input ─────────────────────────────────────────
    const handleKeyDown = useCallback((
        e: React.KeyboardEvent<HTMLInputElement>,
        slot: Slot,
    ) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const url = slot.url.trim();
        if (!url) return;

        addNextSlot(slot.id);

        if (autoSubmit && slot.status === 'idle') {
            enqueueSlots([{ id: slot.id, url }]);
        }
    }, [addNextSlot, autoSubmit, enqueueSlots]);

    // ── URL change ───────────────────────────────────────────────────────────
    const handleChange = useCallback((id: string, value: string) => {
        setSlots(prev => prev.map(s => s.id === id ? { ...s, url: value } : s));
    }, []);

    // ── Submit all idle slots that have URLs ─────────────────────────────────
    const handleSubmitAllByMode = useCallback(() => {
        const toProcess = slots.filter(s => s.status === 'idle' && s.url.trim());
        if (toProcess.length === 0) return;
        if (finderSubmitMode === 'burst') {
            for (const s of toProcess) processSlot(s.id, s.url);
        } else {
            enqueueSlots(toProcess.map(s => ({ id: s.id, url: s.url })));
        }
    }, [slots, finderSubmitMode, processSlot, enqueueSlots]);

    // ── Toggle auto-submit ───────────────────────────────────────────────────
    const toggleAutoSubmit = useCallback(() => {
        const next = !autoSubmit;
        setAutoSubmit(next);
        if (next) {
            const toProcess = slots.filter(s => s.status === 'idle' && s.url.trim());
            enqueueSlots(toProcess.map(s => ({ id: s.id, url: s.url })));
        }
    }, [autoSubmit, slots, enqueueSlots]);

    // ── Clear completed / failed slots ───────────────────────────────────────
    const clearFinished = useCallback(() => {
        setSlots(prev => {
            const remaining = prev.filter(s => s.status !== 'done' && s.status !== 'error');
            return remaining.length === 0 ? [newSlot()] : remaining;
        });
    }, []);

    // ── Remove a single slot ─────────────────────────────────────────────────
    const removeSlot = useCallback((id: string) => {
        setSlots(prev => {
            if (prev.length === 1) return [newSlot()];
            return prev.filter(s => s.id !== id);
        });
    }, []);

    const addUrlsToSlots = useCallback((urls: string[], mode: FinderSubmitMode) => {
        if (urls.length === 0) return;
        const queued: Array<{ id: string; url: string }> = [];

        setSlots(prev => {
            const existing = new Set(prev.map(s => s.url.trim()).filter(Boolean));
            const uniqueUrls = urls.filter(u => u.trim() && !existing.has(u));
            if (uniqueUrls.length === 0) return prev;

            const next = [...prev];
            const remaining = [...uniqueUrls];

            for (let i = 0; i < next.length && remaining.length > 0; i += 1) {
                const slot = next[i];
                if (slot.status === 'idle' && !slot.url.trim()) {
                    const url = remaining.shift()!;
                    queued.push({ id: slot.id, url });
                    next[i] = { ...slot, url };
                }
            }

            while (remaining.length > 0) {
                const url = remaining.shift()!;
                const slot = newSlot(url);
                queued.push({ id: slot.id, url });
                next.push(slot);
            }

            return next;
        });

        if (queued.length === 0) return;
        if (mode === 'burst') {
            for (const item of queued) processSlot(item.id, item.url);
        } else {
            enqueueSlots(queued);
        }
    }, [enqueueSlots, processSlot]);

    const handleFindLinks = useCallback(async () => {
        setFinderError('');
        setFinderRunning(true);
        try {
            const urls = await fetchRandomWikipediaUrls(finderCount);
            if (urls.length === 0) {
                throw new Error('No Wikipedia links returned.');
            }
            addUrlsToSlots(urls, finderSubmitMode);
        } catch (e) {
            setFinderError(e instanceof Error ? e.message : 'Failed to fetch links.');
        } finally {
            setFinderRunning(false);
        }
    }, [finderCount, finderSubmitMode, addUrlsToSlots]);

    // ── Background auto-run when enabled ───────────────────────────────────
    useEffect(() => {
        if (!backgroundEnabled) return;

        setAutoSubmit(true);
        setFinderSubmitMode('throttled');
        setFinderCount(1000);
        setPauseEvery(25);
        setPauseSeconds(10);
    }, [backgroundEnabled]);

    // ═══════════════════════════════════════════════════════════════════════════
    // ── TURBO MODE ──────────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

    const handleTurboStart = useCallback(async () => {
        const abort = new AbortController();
        turboAbortRef.current = abort;
        setTurboRunning(true);

        const stats: TurboStats = {
            inserted: 0, failed: 0, skipped: 0, rate: 0, startTime: Date.now(), wikiCalls: 0,
        };
        turboStatsRef.current = stats;
        setTurboStats({ ...stats });

        const config = SPEED_CONFIG[turboSpeed];

        // Stats updater
        const statsInterval = setInterval(() => {
            const s = turboStatsRef.current;
            const elapsed = (Date.now() - s.startTime) / 1000;
            s.rate = elapsed > 0 ? s.inserted / elapsed : 0;
            setTurboStats({ ...s });
        }, 500);

        // Worker function
        async function turboWorker() {
            // Small random jitter so workers don't all fire at the exact same instant
            await new Promise(r => setTimeout(r, Math.random() * 200));

            while (!abort.signal.aborted && turboStatsRef.current.inserted < turboTarget) {
                try {
                    // 1. Get random titles
                    turboStatsRef.current.wikiCalls++;
                    const titles = await fetchRandomTitles(500);
                    if (titles.length === 0 || abort.signal.aborted) continue;

                    // 2. Chunk and fetch extracts
                    const chunks = chunkArray(titles, EXTRACT_BATCH);
                    for (const ch of chunks) {
                        if (abort.signal.aborted || turboStatsRef.current.inserted >= turboTarget) break;

                        try {
                            turboStatsRef.current.wikiCalls++;
                            const articles = await fetchExtracts(ch);
                            turboStatsRef.current.skipped += ch.length - articles.length;

                            if (articles.length === 0) continue;

                            // 3. Batch insert
                            const rows = articles.map(a => ({
                                title: a.title,
                                slug: `${slugify(a.title)}-${crypto.randomUUID().slice(0, 8)}`,
                                summary: a.summary,
                                sections: a.sections,
                                infobox: [
                                    ...(a.imageUrl ? [{ label: '__image__', value: a.imageUrl }] : []),
                                    { label: 'Source', value: `https://en.wikipedia.org/wiki/${encodeURIComponent(a.title.replace(/ /g, '_'))}` },
                                ],
                                submitted_by: user?.email ?? 'turbo-browser',
                                fact_checked_at: new Date().toISOString(),
                                status: 'published',
                            }));

                            for (const dbChunk of chunkArray(rows, DB_BATCH)) {
                                if (abort.signal.aborted) break;
                                try {
                                    const res = await fetch('/api/triplepedia/articles', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ articles: dbChunk }),
                                        signal: abort.signal,
                                    });
                                    if (!res.ok) {
                                        turboStatsRef.current.failed += dbChunk.length;
                                    } else {
                                        const out = await res.json().catch(() => ({}));
                                        const inserted = typeof out.inserted === 'number' ? out.inserted : dbChunk.length;
                                        turboStatsRef.current.inserted += inserted;
                                        turboStatsRef.current.failed += dbChunk.length - inserted;
                                    }
                                } catch {
                                    turboStatsRef.current.failed += dbChunk.length;
                                }
                            }
                        } catch {
                            turboStatsRef.current.failed += ch.length;
                        }
                    }
                } catch {
                    // Title fetch failed, brief backoff
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        }

        // Launch all workers — stagger for ultra tiers to avoid thundering herd
        const workerPromises: Promise<void>[] = [];
        for (let i = 0; i < config.workers; i++) {
            if (abort.signal.aborted) break;
            workerPromises.push(turboWorker());
            // Stagger ultra tiers: yield every 200 workers to let the event loop breathe
            if (config.staggerMs > 0 && i % 200 === 199) {
                await new Promise(r => setTimeout(r, config.staggerMs));
            }
        }
        await Promise.all(workerPromises);

        clearInterval(statsInterval);
        // Final stats update
        const elapsed = (Date.now() - stats.startTime) / 1000;
        turboStatsRef.current.rate = elapsed > 0 ? turboStatsRef.current.inserted / elapsed : 0;
        setTurboStats({ ...turboStatsRef.current });
        setTurboRunning(false);
        turboAbortRef.current = null;
    }, [turboSpeed, turboTarget, user]);

    const handleTurboStop = useCallback(() => {
        turboAbortRef.current?.abort();
    }, []);

    // ── Stats ────────────────────────────────────────────────────────────────
    const done = slots.filter(s => s.status === 'done').length;
    const failed = slots.filter(s => s.status === 'error').length;
    const busy = slots.filter(s => s.status === 'extracting' || s.status === 'importing').length;
    const idleWithUrl = slots.filter(s => s.status === 'idle' && s.url.trim()).length;
    const etaSeconds =
        finderSubmitMode === 'throttled'
            ? Math.ceil(queuedCount / Math.max(1, MAX_CONCURRENT_IMPORTS))
            : 0;
    const etaLabel = etaSeconds > 0
        ? `${Math.floor(etaSeconds / 60)}:${String(etaSeconds % 60).padStart(2, '0')}`
        : null;

    // Turbo ETA
    const turboRemaining = turboTarget - turboStats.inserted - turboStats.failed;
    const turboEta = turboStats.rate > 0 ? Math.ceil(turboRemaining / turboStats.rate) : 0;
    const turboEtaStr = turboEta > 0
        ? `${Math.floor(turboEta / 60)}m ${turboEta % 60}s`
        : null;
    const turboTotal = turboStats.inserted + turboStats.failed;
    const turboAccuracy = turboTotal > 0 ? (turboStats.inserted / turboTotal) * 100 : 0;

    // Normal mode accuracy
    const normalTotal = done + failed;
    const normalAccuracy = normalTotal > 0 ? (done / normalTotal) * 100 : 0;

    useEffect(() => {
        if (!backgroundEnabled) return;
        if (finderRunning) return;
        if (queuedCount > 0 || busy > 0) return;

        const idleFilled = slots.filter(s => s.status === 'idle' && s.url.trim());
        if (idleFilled.length > 0) {
            enqueueSlots(idleFilled.map(s => ({ id: s.id, url: s.url })));
            return;
        }

        const t = window.setTimeout(() => {
            handleFindLinks();
        }, 1200);

        return () => window.clearTimeout(t);
    }, [backgroundEnabled, finderRunning, queuedCount, busy, slots, enqueueSlots, handleFindLinks]);

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col">
            {/* ── Top bar ────────────────────────────────────────────────── */}
            <div className="sticky top-0 z-40 flex items-center gap-3 px-6 py-3 border-b border-border bg-background/95 backdrop-blur-sm">
                <Link
                    href="/triplepedia"
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                    <ArrowLeft size={14} />
                    Triplepedia
                </Link>
                <span className="text-border/60">·</span>
                <span className="text-sm font-semibold text-foreground">Batch Grabber</span>
                <span className="text-[9px] font-bold uppercase tracking-wider bg-violet-500/15 text-violet-400 border border-violet-500/20 px-1.5 py-0.5 rounded-full">
                    Beta
                </span>

                <div className="ml-auto flex items-center gap-3">
                    {/* Turbo toggle */}
                    <button
                        onClick={() => setTurboMode(!turboMode)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${
                            turboMode
                                ? 'bg-orange-500/15 border-orange-500/30 text-orange-400'
                                : 'bg-muted/30 border-border text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        <Rocket size={12} />
                        Turbo {turboMode ? 'on' : 'off'}
                    </button>

                    {/* Auto-submit toggle (normal mode only) */}
                    {!turboMode && (
                        <button
                            onClick={toggleAutoSubmit}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${
                                autoSubmit
                                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                                    : 'bg-muted/30 border-border text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            {autoSubmit ? <Zap size={12} /> : <ZapOff size={12} />}
                            Auto-submit {autoSubmit ? 'on' : 'off'}
                        </button>
                    )}

                    <ThemeToggle />
                </div>
            </div>

            {/* ── Main content ───────────────────────────────────────────── */}
            <div className="flex-1 max-w-2xl w-full mx-auto px-6 py-8">

                {turboMode ? (
                    /* ═══ TURBO MODE PANEL ═══════════════════════════════════ */
                    <div>
                        <div className="mb-6">
                            <h1 className="font-serif text-2xl font-bold text-foreground mb-1 flex items-center gap-3">
                                <Rocket size={24} className="text-orange-400" />
                                Turbo Import
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                Bulk-imports random Wikipedia articles using the Action API for maximum speed. Articles are fetched 20 at a time and batch-inserted directly into Triplepedia.
                            </p>
                        </div>

                        {/* Speed selector */}
                        <div className="mb-6 space-y-4">
                            <div className="flex items-center gap-3">
                                <Gauge size={14} className="text-muted-foreground/60" />
                                <span className="text-sm text-muted-foreground font-medium">Speed</span>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                {(Object.entries(SPEED_CONFIG) as [TurboSpeed, typeof SPEED_CONFIG[TurboSpeed]][]).map(([key, cfg]) => {
                                    const colorMap: Record<TurboSpeed, { border: string; bg: string; text: string }> = {
                                        fast: { border: 'border-emerald-500/40', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
                                        veryfast: { border: 'border-orange-500/40', bg: 'bg-orange-500/10', text: 'text-orange-400' },
                                        ultrafast: { border: 'border-red-500/40', bg: 'bg-red-500/10', text: 'text-red-400' },
                                        ultraplus: { border: 'border-fuchsia-500/40', bg: 'bg-fuchsia-500/10', text: 'text-fuchsia-400' },
                                    };
                                    const colors = colorMap[key];
                                    const isSelected = turboSpeed === key;
                                    return (
                                        <button
                                            key={key}
                                            onClick={() => {
                                                setTurboSpeed(key);
                                                if (key === 'ultraplus') setTurboTarget(t => Math.min(t, 500000));
                                            }}
                                            disabled={turboRunning}
                                            className={`flex flex-col items-start gap-1 p-4 rounded-xl border transition-all ${
                                                isSelected
                                                    ? `${colors.border} ${colors.bg}`
                                                    : 'border-border bg-muted/10 hover:bg-muted/20'
                                            } disabled:opacity-50`}
                                        >
                                            <span className={`text-sm font-bold ${
                                                isSelected ? colors.text : 'text-foreground'
                                            }`}>
                                                {cfg.label}
                                            </span>
                                            <span className="text-[11px] text-muted-foreground">
                                                {cfg.workers.toLocaleString()} workers · {cfg.desc}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Ultra+ warning */}
                        {turboSpeed === 'ultraplus' && !turboRunning && (
                            <div className="mb-4 flex items-start gap-3 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/5 px-4 py-3">
                                <AlertTriangle size={16} className="text-fuchsia-400 shrink-0 mt-0.5" />
                                <div className="text-[12px] text-fuchsia-300/80 leading-relaxed">
                                    <span className="font-bold text-fuchsia-300">Ultra+</span> launches 6,500 real async workers.
                                    Workers are staggered on launch to prevent browser freeze. Max target capped at 500k. Your browser will work hard.
                                </div>
                            </div>
                        )}

                        {/* Target count */}
                        <div className="mb-6 flex items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
                            <span className="text-sm text-muted-foreground">Target articles:</span>
                            <input
                                type="number"
                                min={100}
                                max={turboSpeed === 'ultraplus' ? 500000 : 1000000}
                                value={turboTarget}
                                onChange={(e) => {
                                    const max = turboSpeed === 'ultraplus' ? 500000 : 1000000;
                                    setTurboTarget(clamp(Number(e.target.value), 100, max));
                                }}
                                disabled={turboRunning}
                                className="w-32 bg-transparent text-sm text-foreground font-mono outline-none border border-border/60 rounded-md px-3 py-1.5 disabled:opacity-50"
                            />
                            <span className="text-[11px] text-muted-foreground/60">
                                articles to import {turboSpeed === 'ultraplus' && '(max 500k)'}
                            </span>
                        </div>

                        {/* Start / Stop button */}
                        <div className="mb-6">
                            {turboRunning ? (
                                <button
                                    onClick={handleTurboStop}
                                    className="flex items-center gap-2 px-6 py-3 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:opacity-80 transition-opacity"
                                >
                                    <Square size={14} />
                                    Stop Turbo Import
                                </button>
                            ) : (
                                <button
                                    onClick={handleTurboStart}
                                    className="flex items-center gap-2 px-6 py-3 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:opacity-80 transition-opacity"
                                >
                                    <Rocket size={14} />
                                    Start Turbo Import ({turboTarget.toLocaleString()} articles)
                                </button>
                            )}
                        </div>

                        {/* Live stats */}
                        {(turboRunning || turboStats.inserted > 0) && (
                            <div className="rounded-xl border border-border bg-muted/10 p-5 space-y-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-semibold text-foreground">
                                        {turboRunning ? 'Importing...' : 'Import Complete'}
                                    </span>
                                    {turboRunning && (
                                        <Loader2 size={14} className="animate-spin text-orange-400" />
                                    )}
                                </div>

                                {/* Progress bar */}
                                <div className="w-full h-2 rounded-full bg-muted/30 overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-gradient-to-r from-orange-500 to-emerald-500 transition-all duration-500"
                                        style={{ width: `${Math.min(100, (turboStats.inserted / turboTarget) * 100)}%` }}
                                    />
                                </div>

                                {/* Stats grid */}
                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Inserted</p>
                                        <p className="text-lg font-mono font-bold text-emerald-400 tabular-nums">
                                            {turboStats.inserted.toLocaleString()}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Accuracy</p>
                                        <p className={`text-lg font-mono font-bold tabular-nums ${
                                            turboTotal === 0 ? 'text-muted-foreground/40'
                                                : turboAccuracy >= 90 ? 'text-emerald-400'
                                                : turboAccuracy >= 70 ? 'text-yellow-400'
                                                : 'text-destructive'
                                        }`}>
                                            {turboTotal === 0 ? '—' : `${turboAccuracy.toFixed(1)}%`}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Rate</p>
                                        <p className="text-lg font-mono font-bold text-foreground tabular-nums">
                                            {turboStats.rate.toFixed(1)}/s
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Failed</p>
                                        <p className="text-lg font-mono font-bold text-destructive tabular-nums">
                                            {turboStats.failed.toLocaleString()}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">ETA</p>
                                        <p className="text-lg font-mono font-bold text-foreground tabular-nums">
                                            {turboEtaStr ?? '...'}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4 text-[10px] text-muted-foreground/50">
                                    <span>Skipped: {turboStats.skipped.toLocaleString()}</span>
                                    <span>Wiki API calls: {turboStats.wikiCalls.toLocaleString()}</span>
                                    <span>Target: {turboTarget.toLocaleString()}</span>
                                </div>
                            </div>
                        )}

                        <p className="mt-8 text-xs text-muted-foreground/40 text-center">
                            Turbo mode fetches random <strong className="text-muted-foreground/60">Wikipedia</strong> articles via the Action API. CC BY-SA 4.0. Attribution is saved automatically.
                        </p>
                    </div>
                ) : (
                    /* ═══ NORMAL MODE ════════════════════════════════════════ */
                    <>
                        {/* Hero */}
                        <div className="mb-6">
                            <h1 className="font-serif text-2xl font-bold text-foreground mb-1">
                                Batch import articles
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                Paste a URL and press <kbd className="font-mono bg-muted/50 border border-border rounded px-1 py-0.5 text-[10px]">Enter</kbd> — a new row appears instantly. Repeat for as many articles as you want.{' '}
                                {autoSubmit
                                    ? <span className="text-emerald-400">Auto-submit is on: each URL imports automatically.</span>
                                    : <span>Toggle auto-submit or use &ldquo;Submit all&rdquo; below.</span>
                                }
                            </p>
                            <div className="mt-4 flex flex-wrap items-center gap-3">
                                <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2">
                                    <Sparkles size={12} className="text-muted-foreground/60" />
                                    <span className="text-[11px] text-muted-foreground">Auto link finder</span>
                                    <input
                                        type="number"
                                        min={1}
                                        value={finderCount}
                                        onChange={(e) => setFinderCount(Math.max(1, Number(e.target.value)))}
                                        className="w-20 bg-transparent text-xs text-foreground outline-none border border-border/60 rounded-md px-2 py-1"
                                    />
                                    <span className="text-[10px] text-muted-foreground/60">random Wikipedia articles</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2">
                                    <span className="text-[11px] text-muted-foreground">Pause every</span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={MAX_PAUSE_EVERY}
                                        value={pauseEvery}
                                        onChange={(e) => setPauseEvery(clamp(Number(e.target.value), 0, MAX_PAUSE_EVERY))}
                                        className="w-16 bg-transparent text-xs text-foreground outline-none border border-border/60 rounded-md px-2 py-1"
                                    />
                                    <span className="text-[10px] text-muted-foreground/60">links for</span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={MAX_PAUSE_SECONDS}
                                        value={pauseSeconds}
                                        onChange={(e) => setPauseSeconds(clamp(Number(e.target.value), 0, MAX_PAUSE_SECONDS))}
                                        className="w-16 bg-transparent text-xs text-foreground outline-none border border-border/60 rounded-md px-2 py-1"
                                    />
                                    <span className="text-[10px] text-muted-foreground/60">seconds</span>
                                </div>
                                <div className="flex items-center rounded-xl border border-border bg-muted/20 p-1">
                                    <button
                                        onClick={() => setFinderSubmitMode('burst')}
                                        className={`px-3 py-1 text-[10px] font-semibold rounded-lg transition-colors ${
                                            finderSubmitMode === 'burst'
                                                ? 'bg-foreground text-background'
                                                : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        All at once
                                    </button>
                                    <button
                                        onClick={() => setFinderSubmitMode('throttled')}
                                        className={`px-3 py-1 text-[10px] font-semibold rounded-lg transition-colors ${
                                            finderSubmitMode === 'throttled'
                                                ? 'bg-foreground text-background'
                                                : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        In order
                                    </button>
                                </div>
                                <button
                                    onClick={handleFindLinks}
                                    disabled={finderRunning}
                                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-foreground text-background text-xs font-semibold hover:opacity-80 transition-opacity disabled:opacity-50"
                                >
                                    {finderRunning && <Loader2 size={12} className="animate-spin" />}
                                    Find links
                                </button>
                            </div>
                            {finderError && (
                                <p className="mt-2 text-[11px] text-destructive">{finderError}</p>
                            )}
                        </div>

                        {/* Slot list */}
                        <div className="space-y-2 mb-6">
                            {slots.map((slot, idx) => {
                                const isActive = slot.status === 'idle';
                                const isWorking = slot.status === 'extracting' || slot.status === 'importing';
                                return (
                                    <div
                                        key={slot.id}
                                        className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                                            slot.status === 'done'
                                                ? 'border-emerald-500/20 bg-emerald-500/5'
                                                : slot.status === 'error'
                                                ? 'border-destructive/20 bg-destructive/5'
                                                : 'border-border bg-muted/10 focus-within:border-foreground/25'
                                        }`}
                                    >
                                        <span className="text-[10px] text-muted-foreground/40 font-mono w-5 text-right shrink-0 select-none">
                                            {idx + 1}
                                        </span>
                                        <StatusDot status={slot.status} />
                                        <div className="flex-1 min-w-0">
                                            {slot.status === 'done' ? (
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm text-foreground font-medium truncate">
                                                        {slot.title}
                                                    </span>
                                                    <a
                                                        href={`/triplepedia/${slot.slug}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="shrink-0 text-muted-foreground/40 hover:text-emerald-400 transition-colors"
                                                    >
                                                        <ExternalLink size={11} />
                                                    </a>
                                                </div>
                                            ) : (
                                                <div>
                                                    <input
                                                        ref={el => {
                                                            if (el) inputRefs.current.set(slot.id, el);
                                                            else inputRefs.current.delete(slot.id);
                                                        }}
                                                        value={slot.url}
                                                        onChange={e => handleChange(slot.id, e.target.value)}
                                                        onKeyDown={e => handleKeyDown(e, slot)}
                                                        readOnly={!isActive}
                                                        placeholder={
                                                            idx === 0
                                                                ? 'https://en.wikipedia.org/wiki/...'
                                                                : 'Paste next URL...'
                                                        }
                                                        className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/35 outline-none"
                                                    />
                                                    {slot.error && (
                                                        <p className="text-[10px] text-destructive mt-0.5">{slot.error}</p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <StatusLabel status={slot.status} />
                                        {!autoSubmit && isActive && slot.url.trim() && (
                                            <button
                                                onClick={() => {
                                                    addNextSlot(slot.id);
                                                    enqueueSlots([{ id: slot.id, url: slot.url }]);
                                                }}
                                                className="shrink-0 text-[10px] font-semibold text-muted-foreground hover:text-foreground border border-border rounded-lg px-2 py-1 transition-colors"
                                            >
                                                Import
                                            </button>
                                        )}
                                        {!isWorking && (
                                            <button
                                                onClick={() => removeSlot(slot.id)}
                                                className="shrink-0 text-muted-foreground/30 hover:text-muted-foreground transition-colors"
                                                aria-label="Remove"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Action bar */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                {busy > 0 && (
                                    <span className="flex items-center gap-1">
                                        <Loader2 size={11} className="animate-spin" />
                                        {busy} processing
                                    </span>
                                )}
                                {queuedCount > 0 && (
                                    <span className="text-muted-foreground/70">{queuedCount} queued</span>
                                )}
                                {done > 0 && (
                                    <span className="text-emerald-400 font-medium">{done} imported</span>
                                )}
                                {failed > 0 && (
                                    <span className="text-destructive font-medium">{failed} failed</span>
                                )}
                                {normalTotal > 0 && (
                                    <span className={`font-medium ${
                                        normalAccuracy >= 90 ? 'text-emerald-400'
                                            : normalAccuracy >= 70 ? 'text-yellow-400'
                                            : 'text-destructive'
                                    }`}>
                                        {normalAccuracy.toFixed(0)}% accuracy
                                    </span>
                                )}
                                {etaLabel && (
                                    <span className="text-muted-foreground/70">ETA {etaLabel}</span>
                                )}
                                {done === 0 && failed === 0 && busy === 0 && (
                                    <span>Paste URLs and press Enter</span>
                                )}
                                {backgroundEnabled && (
                                    <span className="text-muted-foreground/60">Background training on</span>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                {(done > 0 || failed > 0) && (
                                    <button
                                        onClick={clearFinished}
                                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        Clear finished
                                    </button>
                                )}
                                {idleWithUrl > 0 && (
                                    <button
                                        onClick={handleSubmitAllByMode}
                                        className="flex items-center gap-2 px-5 py-2 rounded-xl bg-foreground text-background text-sm font-semibold hover:opacity-80 transition-opacity"
                                    >
                                        Submit all ({idleWithUrl})
                                    </button>
                                )}
                            </div>
                        </div>

                        <p className="mt-8 text-xs text-muted-foreground/40 text-center">
                            Works best with <strong className="text-muted-foreground/60">Wikipedia</strong> links (CC BY-SA 4.0). Attribution is saved automatically.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
