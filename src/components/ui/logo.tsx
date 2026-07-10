'use client';

import { cn } from '@/lib/utils';
import { APP_NAME } from '@/lib/branding';
import { useState } from 'react';

interface LogoProps {
    size?: number;
    className?: string;
}

// S.png from /public/logo.png — inverts automatically for dark/light mode.
// White mark on transparent → shows white in dark, inverts to black in light.
export function Logo({ size = 28, className }: LogoProps) {
    const [errored, setErrored] = useState(false);

    if (errored) {
        return (
            <span
                style={{ width: size, height: size, fontSize: size * 0.5 }}
                className={cn(
                    'inline-flex items-center justify-center font-bold shrink-0 select-none text-foreground',
                    className
                )}
            >
                {APP_NAME.charAt(0).toUpperCase()}
            </span>
        );
    }

    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src="/logo.png"
            alt={APP_NAME}
            width={size}
            height={size}
            className={cn(
                'object-contain shrink-0 dark:invert',
                className
            )}
            onError={() => setErrored(true)}
        />
    );
}
