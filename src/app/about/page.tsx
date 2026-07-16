'use client';

import Image from 'next/image';
import { LandingHeader } from '@/components/ui/landing-header';
import { LandingFooter } from '@/components/ui/landing-footer';
import { motion } from 'framer-motion';
import { Target, Heart, Rocket, Users, Globe, Lightbulb } from 'lucide-react';

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const values = [
    {
        icon: Target,
        title: 'Mission-Driven',
        description: 'Every feature we build starts with a question: does this make AI more useful and accessible to real people?',
    },
    {
        icon: Heart,
        title: 'User-First',
        description: 'We obsess over the details — from response quality to interface polish — because our users deserve the best.',
    },
    {
        icon: Rocket,
        title: 'Ship Fast',
        description: 'We move quickly, iterate openly, and release weekly. Perfect is the enemy of good, and good is what ships.',
    },
    {
        icon: Lightbulb,
        title: 'Creative Freedom',
        description: 'AI should amplify creativity, not constrain it. We build tools that adapt to how you think, not the other way around.',
    },
    {
        icon: Globe,
        title: 'Transparent by Default',
        description: 'Our history is published unedited — renames, shutdowns, dead ends and all. Trust is earned with receipts, not claims.',
    },
    {
        icon: Users,
        title: 'Community',
        description: 'Our best ideas come from the people using our platform every day. Feedback shapes our roadmap.',
    },
];

const pillars = [
    { value: '4', label: 'AI models', note: 'Astro · Taipei · Majuli · Suzhou' },
    { value: '2020', label: 'Founded', note: 'From Minecraft host to AI platform' },
    { value: 'MCP', label: 'Connectable', note: 'Plug Tripplet into other AI tools' },
    { value: 'Free', label: 'To start', note: 'No account or credit card required' },
];


export default function About() {
    return (
        <div className="flex min-h-screen w-full flex-col bg-background grain-overlay relative">
            <LandingHeader />

            <main className="grow">
                {/* Hero */}
                <section className="mx-auto w-full max-w-5xl px-4 pt-32 pb-20 md:pt-40 md:pb-28">
                    <div className="text-center">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.5, delay: 0.05, ease }}
                            className="flex justify-center mb-4"
                        >
                            <Image src="/trilo-laying.png" alt="Trilo chilling" width={90} height={90} className="drop-shadow-xl" />
                        </motion.div>
                        <motion.p
                            initial={{ opacity: 0, y: 16, filter: 'blur(8px)' }}
                            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                            transition={{ duration: 0.6, delay: 0.1, ease }}
                            className="text-sm font-medium text-muted-foreground mb-4"
                        >
                            About Tripplet
                        </motion.p>
                        <motion.h1
                            initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
                            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                            transition={{ duration: 0.7, delay: 0.2, ease }}
                            className="gradient-text text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl"
                        >
                            AI that works the way <br className="hidden sm:block" /> you think
                        </motion.h1>
                        <motion.p
                            initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
                            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                            transition={{ duration: 0.7, delay: 0.35, ease }}
                            className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground leading-relaxed"
                        >
                            Tripplet is a unified AI workspace for chat, code, and research — designed to feel
                            intuitive from the first message.
                        </motion.p>
                    </div>
                </section>

                {/* Pillars */}
                <section className="border-y border-border">
                    <div className="mx-auto grid w-full max-w-5xl grid-cols-2 md:grid-cols-4">
                        {pillars.map((p, i) => (
                            <motion.div
                                key={p.label}
                                initial={{ opacity: 0, scale: 0.9 }}
                                whileInView={{ opacity: 1, scale: 1 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.5, delay: i * 0.1, ease }}
                                className="flex flex-col items-center py-10 border-r border-border last:border-r-0 [&:nth-child(2)]:border-r-0 md:[&:nth-child(2)]:border-r"
                            >
                                <span className="text-3xl font-bold tabular-nums">{p.value}</span>
                                <span className="mt-1 text-sm font-medium text-foreground">{p.label}</span>
                                <span className="mt-0.5 text-xs text-muted-foreground">{p.note}</span>
                            </motion.div>
                        ))}
                    </div>
                </section>

                {/* Our Story */}
                <section className="mx-auto w-full max-w-5xl px-4 py-20 md:py-28">
                    <div className="grid gap-12 md:grid-cols-2 md:gap-16 items-start">
                        <motion.div
                            initial={{ opacity: 0, x: -30, filter: 'blur(6px)' }}
                            whileInView={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                            viewport={{ once: true, margin: '-60px' }}
                            transition={{ duration: 0.7, ease }}
                        >
                            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Our story</h2>
                            <div className="mt-5 space-y-4 text-muted-foreground leading-relaxed">
                                <p>
                                    Tripplet started because existing AI tools felt fragmented. You needed one app for chat, another for images,
                                    another for code. Switching between them broke your flow and wasted time.
                                </p>
                                <p>
                                    We built Tripplet to bring everything into one place — a single interface where you can have a conversation,
                                    scaffold an entire application with a live preview, and dig into a fact-checked knowledge base without
                                    switching tools.
                                </p>
                                <p>
                                    Our lineup — Astro, Taipei, Majuli, and Suzhou — is purpose-built for different workloads. Astro 5 is
                                    the flagship, with the most reasoning and range. Taipei handles complex analysis, Majuli optimizes for
                                    speed, and Suzhou leans creative. You pick the right tool for the job, or let Tripplet decide.
                                </p>
                            </div>
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0, x: 30, filter: 'blur(6px)' }}
                            whileInView={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                            viewport={{ once: true, margin: '-60px' }}
                            transition={{ duration: 0.7, delay: 0.15, ease }}
                        >
                            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">What we believe</h2>
                            <div className="mt-5 space-y-4 text-muted-foreground leading-relaxed">
                                <p>
                                    AI should be a creative partner, not a black box. When Tripplet generates something, you should understand
                                    why it made those choices and be able to steer it in a different direction.
                                </p>
                                <p>
                                    We believe in shipping openly. Tripplet is released under the Unlicense — anyone can use, modify, and
                                    distribute it. Open technology raises the floor for everyone.
                                </p>
                                <p>
                                    We also believe speed matters. Not just model response time, but the speed at which you can go from
                                    idea to output. Every interaction in Tripplet is designed to minimize friction.
                                </p>
                            </div>
                        </motion.div>
                    </div>
                </section>

                {/* Values */}
                <section className="border-t border-border">
                    <div className="mx-auto w-full max-w-5xl px-4 py-20 md:py-28">
                        <motion.div
                            initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
                            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.6, ease }}
                            className="text-center mb-12"
                        >
                            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Our values</h2>
                            <p className="mt-3 text-muted-foreground">The principles that guide everything we build.</p>
                        </motion.div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {values.map((value, i) => (
                                <motion.div
                                    key={value.title}
                                    initial={{ opacity: 0, y: 28, scale: 0.96 }}
                                    whileInView={{ opacity: 1, y: 0, scale: 1 }}
                                    viewport={{ once: true, margin: '-30px' }}
                                    transition={{ duration: 0.5, delay: i * 0.07, ease }}
                                    whileHover={{ y: -3, transition: { duration: 0.25 } }}
                                    className="rounded-2xl border border-border bg-card p-6 card-hover"
                                >
                                    <motion.div
                                        className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background"
                                        whileHover={{ scale: 1.1, rotate: 5 }}
                                        transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                                    >
                                        <value.icon className="h-5 w-5 text-muted-foreground" />
                                    </motion.div>
                                    <h3 className="text-sm font-semibold">{value.title}</h3>
                                    <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{value.description}</p>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </section>

</main>

            <LandingFooter />
        </div>
    );
}
