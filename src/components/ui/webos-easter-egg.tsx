'use client';

import { useEffect } from 'react';

/**
 * WebOSTrigger — type "qwertyuiop" anywhere on the site and the page is
 * replaced with the ZenOS web desktop served from /public/webos.html.
 * Inside ZenOS, the "Sonoma" app (logo icon) navigates back here.
 */

const SEQUENCE = 'qwertyuiop';

export function WebOSTrigger() {
    useEffect(() => {
        let buffer = '';
        const onKey = (e: KeyboardEvent) => {
            if (e.key.length !== 1) return; // ignore modifiers / arrows / etc.
            buffer = (buffer + e.key.toLowerCase()).slice(-SEQUENCE.length);
            if (buffer === SEQUENCE) {
                buffer = '';
                window.location.href = '/webos.html';
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    return null;
}
