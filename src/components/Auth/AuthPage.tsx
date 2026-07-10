'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, User } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { SonomaLogo } from '@/components/Sonoma/icons';

type AuthMode = 'login' | 'register';

interface AuthPageProps {
    mode: AuthMode;
}

interface ApiErrorBody {
    error?: string;
}

export default function AuthPage({ mode }: AuthPageProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { refreshUser } = useAuth();
    const isRegister = mode === 'register';

    // Where to go after auth. Only same-origin relative paths are honored (so a
    // crafted ?next=https://evil.com can't turn login into an open redirect).
    // Used by the MCP OAuth consent flow to return here after sign-in.
    const nextPath = useMemo(() => {
        const raw = searchParams.get('next');
        if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
        return '/chat';
    }, [searchParams]);

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const content = useMemo(() => {
        if (isRegister) {
            return {
                eyebrow: 'Create account',
                title: 'Start with Tripplet',
                subtitle: 'Save your chats, projects, memory, images, and code work in one synced workspace.',
                submit: 'Create account',
                busy: 'Creating account...',
                footer: 'Already have an account?',
                footerLink: 'Sign in',
                footerHref: '/login',
            };
        }

        return {
            eyebrow: 'Welcome back',
            title: 'Sign in to Tripplet',
            subtitle: 'Continue with your conversations, saved context, generated media, and Epsilon code projects.',
            submit: 'Sign in',
            busy: 'Signing in...',
            footer: 'New to Tripplet?',
            footerLink: 'Create an account',
            footerHref: '/register',
        };
    }, [isRegister]);

    useEffect(() => {
        router.prefetch(nextPath);
    }, [router, nextPath]);

    async function submitAuth(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError('');

        const normalizedEmail = email.trim().toLowerCase();
        const trimmedName = name.trim();

        if (password.length < (isRegister ? 8 : 1)) {
            setError(isRegister ? 'Password must be at least 8 characters.' : 'Password is required.');
            return;
        }

        setIsSubmitting(true);
        try {
            const response = await fetch(isRegister ? '/api/auth/register' : '/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    email: normalizedEmail,
                    password,
                    ...(isRegister && trimmedName ? { name: trimmedName } : {}),
                }),
            });

            if (!response.ok) {
                const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
                throw new Error(body.error || 'Authentication failed. Please try again.');
            }

            await refreshUser();
            router.replace(nextPath);
            router.refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Authentication failed. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <main className="min-h-screen bg-background text-foreground">
            <div className="grid min-h-screen lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,0.68fr)]">
                <section className="relative hidden overflow-hidden border-r border-border bg-[var(--sonoma-bg-2)] lg:flex">
                    <div
                        aria-hidden
                        className="absolute inset-0"
                        style={{
                            backgroundImage:
                                'linear-gradient(to right, color-mix(in oklab, var(--foreground) 8%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 8%, transparent) 1px, transparent 1px)',
                            backgroundSize: '36px 36px',
                            maskImage: 'linear-gradient(to bottom, black, transparent 86%)',
                        }}
                    />
                    <div className="relative flex min-h-screen w-full flex-col justify-between p-10 xl:p-12">
                        <Link href="/" className="inline-flex w-fit items-center gap-2 text-foreground">
                            <SonomaLogo size={24} />
                            <span className="text-xl font-semibold tracking-tight">Tripplet</span>
                        </Link>

                        <div className="max-w-xl space-y-8">
                            <div className="space-y-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    Taipei + Majuli + Suzhou
                                </p>
                                <h1
                                    className="max-w-lg text-5xl font-medium leading-[1.02] tracking-normal text-foreground xl:text-6xl"
                                    style={{ fontFamily: 'var(--font-newsreader)' }}
                                >
                                    One account for every way you work with AI.
                                </h1>
                            </div>

                            <div className="grid max-w-lg grid-cols-2 gap-3 text-sm">
                                {['Chat', 'Images', 'Code'].map((item) => (
                                    <div
                                        key={item}
                                        className="rounded-lg border border-border bg-background/70 px-4 py-3 text-foreground shadow-sm"
                                    >
                                        {item}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <p className="max-w-md text-sm leading-6 text-muted-foreground">
                            Your workspace stays synced across sessions, with memory, search, generation history,
                            and app-building context ready when you return.
                        </p>
                    </div>
                </section>

                <section className="flex min-h-screen items-center justify-center px-5 py-8 sm:px-8">
                    <div className="w-full max-w-[420px]">
                        <div className="mb-10 flex justify-center lg:hidden">
                            <Link href="/" className="inline-flex items-center gap-2 text-foreground">
                                <SonomaLogo size={24} />
                                <span className="text-xl font-semibold tracking-tight">Tripplet</span>
                            </Link>
                        </div>

                        <div className="rounded-lg border border-border bg-card p-6 shadow-[0_20px_60px_-38px_rgba(0,0,0,0.45)] sm:p-7">
                            <div className="mb-7 space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                    {content.eyebrow}
                                </p>
                                <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                                    {content.title}
                                </h2>
                                <p className="text-sm leading-6 text-muted-foreground">{content.subtitle}</p>
                            </div>

                            <form onSubmit={submitAuth} className="space-y-4">
                                {isRegister && (
                                    <label className="block space-y-1.5">
                                        <span className="text-sm font-medium text-foreground">Name</span>
                                        <span className="relative block">
                                            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                            <input
                                                type="text"
                                                value={name}
                                                onChange={(event) => setName(event.target.value)}
                                                autoComplete="name"
                                                placeholder="Your name"
                                                className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring focus:ring-3 focus:ring-ring/20"
                                            />
                                        </span>
                                    </label>
                                )}

                                <label className="block space-y-1.5">
                                    <span className="text-sm font-medium text-foreground">Email</span>
                                    <span className="relative block">
                                        <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                        <input
                                            type="email"
                                            value={email}
                                            onChange={(event) => setEmail(event.target.value)}
                                            autoComplete="email"
                                            placeholder="you@example.com"
                                            required
                                            className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring focus:ring-3 focus:ring-ring/20"
                                        />
                                    </span>
                                </label>

                                <label className="block space-y-1.5">
                                    <span className="flex items-center justify-between gap-3 text-sm font-medium text-foreground">
                                        Password
                                        {!isRegister && (
                                            <Link
                                                href="/forgot-password"
                                                className="text-xs font-normal text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                                            >
                                                Forgot password?
                                            </Link>
                                        )}
                                    </span>
                                    <span className="relative block">
                                        <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                        <input
                                            type={showPassword ? 'text' : 'password'}
                                            value={password}
                                            onChange={(event) => setPassword(event.target.value)}
                                            autoComplete={isRegister ? 'new-password' : 'current-password'}
                                            placeholder={isRegister ? 'At least 8 characters' : 'Your password'}
                                            minLength={isRegister ? 8 : 1}
                                            required
                                            className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-10 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring focus:ring-3 focus:ring-ring/20"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword((value) => !value)}
                                            className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                                        >
                                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </span>
                                </label>

                                {error && (
                                    <p
                                        className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                                        role="alert"
                                    >
                                        {error}
                                    </p>
                                )}

                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            {content.busy}
                                        </>
                                    ) : (
                                        <>
                                            {content.submit}
                                            <ArrowRight className="h-4 w-4" />
                                        </>
                                    )}
                                </button>
                            </form>

                            <p className="mt-6 text-center text-sm text-muted-foreground">
                                {content.footer}{' '}
                                <Link
                                    href={content.footerHref}
                                    className="font-medium text-foreground underline-offset-4 hover:underline"
                                >
                                    {content.footerLink}
                                </Link>
                            </p>
                        </div>

                        <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
                            By continuing, you agree to Tripplet&apos;s{' '}
                            <Link href="/terms" className="text-foreground underline-offset-4 hover:underline">
                                Terms
                            </Link>{' '}
                            and{' '}
                            <Link href="/privacy" className="text-foreground underline-offset-4 hover:underline">
                                Privacy Policy
                            </Link>
                            .
                        </p>
                    </div>
                </section>
            </div>
        </main>
    );
}
