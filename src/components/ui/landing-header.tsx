'use client';
import React from 'react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MenuToggleIcon } from '@/components/ui/menu-toggle-icon';
import { createPortal } from 'react-dom';
import { useAuth } from '@/context/AuthContext';
import UserMenu from '@/components/Layout/UserMenu';
import { motion } from 'framer-motion';
import { Logo } from '@/components/ui/logo';
import { APP_NAME } from '@/lib/branding';

const ease = [0.25, 0.46, 0.45, 0.94] as const;

export function LandingHeader() {
    const { user, isLoading } = useAuth();
    const [open, setOpen] = React.useState(false);
    const scrolled = useScroll(10);

    const links = [
        { label: 'Features', href: '/features' },
        { label: 'Environment', href: '/environment', className: 'text-emerald-400 hover:text-emerald-300' },
        { label: 'Blog', href: '/blog' },
        { label: 'About', href: '/about' },
    ];

    React.useEffect(() => {
        if (open) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [open]);

    return (
        <motion.header
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease }}
            className={cn(
                'sticky top-0 z-50 w-full border-b transition-all duration-300',
                scrolled
                    ? 'bg-background/95 supports-[backdrop-filter]:bg-background/50 border-border backdrop-blur-lg'
                    : 'border-transparent',
            )}
        >
            <nav className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
                <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
                    <Logo size={26} />
                    <span className="text-lg font-bold tracking-tight text-foreground">{APP_NAME}</span>
                </Link>

                <div className="hidden items-center gap-1 md:flex">
                    {links.map((link, i) => (
                        <motion.a
                            key={link.label}
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.4, delay: 0.1 + i * 0.05, ease }}
                            className={cn(
                                buttonVariants({ variant: 'ghost', size: 'sm' }),
                                'text-foreground/80 hover:text-foreground relative after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:h-px after:w-0 after:transition-all after:duration-300 hover:after:w-3/4',
                                link.className
                                    ? `${link.className} after:bg-emerald-400`
                                    : 'after:bg-foreground',
                            )}
                            href={link.href}
                        >
                            {link.label}
                        </motion.a>
                    ))}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.4, delay: 0.35, ease }}
                        className="ml-2 flex items-center gap-2"
                    >
                        {isLoading ? (
                            <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
                        ) : user ? (
                            <UserMenu />
                        ) : (
                            <>
                                <Link href="/login">
                                    <Button variant="ghost" size="sm">Sign In</Button>
                                </Link>
                                <Link href="/register">
                                    <Button size="sm">Try free</Button>
                                </Link>
                            </>
                        )}
                    </motion.div>
                </div>

                <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setOpen(!open)}
                    className="md:hidden"
                    aria-expanded={open}
                    aria-label="Toggle menu"
                >
                    <MenuToggleIcon open={open} className="size-5" duration={300} />
                </Button>
            </nav>

            <MobileMenu open={open}>
                <div className="grid gap-y-1 p-4">
                    {links.map((link, i) => (
                        <motion.a
                            key={link.label}
                            initial={{ opacity: 0, x: -16 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.3, delay: i * 0.06, ease }}
                            className={cn(
                                buttonVariants({ variant: 'ghost', className: 'justify-start' }),
                                link.className,
                            )}
                            href={link.href}
                            onClick={() => setOpen(false)}
                        >
                            {link.label}
                        </motion.a>
                    ))}
                </div>
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.2, ease }}
                    className="flex flex-col gap-2 border-t border-border p-4"
                >
                    {!isLoading && user ? (
                        <Link href="/chat">
                            <Button className="w-full">Go to App</Button>
                        </Link>
                    ) : (
                        <>
                            <Link href="/login">
                                <Button variant="outline" className="w-full">Sign In</Button>
                            </Link>
                            <Link href="/register">
                                <Button className="w-full">Try free</Button>
                            </Link>
                        </>
                    )}
                </motion.div>
            </MobileMenu>
        </motion.header>
    );
}

type MobileMenuProps = React.ComponentProps<'div'> & { open: boolean };

function MobileMenu({ open, children, className, ...props }: MobileMenuProps) {
    if (!open || typeof window === 'undefined') return null;

    return createPortal(
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={cn(
                'bg-background/95 supports-[backdrop-filter]:bg-background/50 backdrop-blur-lg',
                'fixed top-14 right-0 bottom-0 left-0 z-40 flex flex-col overflow-hidden border-y md:hidden',
            )}
        >
            <div
                className={cn(
                    'flex size-full flex-col justify-between',
                    className,
                )}
                {...props}
            >
                {children}
            </div>
        </motion.div>,
        document.body,
    );
}

function useScroll(threshold: number) {
    const [scrolled, setScrolled] = React.useState(false);

    const onScroll = React.useCallback(() => {
        setScrolled(window.scrollY > threshold);
    }, [threshold]);

    React.useEffect(() => {
        window.addEventListener('scroll', onScroll);
        return () => window.removeEventListener('scroll', onScroll);
    }, [onScroll]);

    React.useEffect(() => {
        onScroll();
    }, [onScroll]);

    return scrolled;
}
