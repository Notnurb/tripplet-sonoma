'use client';

import { useEffect } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

interface AnimatedCounterProps {
    value: number;
    className?: string;
    prefix?: string;
    suffix?: string;
}

export default function AnimatedCounter({ value, className, prefix = '', suffix = '' }: AnimatedCounterProps) {
    // Satisfying spring physics
    const spring = useSpring(0, { stiffness: 60, damping: 15 });
    const display = useTransform(spring, (current) => {
        const rounded = Math.round(current);
        return `${prefix}${rounded}${suffix}`;
    });

    useEffect(() => {
        // Animate to new value
        if (typeof value === 'number') {
            spring.set(value);
        }
    }, [value, spring]);

    return (
        <motion.span className={className}>
            {display}
        </motion.span>
    );
}
