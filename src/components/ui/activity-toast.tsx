'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Shield, Globe, Sparkles, Zap, Code2, HardDrive, FolderOpen } from 'lucide-react';

const PULSES = [
    { icon: Cpu, text: 'Taipei 3.1 — reasoning model — online and ready' },
    { icon: Shield, text: 'Conversations are encrypted and never used for training' },
    { icon: Globe, text: 'Web Search pulls from live sources in real time' },
    { icon: Zap, text: 'Extended Thinking enables multi-step reasoning chains' },
    { icon: Code2, text: 'Code workspace supports live preview and instant deploy' },
    { icon: Shield, text: 'Your data is never sold to third parties' },
    { icon: Cpu, text: 'Majuli 3.1 — optimised for fast, precise responses' },
    { icon: Sparkles, text: 'Memory system learns your preferences over time' },
    { icon: HardDrive, text: 'Cloud Workspaces — persistent file storage for your projects' },
    { icon: FolderOpen, text: 'Cloud environments auto-save your files between sessions' },
];

function randomDelay() {
    return 28000 + Math.random() * 22000; // 28–50 seconds
}

export function ActivityToast() {
    const [visible, setVisible] = useState(false);
    const [idx, setIdx] = useState(0);
    const [lastIdx, setLastIdx] = useState<number | null>(null);

    const show = useCallback(() => {
        let next: number;
        do { next = Math.floor(Math.random() * PULSES.length); }
        while (next === lastIdx);
        setIdx(next);
        setLastIdx(next);
        setVisible(true);
        setTimeout(() => setVisible(false), 5000);
    }, [lastIdx]);

    useEffect(() => {
        const t = setTimeout(show, 12000 + Math.random() * 8000);
        return () => clearTimeout(t);
     
    }, []);

    useEffect(() => {
        if (!visible) {
            const t = setTimeout(show, randomDelay());
            return () => clearTimeout(t);
        }
    }, [visible, show]);

    const pulse = PULSES[idx];
    const Icon = pulse.icon;

    return (
        <div className="fixed bottom-6 left-6 z-50 pointer-events-none">
            <AnimatePresence>
                {visible && (
                    <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 16, scale: 0.94, filter: 'blur(6px)' }}
                        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, y: -8, scale: 0.96, filter: 'blur(4px)' }}
                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                        className="flex items-center gap-3 rounded-2xl border border-border bg-card/90 px-4 py-3 shadow-lg backdrop-blur-md max-w-[280px]"
                    >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <p className="text-xs leading-snug text-muted-foreground">
                            {pulse.text}
                        </p>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
