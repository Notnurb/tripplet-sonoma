'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

const WELCOME_BACK = [
    'Still here for you.',
    'Right where you left off.',
    'Picked up right where we stopped.',
    'Ready when you are.',
    'Welcome back — let\'s keep going.',
];

// Variable-reward curiosity gap messages — each glance at the tab shows something different
const AWAY_TITLES = [
    '💭 Your AI is waiting…',
    '✨ New idea? Come back and try it',
    '🧠 Still thinking about your last question…',
    '⚡ Tripplet misses you',
    '🔮 What will you ask next?',
    '🎯 Pick up where you left off',
    '💡 Got a sec? Let\'s build something',
];

export function TabVisibility({ message }: { message: string }) {
    const hiddenAtRef = useRef<number>(0);
    const rotateRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        const original = document.title;
        const handle = () => {
            if (document.hidden) {
                hiddenAtRef.current = Date.now();
                // Show the primary message first
                document.title = message;
                // After 8s, start rotating through curiosity-gap titles every 4s
                rotateRef.current = setInterval(() => {
                    const pick = AWAY_TITLES[Math.floor(Math.random() * AWAY_TITLES.length)];
                    document.title = pick;
                }, 4000);
            } else {
                document.title = original;
                if (rotateRef.current) {
                    clearInterval(rotateRef.current);
                    rotateRef.current = null;
                }
                // If away for > 45 seconds, show a warm micro-toast
                const away = Date.now() - hiddenAtRef.current;
                if (hiddenAtRef.current > 0 && away > 45_000) {
                    const line = WELCOME_BACK[Math.floor(Math.random() * WELCOME_BACK.length)];
                    toast(line, { duration: 3000 });
                }
            }
        };
        document.addEventListener('visibilitychange', handle);
        return () => {
            document.removeEventListener('visibilitychange', handle);
            if (rotateRef.current) clearInterval(rotateRef.current);
            document.title = original;
        };
    }, [message]);
    return null;
}
