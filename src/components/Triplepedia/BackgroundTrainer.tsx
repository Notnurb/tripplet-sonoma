'use client';

import { useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { loadSettings, SETTINGS_EVENT } from '@/lib/settings';

const RANDOM_BATCH = 50;
const TRAIN_BATCH_SIZE = 1000;
const MAX_CONCURRENT = 8;
const PAUSE_EVERY = 25;
const PAUSE_SECONDS = 10;
const REFILL_DELAY_MS = 1500;

function slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

async function fetchRandomWikipediaUrls(count: number): Promise<string[]> {
    const target = Math.max(1, Math.floor(count));
    const batches = Math.ceil(target / RANDOM_BATCH);

    const requests = Array.from({ length: batches }, (_, i) => {
        const remaining = target - i * RANDOM_BATCH;
        const limit = Math.max(1, Math.min(remaining, RANDOM_BATCH));
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

export function TriplepediaBackgroundTrainer() {
    const { user } = useAuth();
    const pathname = usePathname();
    const enabledRef = useRef(false);
    const runningRef = useRef(false);
    const queueRef = useRef<string[]>([]);
    const activeRef = useRef(0);
    const processedRef = useRef(0);
    const pauseUntilRef = useRef(0);
    const resumeTimerRef = useRef<number | null>(null);
    const refillTimerRef = useRef<number | null>(null);
    const pumpQueueRef = useRef<() => void>(() => {});
    const refillRef = useRef<() => void>(() => {});

    const shouldRun = useCallback(() => {
        return enabledRef.current && Boolean(user) && pathname !== '/tgrablockbatch';
    }, [user, pathname]);

    const processUrl = useCallback(async (url: string) => {
        try {
            const res = await fetch('/api/triplepedia/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });
            if (!res.ok) return;
            const data = await res.json();

            const slug = slugify(data.title || 'article') + '-' + Date.now().toString(36);

            const finalInfobox = [
                ...(data.imageUrl ? [{ label: '__image__', value: data.imageUrl }] : []),
                ...(data.infobox ?? []),
                { label: 'Source', value: data.sourceUrl },
            ];

            await fetch('/api/triplepedia/articles', {
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
        } catch {
            // Background trainer is best-effort; ignore failures.
        }
    }, [user]);

    const scheduleResume = useCallback((delayMs: number) => {
        if (resumeTimerRef.current != null) return;
        resumeTimerRef.current = window.setTimeout(() => {
            resumeTimerRef.current = null;
            pumpQueueRef.current();
        }, delayMs);
    }, []);

    const scheduleRefill = useCallback(() => {
        if (refillTimerRef.current != null) return;
        refillTimerRef.current = window.setTimeout(() => {
            refillTimerRef.current = null;
            refillRef.current();
        }, REFILL_DELAY_MS);
    }, []);

    const pumpQueue = useCallback(() => {
        if (!shouldRun()) return;

        const now = Date.now();
        if (pauseUntilRef.current > now) {
            scheduleResume(pauseUntilRef.current - now);
            return;
        }

        while (activeRef.current < MAX_CONCURRENT && queueRef.current.length > 0) {
            const next = queueRef.current.shift();
            if (!next) break;
            activeRef.current += 1;
            processedRef.current += 1;

            const shouldPause =
                PAUSE_EVERY > 0 &&
                PAUSE_SECONDS > 0 &&
                processedRef.current % PAUSE_EVERY === 0;
            if (shouldPause) {
                pauseUntilRef.current = Date.now() + PAUSE_SECONDS * 1000;
            }

            processUrl(next).finally(() => {
                activeRef.current -= 1;
                pumpQueue();
            });

            if (pauseUntilRef.current > Date.now()) {
                scheduleResume(pauseUntilRef.current - Date.now());
                break;
            }
        }

        if (queueRef.current.length === 0 && activeRef.current === 0) {
            scheduleRefill();
        }
    }, [processUrl, scheduleResume, scheduleRefill, shouldRun]);

    const refill = useCallback(async () => {
        if (!shouldRun()) return;
        if (runningRef.current) return;
        runningRef.current = true;
        try {
            const urls = await fetchRandomWikipediaUrls(TRAIN_BATCH_SIZE);
            if (urls.length > 0) {
                queueRef.current.push(...urls);
                pumpQueue();
            } else {
                scheduleRefill();
            }
        } catch {
            scheduleRefill();
        } finally {
            runningRef.current = false;
        }
    }, [pumpQueue, scheduleRefill, shouldRun]);

    pumpQueueRef.current = pumpQueue;
    refillRef.current = refill;

    useEffect(() => {
        const read = () => {
            enabledRef.current = loadSettings().trainTriplepediaModels;
            if (enabledRef.current) pumpQueue();
        };
        read();
        const handler = () => read();
        window.addEventListener(SETTINGS_EVENT, handler);
        return () => window.removeEventListener(SETTINGS_EVENT, handler);
    }, [pumpQueue]);

    useEffect(() => {
        if (!shouldRun()) return;
        pumpQueue();
    }, [shouldRun, pumpQueue]);

    return null;
}
