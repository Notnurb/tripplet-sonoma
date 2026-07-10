'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface UseReadingProgressOptions {
    /** CSS selector for the scrollable article container. Defaults to the document. */
    selector?: string;
    /** Completion threshold (0-1). Default 0.9. */
    threshold?: number;
    onComplete?: () => void;
}

export function useReadingProgress(options: UseReadingProgressOptions = {}) {
    const { selector, threshold = 0.9, onComplete } = options;
    const [progress, setProgress] = useState(0);
    const [isComplete, setIsComplete] = useState(false);
    const firedRef = useRef(false);
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;

    const handleScroll = useCallback(() => {
        let scrollTop: number;
        let scrollHeight: number;
        let clientHeight: number;

        if (selector) {
            const el = document.querySelector(selector);
            if (!el) return;
            scrollTop = el.scrollTop;
            scrollHeight = el.scrollHeight;
            clientHeight = el.clientHeight;
        } else {
            scrollTop = window.scrollY || document.documentElement.scrollTop;
            scrollHeight = document.documentElement.scrollHeight;
            clientHeight = window.innerHeight;
        }

        const total = scrollHeight - clientHeight;
        if (total <= 0) {
            setProgress(1);
            return;
        }

        const pct = Math.min(1, scrollTop / total);
        setProgress(pct);

        if (pct >= threshold && !firedRef.current) {
            firedRef.current = true;
            setIsComplete(true);
            onCompleteRef.current?.();
        }
    }, [selector, threshold]);

    useEffect(() => {
        const target = selector ? document.querySelector(selector) : window;
        if (!target) return;

        // Use passive listener for perf
        target.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll(); // initial check
        return () => target.removeEventListener('scroll', handleScroll);
    }, [selector, handleScroll]);

    // Reset when selector changes (new article)
    useEffect(() => {
        firedRef.current = false;
        setIsComplete(false);
        setProgress(0);
    }, [selector]);

    return { progress, isComplete };
}
