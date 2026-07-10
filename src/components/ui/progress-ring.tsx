'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check } from 'lucide-react';

const STEPS = [
    { id: 'name', label: 'Set your name', key: 'tripplet_persona_name' },
    { id: 'interest', label: 'Add an interest', key: 'tripplet_persona_keywords' },
    { id: 'instructions', label: 'Write custom instructions', key: 'tripplet_persona_instructions' },
    { id: 'et', label: 'Try Extended Thinking', key: 'tripplet_tried_extended_thinking' },
    { id: 'messages', label: 'Send 5 messages', key: 'tripplet_message_count' },
    { id: 'images', label: 'Try image mode', key: 'tripplet_tried_image_mode' },
    { id: 'triplepedia', label: 'Explore Triplepedia', key: 'tripplet_visited_triplepedia' },
] as const;

function isStepComplete(step: typeof STEPS[number]): boolean {
    try {
        const val = localStorage.getItem(step.key);
        if (!val) return false;
        if (step.id === 'messages') return parseInt(val, 10) >= 5;
        if (step.id === 'interest') {
            const arr = JSON.parse(val);
            return Array.isArray(arr) && arr.length > 0;
        }
        return val.trim().length > 0 && val !== 'false';
    } catch {
        return false;
    }
}

export function ProgressRing() {
    const [open, setOpen] = useState(false);
    const [completed, setCompleted] = useState(0);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const refresh = useCallback(() => {
        setCompleted(STEPS.filter(isStepComplete).length);
    }, []);

    useEffect(() => {
        refresh();
        const interval = setInterval(refresh, 3000);
        return () => clearInterval(interval);
    }, [refresh]);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const total = STEPS.length;
    const pct = completed / total;
    const circumference = 2 * Math.PI * 11;
    const strokeDashoffset = circumference * (1 - pct);

    let ringColor = '#00E5FF'; // cyan
    if (pct >= 1) ringColor = '#4ADE80'; // green
    else if (pct > 0.5) ringColor = '#B388FF'; // purple

    if (completed >= total) {
        // Check if already celebrated
        const celebrated = typeof window !== 'undefined' && localStorage.getItem('tripplet_progress_celebrated');
        if (!celebrated && typeof window !== 'undefined') {
            localStorage.setItem('tripplet_progress_celebrated', 'true');
        }
    }

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => { refresh(); setOpen(!open); }}
                className="relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-sidebar-accent/50 transition-colors"
                aria-label="Profile progress"
            >
                <svg width="28" height="28" viewBox="0 0 28 28" className="rotate-[-90deg]">
                    <circle
                        cx="14" cy="14" r="11"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="text-sidebar-foreground/10"
                    />
                    <circle
                        cx="14" cy="14" r="11"
                        fill="none"
                        stroke={ringColor}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease' }}
                    />
                </svg>
                <span className="absolute text-[9px] font-bold text-sidebar-foreground/70">
                    {completed}
                </span>
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute bottom-full left-0 mb-2 w-64 rounded-xl border border-border bg-card shadow-xl overflow-hidden z-50"
                    >
                        <div className="px-4 py-3 border-b border-border">
                            <p className="text-xs font-semibold text-foreground">Get the most out of Tripplet</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                                {completed >= total
                                    ? "You're all set."
                                    : `${completed} of ${total} — keep going`}
                            </p>
                        </div>
                        <div className="py-1">
                            {STEPS.map((step) => {
                                const done = isStepComplete(step);
                                return (
                                    <div
                                        key={step.id}
                                        className="flex items-center gap-2.5 px-4 py-2"
                                    >
                                        <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                                            done
                                                ? 'bg-emerald-500/20 text-emerald-400'
                                                : 'border border-border'
                                        }`}>
                                            {done && <Check size={10} strokeWidth={3} />}
                                        </div>
                                        <span className={`text-xs ${
                                            done
                                                ? 'text-muted-foreground line-through'
                                                : 'text-foreground'
                                        }`}>
                                            {step.label}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
