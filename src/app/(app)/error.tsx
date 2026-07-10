'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';

export default function AppError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('App error:', error);
    }, [error]);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center justify-center h-full gap-5 p-8 text-center bg-gradient-to-br from-background to-background/80"
        >
            <motion.div
                initial={{ scale: 0.8, y: 10 }}
                animate={{ scale: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="drop-shadow-xl"
            >
                <Image
                    src="/trilo-jaw.png"
                    alt="Trilo shocked"
                    width={120}
                    height={120}
                    className="drop-shadow-lg"
                />
            </motion.div>
            <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.15 }}
                className="space-y-2"
            >
                <h2 className="text-2xl font-bold text-foreground">Oops, something went sideways</h2>
                <p className="text-muted-foreground/80 max-w-sm text-sm leading-relaxed">
                    An unexpected hiccup occurred, but don't worry—your conversations are safe and sound. Let's get back on track.
                </p>
            </motion.div>
            <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={reset}
                className="px-6 py-2.5 bg-gradient-to-r from-foreground to-foreground/90 text-background rounded-lg hover:shadow-lg transition-all duration-200 text-sm font-medium mt-2"
            >
                Try again
            </motion.button>
        </motion.div>
    );
}
