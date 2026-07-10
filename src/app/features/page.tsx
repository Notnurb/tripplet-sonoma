'use client';

import { LandingHeader } from '@/components/ui/landing-header';
import { LandingFooter } from '@/components/ui/landing-footer';
import { motion } from 'framer-motion';
import { MessageSquare, Code2, BrainCircuit, Search, Check, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const features = [
    {
        id: 'chat',
        icon: MessageSquare,
        label: 'AI Chat',
        title: 'Conversations that actually go somewhere',
        description:
            'Four specialized models — Astro, Taipei, Majuli, and Suzhou — each purpose-built for different workloads. Context that persists. Reasoning you can follow.',
        benefits: [
            'Extended Thinking for complex multi-step problems',
            'Composable skills: Think, Deep Research, Study, and more',
            'Conversations organized automatically by topic',
            'Markdown, code blocks, and LaTeX rendered natively',
        ],
        stat: { value: '4', label: 'specialized models' },
        visual: <ChatVisual />,
    },
    {
        id: 'code',
        icon: Code2,
        label: 'Code Workspace',
        title: 'From idea to deployed app in minutes',
        description:
            'Describe what you want to build. Tripplet writes the code, shows you a live preview, and deploys it with one click. No scaffolding. No context-switching.',
        benefits: [
            'Multi-file editor with syntax highlighting',
            'Live browser preview updates as you chat',
            'One-click deploy to a public URL',
            'Supports React, HTML, Tailwind, and more',
        ],
        stat: { value: '1-click', label: 'deploy to a public URL' },
        visual: <CodeVisual />,
    },
    {
        id: 'thinking',
        icon: BrainCircuit,
        label: 'Extended Thinking',
        title: 'Watch the model reason before it responds',
        description:
            'When you toggle Extended Thinking, Taipei 4 allocates a reasoning budget before forming its answer. Complex proofs, architecture decisions, and debugging get real depth instead of a fast guess.',
        benefits: [
            'Dedicated reasoning pass before the visible answer',
            'Adaptive depth — simple questions stay fast',
            'Best for: math, code architecture, research synthesis',
            'Off by default — toggle when you need depth',
        ],
        stat: { value: 'On-demand', label: 'deeper reasoning' },
        visual: <ThinkingVisual />,
    },
    {
        id: 'search',
        icon: Search,
        label: 'Web Search',
        title: 'Always current, always cited',
        description:
            'Tripplet can search the web, pull relevant sources, and weave current information into its response — with expandable citations so you can verify every claim.',
        benefits: [
            'Live web results whenever search is on',
            'Source cards with expandable previews',
            'Cited inline so you know what came from where',
            'Combine search with reasoning for deep research',
        ],
        stat: { value: '8', label: 'sources per search' },
        visual: <SearchVisual />,
    },
];

// ─── Visual Mockups ──────────────────────────────────────

function ChatVisual() {
    return (
        <div className="aspect-[4/3] rounded-2xl border border-border bg-card p-5 overflow-hidden">
            <div className="space-y-4 h-full flex flex-col justify-center">
                <div className="flex justify-end">
                    <div className="bg-foreground/10 rounded-2xl rounded-br-md px-4 py-2.5 text-xs max-w-[72%] text-foreground/80">
                        How do I implement rate limiting in a Next.js API route?
                    </div>
                </div>
                <div className="flex gap-2.5">
                    <div className="h-6 w-6 shrink-0 rounded-full bg-foreground/10 flex items-center justify-center text-[9px] font-bold">T</div>
                    <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-2.5 text-xs max-w-[78%] text-muted-foreground space-y-1.5">
                        <p>Here&apos;s a clean approach using an in-memory store with sliding window...</p>
                        <div className="rounded-lg bg-background/60 px-3 py-2 font-mono text-[10px] text-foreground/70">
                            <div><span className="text-violet-400/80">const</span> rateLimit = <span className="text-emerald-400/80">new</span> Map()</div>
                        </div>
                    </div>
                </div>
                <div className="flex justify-end">
                    <div className="bg-foreground/10 rounded-2xl rounded-br-md px-4 py-2.5 text-xs max-w-[60%] text-foreground/80">
                        Can you add Redis support?
                    </div>
                </div>
            </div>
        </div>
    );
}

function CodeVisual() {
    return (
        <div className="aspect-[4/3] rounded-2xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-1.5 border-b border-border bg-muted/40 px-4 py-2.5">
                <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
                <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
                <div className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
                <span className="ml-3 text-[10px] text-muted-foreground">components/Hero.tsx</span>
            </div>
            <div className="p-4 font-mono text-[10px] space-y-1 text-muted-foreground">
                <div><span className="text-violet-400/80">export default function</span> <span className="text-amber-400/80">Hero</span>() &#123;</div>
                <div className="pl-4"><span className="text-violet-400/80">return</span> (</div>
                <div className="pl-8">&lt;<span className="text-emerald-400/80">section</span> <span className="text-amber-400/80">className</span>=<span className="text-rose-400/80">&quot;hero&quot;</span>&gt;</div>
                <div className="pl-12">&lt;<span className="text-emerald-400/80">h1</span>&gt;Build faster&lt;/<span className="text-emerald-400/80">h1</span>&gt;</div>
                <div className="pl-8">&lt;/<span className="text-emerald-400/80">section</span>&gt;</div>
                <div className="pl-4">)</div>
                <div>&#125;</div>
            </div>
        </div>
    );
}

function ThinkingVisual() {
    return (
        <div className="aspect-[4/3] rounded-2xl border border-border bg-card p-5 space-y-3">
            <div className="flex items-center gap-2">
                <div className="h-5 w-5 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                    <BrainCircuit className="h-3 w-3 text-amber-500/70" />
                </div>
                <span className="text-[10px] font-medium text-amber-500/70">Extended Thinking active</span>
            </div>
            <div className="rounded-xl bg-amber-500/5 border border-amber-500/10 p-3 space-y-1.5">
                <p className="text-[10px] text-muted-foreground/60 italic">Let me break this down step by step...</p>
                <p className="text-[10px] text-muted-foreground/60 italic">First, consider the constraint that n must be positive...</p>
                <p className="text-[10px] text-muted-foreground/60 italic">The recurrence relation simplifies to...</p>
            </div>
            <div className="rounded-xl bg-muted/40 border border-border p-3">
                <p className="text-[10px] text-muted-foreground">The answer is O(n log n). Here&apos;s the complete proof...</p>
            </div>
        </div>
    );
}

function SearchVisual() {
    return (
        <div className="aspect-[4/3] rounded-2xl border border-border bg-card p-5 space-y-3">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">latest llm benchmarks 2026</span>
            </div>
            <div className="space-y-2">
                {['techcrunch.com', 'arxiv.org', 'theverge.com'].map((source) => (
                    <div key={source} className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/20 px-3 py-2">
                        <div className="h-4 w-4 rounded bg-foreground/10 shrink-0" />
                        <div>
                            <div className="text-[10px] font-medium text-foreground/70">{source}</div>
                            <div className="text-[9px] text-muted-foreground mt-0.5">Cited in response</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Page ────────────────────────────────────────────────
export default function Features() {
    return (
        <div className="flex min-h-screen w-full flex-col bg-background grain-overlay relative">
            <LandingHeader />

            <main className="grow">
                {/* Hero */}
                <section className="mx-auto w-full max-w-5xl px-4 pt-32 pb-20 md:pt-40 md:pb-28 text-center">
                    <motion.p
                        initial={{ opacity: 0, y: 16, filter: 'blur(8px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        transition={{ duration: 0.6, delay: 0.1, ease }}
                        className="mb-4 text-sm font-medium text-muted-foreground"
                    >
                        Features
                    </motion.p>
                    <motion.h1
                        initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        transition={{ duration: 0.7, delay: 0.2, ease }}
                        className="gradient-text text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl"
                    >
                        Five tools. One interface.
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        transition={{ duration: 0.6, delay: 0.3, ease }}
                        className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground"
                    >
                        Stop switching between apps. Chat, code, create images, and search the web — all in one place, powered by three specialized AI models.
                    </motion.p>

                    <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.4, ease }}
                        className="mt-8 flex flex-wrap justify-center gap-2"
                    >
                        {features.map((f) => (
                            <a
                                key={f.id}
                                href={`#${f.id}`}
                                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:border-foreground/20 hover:text-foreground hover:bg-muted/50"
                            >
                                <f.icon className="h-3.5 w-3.5" />
                                {f.label}
                            </a>
                        ))}
                    </motion.div>
                </section>

                {/* Feature blocks */}
                <div className="divide-y divide-border border-t border-border">
                    {features.map((feature, i) => {
                        const isEven = i % 2 === 0;
                        return (
                            <section
                                key={feature.id}
                                id={feature.id}
                                className="mx-auto w-full max-w-5xl px-4 py-20 md:py-28"
                            >
                                <div className={cn(
                                    'grid items-center gap-12 md:grid-cols-2 md:gap-16',
                                    !isEven && 'md:[&>:first-child]:order-last',
                                )}>
                                    {/* Content */}
                                    <motion.div
                                        initial={{ opacity: 0, x: isEven ? -28 : 28, filter: 'blur(6px)' }}
                                        whileInView={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                                        viewport={{ once: true, margin: '-60px' }}
                                        transition={{ duration: 0.7, ease }}
                                    >
                                        {/* Label */}
                                        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
                                            <feature.icon className="h-3.5 w-3.5" />
                                            {feature.label}
                                        </div>

                                        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
                                            {feature.title}
                                        </h2>
                                        <p className="mt-4 text-muted-foreground leading-relaxed">
                                            {feature.description}
                                        </p>

                                        {/* Benefits */}
                                        <ul className="mt-6 space-y-2.5">
                                            {feature.benefits.map((b) => (
                                                <li key={b} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                                                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                                                    {b}
                                                </li>
                                            ))}
                                        </ul>

                                        {/* Stat + CTA */}
                                        <div className="mt-8 flex items-center gap-4">
                                            <div className="rounded-2xl border border-border bg-card px-4 py-3 text-center">
                                                <div className="text-xl font-bold">{feature.stat.value}</div>
                                                <div className="mt-0.5 text-[11px] text-muted-foreground">{feature.stat.label}</div>
                                            </div>
                                            <Link href="/chat">
                                                <Button variant="outline" className="rounded-full group">
                                                    Try {feature.label}
                                                    <ArrowRight className="ml-2 h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                                                </Button>
                                            </Link>
                                        </div>
                                    </motion.div>

                                    {/* Visual */}
                                    <motion.div
                                        initial={{ opacity: 0, x: isEven ? 28 : -28, scale: 0.97 }}
                                        whileInView={{ opacity: 1, x: 0, scale: 1 }}
                                        viewport={{ once: true, margin: '-60px' }}
                                        transition={{ duration: 0.7, delay: 0.1, ease }}
                                        whileHover={{ scale: 1.02, transition: { duration: 0.3 } }}
                                    >
                                        {feature.visual}
                                    </motion.div>
                                </div>
                            </section>
                        );
                    })}
                </div>

                {/* CTA */}
                <section className="mx-auto w-full max-w-5xl border-t border-border px-4 py-20 md:py-28">
                    <motion.div
                        initial={{ opacity: 0, y: 24, filter: 'blur(8px)' }}
                        whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.7, ease }}
                        className="flex flex-col items-center text-center"
                    >
                        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
                            See it in action
                        </h2>
                        <p className="mt-3 max-w-md text-muted-foreground">
                            No setup. No tutorial required. Just open Tripplet and start building.
                        </p>
                        <div className="mt-8 flex flex-wrap justify-center gap-3">
                            <Link href="/chat">
                                <Button size="lg" className="rounded-full group">
                                    Start chatting free
                                    <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                                </Button>
                            </Link>
                        </div>
                    </motion.div>
                </section>
            </main>

            <LandingFooter />
        </div>
    );
}
