'use client';

import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useReadingProgress } from '@/hooks/useReadingProgress';

interface ReadingProgressBarProps {
    articleTitle: string;
    onComplete?: () => void;
}

// Simple CSS confetti burst
function ConfettiBurst() {
    const particles = Array.from({ length: 24 }, (_, i) => {
        const angle = (i / 24) * 360;
        const distance = 60 + Math.random() * 80;
        const x = Math.cos((angle * Math.PI) / 180) * distance;
        const y = Math.sin((angle * Math.PI) / 180) * distance;
        const colors = ['#f59e0b', '#3b82f6', '#ef4444', '#10b981', '#8b5cf6', '#ec4899'];
        const color = colors[i % colors.length];
        return { x, y, color, delay: Math.random() * 0.15, size: 4 + Math.random() * 4 };
    });

    return (
        <div className="fixed inset-0 pointer-events-none z-[100] flex items-center justify-center">
            {particles.map((p, i) => (
                <motion.div
                    key={i}
                    initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
                    animate={{ x: p.x, y: p.y, scale: 0, opacity: 0 }}
                    transition={{ duration: 0.8, delay: p.delay, ease: 'easeOut' }}
                    style={{ backgroundColor: p.color, width: p.size, height: p.size }}
                    className="absolute rounded-full"
                />
            ))}
        </div>
    );
}

export default function ReadingProgressBar({ articleTitle, onComplete }: ReadingProgressBarProps) {
    const [showCelebration, setShowCelebration] = useState(false);
    const [showToast, setShowToast] = useState(false);
    const celebratedRef = useRef(false);

    const handleComplete = useCallback(() => {
        if (celebratedRef.current) return;
        celebratedRef.current = true;
        setShowCelebration(true);
        setShowToast(true);
        onComplete?.();

        setTimeout(() => setShowCelebration(false), 1200);
        setTimeout(() => setShowToast(false), 4000);
    }, [onComplete]);

    const { progress } = useReadingProgress({ onComplete: handleComplete });

    return (
        <>
            {/* Progress bar */}
            <div className="fixed top-0 left-0 right-0 z-[60] h-[3px] bg-transparent">
                <motion.div
                    className="h-full bg-gradient-to-r from-muted-foreground/30 via-foreground/60 to-foreground"
                    style={{ width: `${progress * 100}%` }}
                    transition={{ duration: 0.1 }}
                />
            </div>

            {/* Confetti */}
            <AnimatePresence>
                {showCelebration && <ConfettiBurst />}
            </AnimatePresence>

            {/* Completion toast */}
            <AnimatePresence>
                {showToast && (
                    <motion.div
                        initial={{ opacity: 0, y: 40, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.95 }}
                        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-2xl bg-card border border-border shadow-2xl flex items-center gap-3"
                    >
                        <span className="text-xl">🎉</span>
                        <div>
                            <p className="text-sm font-semibold text-foreground">Article complete!</p>
                            <p className="text-xs text-muted-foreground">
                                You just learned about {articleTitle}
                            </p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
