'use client';

import { useEffect, useState } from 'react';

/**
 * Tracks whether the viewport is at or below `breakpoint` (default 768px,
 * matching Tailwind's `md`). SSR-safe: returns false until mounted so the
 * server and first client render agree, then updates on resize.
 */
export function useIsMobile(breakpoint = 768): boolean {
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const mql = window.matchMedia(`(max-width: ${breakpoint - 0.02}px)`);
        const update = () => setIsMobile(mql.matches);
        update();
        mql.addEventListener('change', update);
        return () => mql.removeEventListener('change', update);
    }, [breakpoint]);

    return isMobile;
}
