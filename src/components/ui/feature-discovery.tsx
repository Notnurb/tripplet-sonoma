'use client';

import { useEffect, useState, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface FeatureDiscoveryProps {
    id: string;
    show: boolean;
    message: string;
    autoDismissMs?: number;
    onDismiss: () => void;
}

export function FeatureDiscovery({
    id,
    show,
    message,
    autoDismissMs = 5000,
    onDismiss,
}: FeatureDiscoveryProps) {
    const [visible, setVisible] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!show) {
            setVisible(false);
            return;
        }

        // Check if already shown before
        const key = `tripplet_discovery_${id}`;
        if (localStorage.getItem(key)) {
            onDismiss();
            return;
        }

        setVisible(true);
        localStorage.setItem(key, 'true');

        timerRef.current = setTimeout(() => {
            setVisible(false);
            onDismiss();
        }, autoDismissMs);

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [show, id, autoDismissMs, onDismiss]);

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.3 }}
                    className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 max-w-sm"
                >
                    <div className="rounded-xl border border-border bg-card/95 shadow-lg backdrop-blur-sm px-4 py-3 flex items-center gap-3">
                        <p className="text-xs text-foreground/80 leading-relaxed flex-1">
                            {message}
                        </p>
                        <button
                            onClick={() => {
                                setVisible(false);
                                if (timerRef.current) clearTimeout(timerRef.current);
                                onDismiss();
                            }}
                            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        >
                            Got it
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
