'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HugeiconsIcon } from '@hugeicons/react';
import { Sun03Icon, Moon02Icon } from '@hugeicons/core-free-icons';
import { loadSettings, updateSetting, applySettings } from '@/lib/settings';

export default function ThemeToggle() {
    const [theme, setTheme] = useState('dark');
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        const settings = loadSettings();
        setTheme(settings.theme);
        // Initial apply to be safe
        applySettings(settings);
    }, []);

    if (!mounted) {
        return <div className="w-9 h-9" />;
    }

    const isDark = theme !== 'light';

    const handleToggle = () => {
        const newTheme = isDark ? 'light' : 'dark';
        setTheme(newTheme);
        const next = updateSetting('theme', newTheme);
        applySettings(next);
    };

    return (
        <button
            onClick={handleToggle}
            className="relative p-2 rounded-xl hover:bg-sidebar-accent/50 text-sidebar-foreground transition-all duration-200 overflow-hidden"
            aria-label="Toggle theme"
        >
            <AnimatePresence mode="wait" initial={false}>
                <motion.div
                    key={isDark ? 'dark' : 'light'}
                    initial={{ y: -20, opacity: 0, rotate: -90 }}
                    animate={{ y: 0, opacity: 1, rotate: 0 }}
                    exit={{ y: 20, opacity: 0, rotate: 90 }}
                    transition={{ duration: 0.2 }}
                >
                    {isDark ? (
                        <HugeiconsIcon icon={Moon02Icon} size={16} />
                    ) : (
                        <HugeiconsIcon icon={Sun03Icon} size={16} />
                    )}
                </motion.div>
            </AnimatePresence>
        </button>
    );
}
