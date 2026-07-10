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

const timeline = [
    {
        date: 'January 2020',
        title: 'Notnurb',
        description: 'It all started here — a partial AI company and Minecraft server host. Yes, we hosted Minecraft servers. Everyone starts somewhere.',
    },
    {
        date: 'November 2020',
        title: 'Partial Shutdown',
        description: 'The first hibernation. Sometimes you gotta take a nap before you can run faster.',
    },
    {
        date: 'September 2021',
        title: 'Alex SMP',
        description: 'Renamed to Alex SMP (Super Magnificent Project). The name was super. The name was magnificent. The name was... a project.',
    },
    {
        date: 'December 2021',
        title: 'Partial Shutdown',
        description: 'Another pause. Like a TV show between seasons — the plot was still cooking.',
    },
    {
        date: 'January 2022',
        title: 'ASA',
        description: 'Reborn as ASA (Alex, Sam, Antonio) — now officially an AI research company. The Minecraft days were behind us.',
    },
    {
        date: 'September 2023',
        title: 'Nova',
        description: 'Renamed to Nova, and launched Nova Earth — an interactive web browser that planted trees and led to community service. AI meets environmentalism.',
    },
    {
        date: 'Dec 2023 – Sep 2025',
        title: 'The Long Shutdown',
        description: 'Nearly two years of silence. The longest intermission yet. But behind the scenes, something big was brewing.',
    },
    {
        date: 'October 2025',
        title: 'Synthara 1',
        description: 'We came back swinging. Synthara 1 dropped — our first real AI model. The dream was finally real.',
    },
    {
        date: 'Early November 2025',
        title: 'Synthara 2.5',
        description: 'Synthara 2.5 arrived fast. We were on a roll and the models were getting smarter by the week.',
    },
    {
        date: 'Late November 2025',
        title: 'Synthara 5.2',
        description: 'Synthara 5.2 dropped. Version numbers were moving faster than a speedrunner on caffeine.',
    },
    {
        date: 'January 2026',
        title: 'Synthara 8 Plus',
        description: 'Synthara 8 Plus launched. We tried to make Synthara 8 Pro too, but some things weren\'t meant to be.',
    },
    {
        date: 'Late January 2026',
        title: 'Synthara Deprecated',
        description: 'Synthara was officially sunset. It served us well, but it was time for something bigger.',
    },
    {
        date: 'Early February 2026',
        title: 'Tripplet is Born',
        description: 'Renamed to Tripplet and launched Agent 1. A brand new identity, a brand new era of AI.',
    },
    {
        date: 'Mid February 2026',
        title: 'Agent 1.5',
        description: 'Agent 1.5 shipped — smarter, faster, and better at understanding what you actually need.',
    },
    {
        date: 'Late February 2026',
        title: 'Taipei 2.5',
        description: 'Taipei 2.5 entered the scene. Our flagship reasoning model was just getting started.',
    },
    {
        date: 'May 16, 2026',
        title: 'Taipei 3.1',
        description: 'Taipei 3.1 dropped — the most advanced model in the Tripplet family. And we\'re just getting warmed up.',
    },
    {
        date: 'Mid 2026',
        title: 'The Sonoma Era',
        description: 'The Sonoma release rebuilt the platform around one workspace — chat, code, and Triplepedia — and introduced the current model family, led by our flagship, Astro 5.',
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

                {/* Timeline */}
                <section className="border-t border-border">
                    <div className="mx-auto w-full max-w-3xl px-4 py-20 md:py-28">
                        <motion.div
                            initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
                            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.6, ease }}
                            className="text-center mb-14"
                        >
                            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Timeline</h2>
                            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground leading-relaxed">
                                Tripplet has an unusually long, unusually honest history. It started in
                                January 2020 as Notnurb — part hobby AI experiment, part Minecraft server
                                host — and spent six years being renamed, paused, and rebooted before
                                becoming what it is today. What follows is the unedited version:
                                shutdowns, dead ends, and all.
                            </p>
                        </motion.div>

                        <div className="relative">
                            {/* Animated vertical line */}
                            <motion.div
                                className="absolute left-4 top-0 bottom-0 w-px bg-border md:left-1/2"
                                initial={{ scaleY: 0, originY: 0 }}
                                whileInView={{ scaleY: 1 }}
                                viewport={{ once: true }}
                                transition={{ duration: 1.2, ease }}
                            />

                            <div className="space-y-10">
                                {timeline.map((item, i) => (
                                    <motion.div
                                        key={item.title}
                                        initial={{ opacity: 0, x: i % 2 === 0 ? -24 : 24, filter: 'blur(4px)' }}
                                        whileInView={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                                        viewport={{ once: true, margin: '-40px' }}
                                        transition={{ duration: 0.6, delay: i * 0.12, ease }}
                                        className="relative pl-12 md:pl-0 md:grid md:grid-cols-2 md:gap-8"
                                    >
                                        {/* Animated dot */}
                                        <motion.div
                                            className="absolute left-2.5 top-1.5 h-3 w-3 rounded-full border-2 border-border bg-background md:left-1/2 md:-translate-x-1.5"
                                            initial={{ scale: 0 }}
                                            whileInView={{ scale: 1 }}
                                            viewport={{ once: true }}
                                            transition={{ duration: 0.4, delay: i * 0.12 + 0.2, type: 'spring', stiffness: 300 }}
                                        />
                                        <div className={i % 2 === 0 ? 'md:text-right' : 'md:col-start-2'}>
                                            <span className="text-xs font-medium text-muted-foreground">{item.date}</span>
                                            <h3 className="mt-1 font-semibold">{item.title}</h3>
                                            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{item.description}</p>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>
            </main>

            <LandingFooter />
        </div>
    );
}
