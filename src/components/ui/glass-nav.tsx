'use client';

// The homepage's liquid-glass pill navigation, shared by every marketing
// page (LandingHeader delegates here). tone="dark" is for pages with a dark
// hero behind the nav (the landing video); the default "auto" tone follows
// the app theme, since marketing pages default to the light theme where the
// glass class's white highlights would be invisible.

import { useState } from 'react';
import Link from 'next/link';
import { Globe } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import UserMenu from '@/components/Layout/UserMenu';
import { MenuToggleIcon } from '@/components/ui/menu-toggle-icon';
import { cn } from '@/lib/utils';
import { APP_NAME } from '@/lib/branding';

// Exported so the landing footer lists exactly what the nav lists — one place
// to add a destination rather than two that drift.
export const NAV_LINKS = [
    { label: 'Home', href: '/' },
    { label: 'Chat', href: '/chat' },
    { label: 'Code', href: '/code' },
    { label: 'Work', href: '/work' },
    { label: 'Astrocode', href: '/cli' },
    { label: 'Blog', href: '/blog' },
    { label: 'About', href: '/about' },
];

export function GlassNav({ tone = 'auto' }: { tone?: 'dark' | 'auto' }) {
    const { user, isLoading } = useAuth();
    const [open, setOpen] = useState(false);
    const dark = tone === 'dark';

    const link = dark
        ? 'text-white/80 hover:text-white'
        : 'text-foreground/70 hover:text-foreground';
    const strong = dark ? 'text-white' : 'text-foreground';

    // Inline styles win over the .liquid-glass class background/shadow, giving
    // the pill definition on light themes where white-on-white glass vanishes.
    const glassTint: React.CSSProperties | undefined = dark
        ? undefined
        : {
              background: 'color-mix(in srgb, var(--foreground) 4%, transparent)',
              boxShadow: 'var(--sonoma-shadow-sm)',
          };

    return (
        <header className="relative z-20 px-6 py-6">
            <nav
                className="liquid-glass mx-auto flex max-w-5xl items-center justify-between rounded-full px-6 py-3"
                style={glassTint}
            >
                <div className="flex items-center gap-8">
                    <Link href="/" className={cn('flex items-center gap-2', strong)}>
                        <Globe size={24} aria-hidden="true" className="text-white" />
                        <span className="text-lg font-semibold text-white">{APP_NAME}</span>
                    </Link>
                    <div className="hidden items-center gap-8 md:flex">
                        {NAV_LINKS.map(({ label, href }) => (
                            <Link
                                key={label}
                                href={href}
                                className={cn('text-sm font-medium transition-colors', link)}
                            >
                                {label}
                            </Link>
                        ))}
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    {isLoading ? (
                        <div className={cn('h-8 w-8 animate-pulse rounded-full', dark ? 'bg-white/10' : 'bg-muted')} />
                    ) : user ? (
                        <UserMenu />
                    ) : (
                        <>
                            <Link
                                href="/register"
                                className={cn(
                                    'hidden text-sm font-medium transition-opacity hover:opacity-80 sm:inline',
                                    strong,
                                )}
                            >
                                Sign Up
                            </Link>
                            <Link
                                href="/login"
                                className={cn(
                                    'liquid-glass rounded-full px-6 py-2 text-sm font-medium transition-colors',
                                    strong,
                                    dark ? 'hover:bg-white/5' : 'hover:bg-muted/40',
                                )}
                                style={glassTint}
                            >
                                Login
                            </Link>
                        </>
                    )}
                    <button
                        type="button"
                        onClick={() => setOpen((o) => !o)}
                        aria-expanded={open}
                        aria-label="Toggle menu"
                        className={cn('inline-flex items-center justify-center md:hidden', strong)}
                    >
                        <MenuToggleIcon open={open} className="size-5" duration={300} />
                    </button>
                </div>
            </nav>

            {open && (
                <div
                    className={cn(
                        'absolute left-6 right-6 top-full z-30 mt-2 rounded-2xl border p-3 md:hidden',
                        dark
                            ? 'border-white/10 bg-black/85 backdrop-blur-xl'
                            : 'border-border bg-popover/95 backdrop-blur-xl',
                    )}
                >
                    <div className="flex flex-col">
                        {NAV_LINKS.map(({ label, href }) => (
                            <Link
                                key={label}
                                href={href}
                                onClick={() => setOpen(false)}
                                className={cn('rounded-lg px-3 py-2.5 text-sm font-medium transition-colors', link)}
                            >
                                {label}
                            </Link>
                        ))}
                        {!isLoading && !user && (
                            <Link
                                href="/register"
                                onClick={() => setOpen(false)}
                                className={cn('rounded-lg px-3 py-2.5 text-sm font-medium transition-colors sm:hidden', link)}
                            >
                                Sign Up
                            </Link>
                        )}
                    </div>
                </div>
            )}
        </header>
    );
}
