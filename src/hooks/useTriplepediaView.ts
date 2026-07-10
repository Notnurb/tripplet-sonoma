'use client';

import { useEffect } from 'react';

export function useTriplepediaView(articleId: string | undefined) {
    useEffect(() => {
        if (!articleId) return;

        const key = `triplepedia_viewed_${articleId}`;
        if (sessionStorage.getItem(key)) return;

        sessionStorage.setItem(key, '1');

        fetch('/api/triplepedia/view', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ articleId }),
        }).catch(() => {
            // Best-effort; don't block the page
        });
    }, [articleId]);
}
