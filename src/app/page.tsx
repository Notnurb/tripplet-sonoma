'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { LandingHeader as Header } from '@/components/ui/landing-header';
import { ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { TabVisibility } from '@/components/ui/tab-visibility';
import { Typewriter } from '@/components/ui/typewriter';
import { SKY_BLUR } from '@/lib/blur-placeholders';

const ease = [0.25, 0.46, 0.45, 0.94] as const;

function BlurFade({ children, delay = 0, className, ...props }: { children: React.ReactNode; delay?: number; className?: string; [key: string]: unknown }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 24, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.7, delay, ease }}
            className={className}
            {...props}
        >
            {children}
        </motion.div>
    );
}

function useTimeGreeting() {
    const [greeting, setGreeting] = useState<string | null>(null);
    useEffect(() => {
        const h = new Date().getHours();
        if (h >= 5 && h < 12) setGreeting('Good morning');
        else if (h >= 12 && h < 17) setGreeting('Good afternoon');
        else if (h >= 17 && h < 21) setGreeting('Good evening');
        else setGreeting(null);
    }, []);
    return greeting;
}

export default function Landing() {
    const greeting = useTimeGreeting();

    return (
        <div className="relative h-screen w-full overflow-hidden flex flex-col">
            {/* Sky background — full-bleed, clips at bottom */}
            <div className="absolute inset-0 z-0">
                <Image
                    src="/sky-clouds.jpg"
                    alt=""
                    fill
                    priority
                    sizes="100vw"
                    placeholder="blur"
                    blurDataURL={SKY_BLUR}
                    className="object-cover object-top"
                />
                {/* Subtle scrim for text legibility */}
                <div className="absolute inset-0 bg-black/15" />
            </div>

            <TabVisibility message="👋 Come back — your AI is waiting" />
            <Header />

            <main className="relative z-10 flex flex-1 flex-col items-center justify-center w-full px-6 text-center">
                {greeting && (
                    <motion.p
                        initial={{ opacity: 0, y: -8, filter: 'blur(6px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        transition={{ duration: 0.6, delay: 0.05, ease }}
                        className="mb-4 text-sm font-medium tracking-wide text-white/80"
                    >
                        {greeting}.
                    </motion.p>
                )}

                {/* Heading */}
                <BlurFade delay={0.2} className="mb-6">
                    <h1 className="text-balance text-center text-4xl font-bold tracking-tight text-white drop-shadow-lg md:text-5xl lg:text-7xl">
                        Intelligence built to{' '}
                        <Typewriter
                            text={['create.', 'code.', 'search.', 'think.', 'never stop.']}
                            speed={65}
                            deleteSpeed={38}
                            waitTime={1800}
                            cursorChar="_"
                            cursorClassName="ml-0.5 opacity-50"
                            className="text-white/60"
                        />
                    </h1>
                </BlurFade>

                {/* Value prop */}
                <BlurFade delay={0.35} className="mb-4">
                    <p className="mx-auto max-w-lg text-center text-base text-white/85 drop-shadow md:text-lg">
                        One workspace for chat, code, and research — free to start, no account required.
                    </p>
                </BlurFade>

                {/* What-is-this blurb for first-time visitors */}
                <BlurFade delay={0.45} className="mb-8">
                    <p className="mx-auto max-w-xl text-center text-sm text-white/65 drop-shadow md:text-base">
                        Tripplet is a small, independent AI platform. Talk to four specialized
                        models led by Astro 5, build and deploy web apps from a live preview,
                        and browse Triplepedia — an encyclopedia where every article is
                        AI fact-checked before it publishes.
                    </p>
                </BlurFade>

                {/* CTAs */}
                <BlurFade delay={0.5}>
                    <div className="flex flex-col items-center gap-3">
                        <div className="flex flex-row flex-wrap items-center justify-center gap-3">
                            <Link href="/chat">
                                <Button className="group/btn rounded-full" size="lg">
                                    Start chatting
                                    <ArrowRight className="ml-2 size-4 transition-transform duration-200 group-hover/btn:translate-x-0.5" />
                                </Button>
                            </Link>
                            <Link href="/login">
                                <Button
                                    size="lg"
                                    variant="secondary"
                                    className="rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-md hover:bg-white/20"
                                >
                                    Sign in
                                </Button>
                            </Link>
                        </div>
                        <p className="text-xs text-white/50">No account needed. Jump straight in.</p>
                    </div>
                </BlurFade>
            </main>
        </div>
    );
}
