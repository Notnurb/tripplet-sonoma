'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Check, Download, Loader2 } from 'lucide-react';
import { GlassNav } from '@/components/ui/glass-nav';

const EASE = 'cubic-bezier(0.76,0,0.24,1)';

const VIDEO_SRC =
    'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260622_204103_f607742e-09da-4cf5-bb06-4e67b0a531de.mp4';

const DMG_URL = '/TrippletWork.dmg';

type Platform = 'mac' | 'windows' | 'linux' | 'other';

/**
 * Best-effort client platform sniff. Runs after mount so the server and the
 * first client render agree — until then the CTA stays in its neutral state
 * rather than flashing the wrong one.
 */
function detectPlatform(): Platform {
    if (typeof navigator === 'undefined') return 'other';
    const ua = `${navigator.userAgent} ${navigator.platform ?? ''}`.toLowerCase();
    if (ua.includes('mac')) return 'mac';
    if (ua.includes('win')) return 'windows';
    if (ua.includes('linux') || ua.includes('android')) return 'linux';
    return 'other';
}

function WaitlistForm({ platform }: { platform: Platform }) {
    const [email, setEmail] = useState('');
    const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (state === 'sending') return;
        setState('sending');
        setError(null);
        try {
            const res = await fetch('/api/work/waitlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, platform }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Something went wrong');
            setState('done');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong');
            setState('idle');
        }
    };

    if (state === 'done') {
        return (
            <p className="inline-flex items-center gap-2 rounded-full border border-white/40 px-7 py-3 text-sm font-medium text-white">
                <Check className="h-4 w-4" />
                You&apos;re on the list — we&apos;ll email you.
            </p>
        );
    }

    return (
        <div className="w-full max-w-md">
            <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
                <input
                    type="email"
                    required
                    value={email}
                    onChange={(ev) => setEmail(ev.target.value)}
                    placeholder="you@example.com"
                    aria-label="Email address"
                    className="w-full rounded-full border border-white/40 bg-white/10 px-5 py-3 text-sm text-white placeholder:text-white/50 outline-none backdrop-blur-sm transition-colors focus:border-white/70"
                />
                <button
                    type="submit"
                    disabled={state === 'sending'}
                    className="group inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-medium text-black transition-opacity duration-200 hover:opacity-90 disabled:opacity-70"
                >
                    {state === 'sending' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <>
                            Join Waitlist
                            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                        </>
                    )}
                </button>
            </form>
            {error && (
                <p className="mt-3 text-xs font-light text-red-300" role="alert">
                    {error}
                </p>
            )}
            <p className="mt-3 text-xs font-light text-white/60">
                {platform === 'windows' ? 'Windows' : 'Linux'} is on the way — Tripplet Work is macOS
                only today.
            </p>
        </div>
    );
}

export default function WorkPage() {
    const [platform, setPlatform] = useState<Platform | null>(null);

    useEffect(() => {
        setPlatform(detectPlatform());
    }, []);

    const needsWaitlist = platform === 'windows' || platform === 'linux';

    return (
        <section className="relative w-full h-screen overflow-hidden">
            {/* Background video */}
            <video
                className="absolute inset-0 h-full w-full object-cover"
                autoPlay
                loop
                muted
                playsInline
                aria-hidden="true"
            >
                <source src={VIDEO_SRC} type="video/mp4" />
            </video>

            {/* Content layer */}
            <div className="relative z-10 flex flex-col h-full">
                {/* The same liquid-glass pill nav every other marketing page uses. */}
                <GlassNav tone="dark" />

                <div className="flex-1 flex flex-col items-center justify-start pt-4 sm:pt-6 md:pt-8 lg:pt-10 px-6 text-center">
                    <h1 className="font-instrument-serif text-white text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl leading-[1.1] max-w-5xl">
                        Your Whole Workday, One App
                    </h1>

                    <p className="mt-4 md:mt-5 text-white/70 text-sm md:text-base font-light max-w-md leading-relaxed">
                        Everything you need to get work done, without switching between tabs.
                    </p>

                    <div
                        className="mt-5 md:mt-6 flex flex-col sm:flex-row items-center gap-4 transition-opacity duration-300"
                        style={{ transitionTimingFunction: EASE, opacity: platform ? 1 : 0 }}
                    >
                        {needsWaitlist ? (
                            <WaitlistForm platform={platform as Platform} />
                        ) : (
                            <a
                                href={DMG_URL}
                                download
                                className="group inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-medium text-black transition-opacity duration-200 hover:opacity-90"
                            >
                                <Download className="h-4 w-4 transition-transform duration-200 group-hover:translate-y-0.5" />
                                Download for Mac
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}
