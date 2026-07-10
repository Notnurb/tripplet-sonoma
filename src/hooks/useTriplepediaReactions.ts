'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ReactionType } from '@/lib/triplepedia/constants';

interface ReactionCount {
    reaction_type: ReactionType;
    count: number;
}

function getUserReactedKey(articleId: string) {
    return `triplepedia_reacted_${articleId}`;
}

function loadUserReacted(articleId: string): Set<string> {
    if (typeof window === 'undefined') return new Set();
    try {
        const raw = localStorage.getItem(getUserReactedKey(articleId));
        return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
        return new Set();
    }
}

function saveUserReacted(articleId: string, reacted: Set<string>) {
    try {
        localStorage.setItem(getUserReactedKey(articleId), JSON.stringify([...reacted]));
    } catch { /* ignore */ }
}

export function useTriplepediaReactions(articleId: string | undefined) {
    const [reactions, setReactions] = useState<ReactionCount[]>([]);
    const [userReacted, setUserReacted] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);

    // Fetch reactions from the API
    useEffect(() => {
        if (!articleId) return;
        setUserReacted(loadUserReacted(articleId));

        let cancelled = false;
        fetch(`/api/triplepedia/reactions?articleId=${encodeURIComponent(articleId)}`)
            .then((res) => (res.ok ? res.json() : { reactions: [] }))
            .then((data) => {
                if (cancelled) return;
                setReactions((data.reactions as ReactionCount[]) ?? []);
                setLoading(false);
            })
            .catch(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [articleId]);

    const react = useCallback(async (reactionType: ReactionType) => {
        if (!articleId) return;
        if (userReacted.has(reactionType)) return;

        // Optimistic update
        setReactions((prev) => {
            const existing = prev.find((r) => r.reaction_type === reactionType);
            if (existing) {
                return prev.map((r) =>
                    r.reaction_type === reactionType ? { ...r, count: r.count + 1 } : r,
                );
            }
            return [...prev, { reaction_type: reactionType, count: 1 }];
        });

        const newReacted = new Set(userReacted);
        newReacted.add(reactionType);
        setUserReacted(newReacted);
        saveUserReacted(articleId, newReacted);

        // Fire API
        fetch('/api/triplepedia/react', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ articleId, reactionType }),
        }).catch(() => { /* best-effort */ });
    }, [articleId, userReacted]);

    const getCount = useCallback(
        (type: ReactionType) => reactions.find((r) => r.reaction_type === type)?.count ?? 0,
        [reactions],
    );

    const hasReacted = useCallback(
        (type: ReactionType) => userReacted.has(type),
        [userReacted],
    );

    return { reactions, react, getCount, hasReacted, loading };
}
