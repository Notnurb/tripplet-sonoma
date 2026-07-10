'use client';

import { useState, useEffect, useCallback } from 'react';
import { getStreakTitle, getNextMilestone } from '@/lib/triplepedia/constants';

const STORAGE_KEY = 'triplepedia_streak';
const EVENT_NAME = 'triplepedia_streak_changed';

interface StreakData {
    currentStreak: number;
    lastReadDate: string; // YYYY-MM-DD
    totalArticlesRead: number;
    completedArticles: string[]; // article IDs scrolled past 90%
}

const DEFAULT_STREAK: StreakData = {
    currentStreak: 0,
    lastReadDate: '',
    totalArticlesRead: 0,
    completedArticles: [],
};

function todayStr(): string {
    return new Date().toISOString().slice(0, 10);
}

function load(): StreakData {
    if (typeof window === 'undefined') return DEFAULT_STREAK;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { ...DEFAULT_STREAK, ...JSON.parse(raw) } : DEFAULT_STREAK;
    } catch {
        return DEFAULT_STREAK;
    }
}

function save(data: StreakData) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        window.dispatchEvent(new Event(EVENT_NAME));
    } catch { /* ignore */ }
}

/** Check if the streak is still alive (last read was today or yesterday). */
function resolveStreak(data: StreakData): StreakData {
    if (!data.lastReadDate) return data;
    const today = todayStr();
    if (data.lastReadDate === today) return data;

    const last = new Date(data.lastReadDate + 'T00:00:00');
    const now = new Date(today + 'T00:00:00');
    const diffDays = Math.floor((now.getTime() - last.getTime()) / 86_400_000);

    if (diffDays > 1) {
        // Streak broken
        return { ...data, currentStreak: 0 };
    }
    return data;
}

export function useTriplepediaStreak() {
    const [streak, setStreak] = useState<StreakData>(() => resolveStreak(load()));

    useEffect(() => {
        const handler = () => setStreak(resolveStreak(load()));
        window.addEventListener(EVENT_NAME, handler);
        window.addEventListener('storage', handler);
        return () => {
            window.removeEventListener(EVENT_NAME, handler);
            window.removeEventListener('storage', handler);
        };
    }, []);

    const markArticleRead = useCallback((articleId: string) => {
        setStreak((prev) => {
            const today = todayStr();
            const alreadyCompleted = prev.completedArticles.includes(articleId);

            let newStreak = prev.currentStreak;
            if (prev.lastReadDate !== today) {
                // New day: bump streak
                newStreak = prev.currentStreak + 1;
            }

            const next: StreakData = {
                currentStreak: newStreak,
                lastReadDate: today,
                totalArticlesRead: prev.totalArticlesRead + (alreadyCompleted ? 0 : 1),
                completedArticles: alreadyCompleted
                    ? prev.completedArticles
                    : [...prev.completedArticles, articleId],
            };
            save(next);
            return next;
        });
    }, []);

    const isArticleCompleted = useCallback(
        (articleId: string) => streak.completedArticles.includes(articleId),
        [streak.completedArticles],
    );

    return {
        currentStreak: streak.currentStreak,
        totalArticlesRead: streak.totalArticlesRead,
        title: getStreakTitle(streak.currentStreak),
        nextMilestone: getNextMilestone(streak.currentStreak),
        markArticleRead,
        isArticleCompleted,
    };
}
