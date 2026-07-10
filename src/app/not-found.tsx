'use client';

import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LandingHeader } from '@/components/ui/landing-header';

export default function NotFound() {
    return (
        <div className="flex min-h-screen w-full flex-col bg-background grain-overlay relative">
            <LandingHeader />

            <main className="grow flex items-center justify-center px-4">
                <div className="flex flex-col items-center text-center max-w-md">
                    <motion.div
                        initial={{ opacity: 0, y: -16, rotate: -8 }}
                        animate={{ opacity: 1, y: 0, rotate: 0 }}
                        transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
                        className="mb-6"
                    >
                        <motion.div
                            animate={{ rotate: [0, -6, 6, -4, 4, 0] }}
                            transition={{ duration: 1.2, delay: 0.8, ease: 'easeInOut' }}
                        >
                            <Image
                                src="/trilo-jaw.png"
                                alt="Trilo is shocked"
                                width={120}
                                height={120}
                                className="drop-shadow-2xl"
                            />
                        </motion.div>
                    </motion.div>

                    <motion.p
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.15 }}
                        className="text-[11px] font-bold tracking-widest text-muted-foreground/50 uppercase mb-3"
                    >
                        404 — Page not found
                    </motion.p>

                    <motion.h1
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.22 }}
                        className="text-3xl font-bold tracking-tight mb-3"
                    >
                        Trilo has no idea where this is.
                    </motion.h1>

                    <motion.p
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.3 }}
                        className="text-muted-foreground text-sm leading-relaxed mb-8"
                    >
                        That page doesn&apos;t exist — or maybe it got lost in the void. Either way, Trilo is just as confused as you are.
                    </motion.p>

                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.38 }}
                        className="flex gap-3 flex-wrap justify-center"
                    >
                        <Link href="/chat">
                            <Button className="rounded-full group/btn">
                                Go to Chat
                                <ArrowRight className="ml-2 size-4 transition-transform duration-200 group-hover/btn:translate-x-0.5" />
                            </Button>
                        </Link>
                        <Link href="/">
                            <Button variant="outline" className="rounded-full">
                                Back to home
                            </Button>
                        </Link>
                    </motion.div>
                </div>
            </main>
        </div>
    );
}
