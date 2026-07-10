'use client';

import { useEffect, useState } from 'react';
import { loadSettings, SETTINGS_EVENT } from '@/lib/settings';

export function useReducedMotionPreference() {
    const [reducedMotion, setReducedMotion] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

        const sync = () => {
            const settings = loadSettings();
            setReducedMotion(settings.reduceMotion || mediaQuery.matches);
        };

        sync();

        window.addEventListener(SETTINGS_EVENT, sync);

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', sync);
            return () => {
                window.removeEventListener(SETTINGS_EVENT, sync);
                mediaQuery.removeEventListener('change', sync);
            };
        }

        mediaQuery.addListener(sync);
        return () => {
            window.removeEventListener(SETTINGS_EVENT, sync);
            mediaQuery.removeListener(sync);
        };
    }, []);

    return reducedMotion;
}
