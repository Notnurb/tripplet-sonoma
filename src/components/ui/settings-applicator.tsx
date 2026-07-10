'use client';

import { useEffect } from 'react';
import { loadSettings, applySettings, SETTINGS_EVENT } from '@/lib/settings';

export function SettingsApplicator() {
    useEffect(() => {
        // Apply on mount
        applySettings(loadSettings());

        // Apply saved custom skin if any
        try {
            const stored = localStorage.getItem('tripplet_custom_skin');
            if (stored) {
                const { css } = JSON.parse(stored);
                let el = document.getElementById('tripplet-custom-skin');
                if (!el) {
                    el = document.createElement('style');
                    el.id = 'tripplet-custom-skin';
                    document.head.appendChild(el);
                }
                el.textContent = css;
            }
        } catch {}

        // Re-apply whenever settings change
        const handler = () => applySettings(loadSettings());
        window.addEventListener(SETTINGS_EVENT, handler);
        return () => window.removeEventListener(SETTINGS_EVENT, handler);
    }, []);

    return null;
}
