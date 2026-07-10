'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'triplepedia_bookmarks';
const EVENT_NAME = 'triplepedia_bookmarks_changed';

function load(): string[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function save(ids: string[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
        window.dispatchEvent(new Event(EVENT_NAME));
    } catch { /* ignore */ }
}

export function useTriplepediaBookmarks() {
    const [bookmarks, setBookmarks] = useState<string[]>(load);

    // Sync across components / tabs
    useEffect(() => {
        const handler = () => setBookmarks(load());
        window.addEventListener(EVENT_NAME, handler);
        window.addEventListener('storage', handler);
        return () => {
            window.removeEventListener(EVENT_NAME, handler);
            window.removeEventListener('storage', handler);
        };
    }, []);

    const isBookmarked = useCallback(
        (id: string) => bookmarks.includes(id),
        [bookmarks],
    );

    const toggle = useCallback((id: string) => {
        setBookmarks((prev) => {
            const next = prev.includes(id)
                ? prev.filter((b) => b !== id)
                : [...prev, id];
            save(next);
            return next;
        });
    }, []);

    return { bookmarks, isBookmarked, toggle };
}
