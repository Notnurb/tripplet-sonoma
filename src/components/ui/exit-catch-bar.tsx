'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import Link from 'next/link';

export function ExitCatchBar() {
    const [show, setShow] = useState(false);
    const reachedBottom = useRef(false);
    const shown = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const handler = () => {
            const scrollPct = window.scrollY / Math.max(1, document.body.scrollHeight - window.innerHeight);

            if (scrollPct > 0.7) {
                reachedBottom.current = true;
            }

            if (reachedBottom.current && scrollPct < 0.3 && !shown.current) {
                shown.current = true;
                setShow(true);
                // Auto-dismiss after 8s
                timerRef.current = setTimeout(() => setShow(false), 8000);
            }
        };

        window.addEventListener('scroll', handler, { passive: true });
        return () => {
            window.removeEventListener('scroll', handler);
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    return (
        <AnimatePresence>
            {show && (
                <motion.div
                    initial={{ y: -40, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -40, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="fixed top-0 left-0 right-0 z-[100] h-10 bg-card/95 border-b border-border backdrop-blur-sm flex items-center justify-center px-4"
                >
                    <p className="text-xs text-muted-foreground">
                        Free trial ends when you close the tab — not a minute later.{' '}
                        <span className="font-semibold text-foreground">No card required.</span>
                    </p>
                    <Link
                        href="/register"
                        className="ml-3 text-xs font-semibold text-foreground hover:opacity-80 transition-opacity"
                    >
                        Start free →
                    </Link>
                    <button
                        onClick={() => {
                            setShow(false);
                            if (timerRef.current) clearTimeout(timerRef.current);
                        }}
                        className="absolute right-3 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                        aria-label="Dismiss"
                    >
                        <X size={14} />
                    </button>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
