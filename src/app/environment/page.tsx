'use client';

import Link from 'next/link';
import Image from 'next/image';
import { LandingHeader } from '@/components/ui/landing-header';
import { LandingFooter } from '@/components/ui/landing-footer';
import { motion } from 'framer-motion';
import {
    Leaf,
    Droplets,
    Zap,
    Wind,
    Recycle,
    CloudRain,
    ArrowRight,
    FileText,
    Cpu,
    GitBranch,
    Gauge,
    MessageSquareDashed,
    Check,
    Minus,
    MapPin,
    FlaskConical,
    ScrollText,
} from 'lucide-react';

const ease = [0.25, 0.46, 0.45, 0.94] as const;

// ─── SVG Illustrations ────────────────────────────────────────────────────────

function EarthIllustration({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 200 200" fill="none" className={className} aria-hidden>
            <circle cx="100" cy="100" r="90" className="fill-emerald-500/5 stroke-emerald-500/20" strokeWidth="1.5" />
            <circle cx="100" cy="100" r="70" className="fill-emerald-500/[0.03] stroke-emerald-500/10" strokeWidth="1" />
            {/* Continents - simplified abstract shapes */}
            <path d="M70 55 Q80 40 100 42 Q115 44 120 58 Q125 72 110 78 Q95 84 80 75 Q65 66 70 55Z" className="fill-emerald-400/15" />
            <path d="M55 90 Q65 82 78 88 Q85 92 82 105 Q78 118 65 115 Q50 110 55 90Z" className="fill-emerald-400/10" />
            <path d="M110 95 Q125 88 140 95 Q148 105 142 118 Q135 128 120 125 Q108 120 105 108 Q102 98 110 95Z" className="fill-emerald-400/12" />
            <path d="M85 130 Q95 122 108 128 Q115 135 110 145 Q100 152 90 148 Q80 142 85 130Z" className="fill-emerald-400/8" />
            {/* Atmosphere ring */}
            <circle cx="100" cy="100" r="95" className="stroke-emerald-400/10" strokeWidth="0.5" strokeDasharray="4 6" />
        </svg>
    );
}

function WaterCycleIllustration({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 300 180" fill="none" className={className} aria-hidden>
            {/* Ground */}
            <path d="M0 150 Q75 135 150 145 Q225 155 300 140 L300 180 L0 180Z" className="fill-emerald-500/5" />
            {/* Water body */}
            <ellipse cx="80" cy="155" rx="55" ry="12" className="fill-blue-400/10 stroke-blue-400/15" strokeWidth="1" />
            {/* Evaporation arrows */}
            <path d="M60 140 L60 100" className="stroke-blue-400/20" strokeWidth="1.5" strokeDasharray="3 4" />
            <path d="M80 138 L80 95" className="stroke-blue-400/20" strokeWidth="1.5" strokeDasharray="3 4" />
            <path d="M100 140 L100 105" className="stroke-blue-400/20" strokeWidth="1.5" strokeDasharray="3 4" />
            {/* Cloud */}
            <ellipse cx="150" cy="55" rx="45" ry="22" className="fill-muted-foreground/5 stroke-muted-foreground/15" strokeWidth="1" />
            <ellipse cx="135" cy="50" rx="25" ry="18" className="fill-muted-foreground/5" />
            <ellipse cx="170" cy="52" rx="20" ry="15" className="fill-muted-foreground/5" />
            {/* Rain drops */}
            <line x1="220" y1="78" x2="215" y2="100" className="stroke-blue-400/20" strokeWidth="1.5" />
            <line x1="235" y1="82" x2="230" y2="105" className="stroke-blue-400/20" strokeWidth="1.5" />
            <line x1="250" y1="75" x2="245" y2="98" className="stroke-blue-400/20" strokeWidth="1.5" />
            {/* Curved arrow showing cycle */}
            <path d="M100 100 Q120 60 150 55" className="stroke-emerald-400/20" strokeWidth="1" fill="none" />
            <path d="M195 65 Q230 70 240 110" className="stroke-emerald-400/20" strokeWidth="1" fill="none" />
            {/* Tree */}
            <rect x="250" y="128" width="4" height="22" rx="2" className="fill-emerald-400/20" />
            <circle cx="252" cy="120" r="12" className="fill-emerald-400/10" />
            {/* Data center simplified */}
            <rect x="160" y="132" width="30" height="18" rx="3" className="fill-muted-foreground/8 stroke-muted-foreground/15" strokeWidth="1" />
            <rect x="164" y="136" width="6" height="3" rx="1" className="fill-emerald-400/20" />
            <rect x="172" y="136" width="6" height="3" rx="1" className="fill-emerald-400/20" />
            <rect x="180" y="136" width="6" height="3" rx="1" className="fill-emerald-400/20" />
        </svg>
    );
}

function LeafPattern({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 120 120" fill="none" className={className} aria-hidden>
            <path d="M60 10 Q85 25 80 55 Q75 85 60 95 Q45 85 40 55 Q35 25 60 10Z" className="fill-emerald-400/8 stroke-emerald-400/15" strokeWidth="1" />
            <path d="M60 25 L60 85" className="stroke-emerald-400/10" strokeWidth="0.8" />
            <path d="M60 40 L48 32" className="stroke-emerald-400/8" strokeWidth="0.6" />
            <path d="M60 50 L72 42" className="stroke-emerald-400/8" strokeWidth="0.6" />
            <path d="M60 60 L46 52" className="stroke-emerald-400/8" strokeWidth="0.6" />
            <path d="M60 70 L74 62" className="stroke-emerald-400/8" strokeWidth="0.6" />
        </svg>
    );
}

// ─── Data ─────────────────────────────────────────────────────────────────────

// Industry context numbers — explicitly NOT Tripplet's own measurements.
const stats = [
    {
        value: '~0.5L',
        label: 'Water per AI conversation (5–50 prompts)',
        note: 'Li et al., UC Riverside 2023 — GPT-3.5 on Azure, an estimate',
    },
    {
        value: '+34%',
        label: 'Microsoft water increase, 2021–2022',
        note: 'Microsoft Sustainability Report 2022',
    },
    {
        value: '~1.5%',
        label: 'Of global electricity used by data centers',
        note: 'IEA, 2024',
    },
    {
        value: '5.6B',
        label: 'Gallons across all Google data centers, 2022',
        note: 'Google Environmental Report 2023',
    },
];

// What we can honestly stand behind vs. what we can't (yet).
const canClaim = [
    'We add zero model-training footprint — we reuse open-weight models by merging',
    'Our footprint is inference only: one model call per message, and it goes to our servers',
    'Lighter models for lighter jobs (guests default to our Astro 5)',
    'Concise mode genuinely cuts tokens, time, and energy per reply',
    'Open source under the Unlicense, so others don’t re-build from scratch',
];

const cantClaim = [
    'A precise per-chat number for water or energy',
    'That our providers run on 100% renewable energy',
    'Direct control over how our inference hardware is cooled or powered',
    'Independently audited, Tripplet-specific environmental data',
];

// Things that are genuinely true about how Tripplet is built.
const whatWeDo = [
    {
        icon: Recycle,
        title: 'Reuse, don’t retrain',
        description:
            'Taipei, Majuli, Suzhou, and Astro are built on open-weight models that were trained once, by someone else. We never spin up a training run — so the heaviest part of AI’s footprint simply isn’t ours to add.',
    },
    {
        icon: Gauge,
        title: 'Right-sized models',
        description:
            'Not every question needs the biggest model. Guests run on our smallest model by default, Majuli handles fast/concise work, and the heavyweight reasoning models are there when a task actually needs them.',
    },
    {
        icon: Cpu,
        title: 'Efficient inference hardware',
        description:
            'Our default inference provider builds inference-specialized chips designed for high throughput per watt. We can’t independently audit their grid mix — but efficient-by-design hardware is a real lever, not a slogan.',
    },
    {
        icon: MessageSquareDashed,
        title: 'Less waste per request',
        description:
            'We cap streaming timeouts so hung requests don’t burn compute forever, cache system prompts, skip pointless retries, and trim output length on fast models. Small engineering choices, repeated millions of times.',
    },
    {
        icon: GitBranch,
        title: 'Open by default',
        description:
            'Tripplet is released into the public domain under the Unlicense. Shared code means other builders extend our work instead of re-deriving and re-running the same compute from zero.',
    },
    {
        icon: Leaf,
        title: 'Environmental roots',
        description:
            'Before Tripplet, our team shipped Nova Earth in 2023 — a browser that planted trees and nudged people toward community service. Caring about this isn’t a marketing pivot; it predates the company’s current name.',
    },
];

const waterCycleSteps = [
    {
        icon: Droplets,
        title: 'Servers get hot, so they’re cooled with water',
        description:
            'Running model inference generates heat. Many data centers use evaporative cooling, drawing on local rivers, aquifers, or municipal supply to carry that heat away — the same physics that lets sweating cool you down.',
    },
    {
        icon: CloudRain,
        title: 'That water evaporates — it isn’t destroyed',
        description:
            'The water turns to vapor and rises. Unlike burning fuel, none of it disappears. But here’s the catch: it leaves the place it was drawn from, and re-enters the atmosphere on the cloud’s schedule, not the community’s.',
    },
    {
        icon: Wind,
        title: 'It returns as rain — maybe somewhere else entirely',
        description:
            'The water cycle is planetary, not local. Water pulled from a river in Arizona might fall as rain over the Pacific weeks later. The watershed it came from still loses that supply right now.',
    },
    {
        icon: MapPin,
        title: 'Where and when beats how much',
        description:
            'A data center in a rainy region has a very different impact than one in a drought zone. The sharp question isn’t whether AI “uses up” water — it’s where and when that water is withdrawn, and who else needed it.',
    },
];

// AI is also part of the climate solution — honest, sourced balance.
const aiForGood = [
    {
        icon: FlaskConical,
        title: 'Materials discovery',
        description:
            'DeepMind’s GNoME predicted 2.2 million new stable crystal structures in 2023 (Nature) — a head start on better batteries and solar cells that would have taken decades in the lab.',
    },
    {
        icon: Zap,
        title: 'Grid & forecasting',
        description:
            'Machine learning is used to balance power grids in real time and sharpen weather forecasts, which helps operators lean harder on intermittent renewables like wind and solar.',
    },
    {
        icon: FlaskConical,
        title: 'Less physical experimentation',
        description:
            'Tools like AlphaFold collapse work that once needed enormous wet-lab effort, cutting the materials, energy, and waste tied to brute-force trial and error.',
    },
];

const actions = [
    {
        num: '1',
        title: 'Turn on concise mode',
        description:
            'Shorter answers mean fewer tokens, less inference time, and a lighter footprint. Toggle the “concise” tone in any Tripplet chat and the model keeps replies tight by default.',
    },
    {
        num: '2',
        title: 'Pick the right-sized model',
        description:
            'Reach for a heavyweight reasoning model when you actually need deep reasoning — not for “what’s 2+2.” One good prompt on the right model beats five vague ones on the biggest one.',
    },
    {
        num: '3',
        title: 'Reward transparency',
        description:
            'The more people choose tools that are candid about their footprint, the more the whole industry has to follow. Where you spend your attention is a signal — use it.',
    },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EnvironmentPage() {
    return (
        <div className="flex min-h-screen w-full flex-col bg-background grain-overlay relative">
            {/* Ambient green glow */}
            <div
                className="pointer-events-none absolute inset-x-0 top-0 h-[600px]"
                style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(74, 222, 128, 0.07) 0%, transparent 60%)' }}
                aria-hidden
            />

            <LandingHeader />

            <main className="grow relative z-[1]">
                {/* ── Hero ── */}
                <section className="relative mx-auto w-full max-w-5xl px-4 pt-32 pb-16 md:pt-40 md:pb-20 overflow-hidden">
                    {/* Floating leaf decorations */}
                    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
                        <Leaf className="animate-float absolute top-24 right-[8%] h-6 w-6 text-emerald-400 opacity-20 rotate-12" style={{ animationDelay: '0s' }} />
                        <Leaf className="animate-float absolute top-44 left-[12%] h-4 w-4 text-emerald-400 opacity-10 -rotate-[20deg]" style={{ animationDelay: '1.5s' }} />
                        <Leaf className="animate-float absolute top-64 right-[20%] h-5 w-5 text-emerald-400 opacity-[0.15] rotate-45" style={{ animationDelay: '3s' }} />
                    </div>

                    <div className="relative text-center">
                        {/* Earth illustration with Trilo */}
                        <motion.div
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.6, delay: 0.05, ease }}
                            className="relative flex justify-center mb-6"
                        >
                            <EarthIllustration className="h-24 w-24 md:h-28 md:w-28" />
                            <Image
                                src="/trilo-laying.png"
                                alt="Trilo, the Tripplet mascot"
                                width={56}
                                height={56}
                                className="absolute -bottom-2 -right-1 h-12 w-12 md:h-14 md:w-14 drop-shadow-lg"
                            />
                        </motion.div>

                        <motion.p
                            initial={{ opacity: 0, y: 16, filter: 'blur(8px)' }}
                            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                            transition={{ duration: 0.6, delay: 0.15, ease }}
                            className="text-sm font-medium text-emerald-400 mb-4"
                        >
                            Environment
                        </motion.p>

                        <motion.h1
                            initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
                            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                            transition={{ duration: 0.7, delay: 0.25, ease }}
                            className="text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl"
                        >
                            AI has a footprint.
                            <br className="hidden sm:block" />{' '}
                            <span className="text-emerald-400">Here&apos;s ours, without the spin.</span>
                        </motion.h1>

                        <motion.p
                            initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
                            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                            transition={{ duration: 0.7, delay: 0.4, ease }}
                            className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground leading-relaxed"
                        >
                            Most AI companies either ignore their environmental impact or polish it
                            into a press release. We&apos;d rather tell you exactly how Tripplet is
                            built, which numbers are actually ours, and where we genuinely don&apos;t
                            have the answers yet.
                        </motion.p>

                        {/* CTA buttons */}
                        <motion.div
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, delay: 0.55, ease }}
                            className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3"
                        >
                            <Link
                                href="/environment/report"
                                className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-5 py-2.5 text-sm font-medium text-emerald-400 hover:bg-emerald-500/15 transition-colors"
                            >
                                <FileText className="h-4 w-4" />
                                Read the full report
                            </Link>
                            <Link
                                href="/chat"
                                className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
                            >
                                Try Tripplet
                                <ArrowRight className="h-4 w-4" />
                            </Link>
                        </motion.div>
                    </div>
                </section>

                {/* ── The 60-second honest summary ── */}
                <section className="mx-auto w-full max-w-5xl px-4 pb-4">
                    <motion.div
                        initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
                        whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.6, ease }}
                        className="rounded-3xl border border-emerald-500/15 bg-emerald-500/[0.03] p-6 md:p-8"
                    >
                        <div className="flex items-center gap-2 text-emerald-400 mb-1.5">
                            <Leaf className="h-4 w-4" />
                            <span className="text-xs font-semibold uppercase tracking-wider">The 60-second version</span>
                        </div>
                        <p className="text-sm text-muted-foreground max-w-2xl">
                             If you read nothing else, read this. This is the honest shape of
                             Tripplet&apos;s environmental footprint before we get into the details.
                         </p>

                         <div className="mt-6 space-y-6">
                             <div className="rounded-2xl border border-emerald-500/10 bg-card/60 p-5">
                                 <h3 className="text-sm font-semibold">We train our own models</h3>
                                 <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                                     Tripplet develops and trains its own models, including Astro, Taipei, Majuli,
                                     and Suzhou. Unlike the massive frontier models that require months of training
                                     across enormous GPU clusters, our training methods are designed to be far more
                                     efficient, keeping the environmental cost significantly lower.
                                 </p>
                             </div>
                             <div className="rounded-2xl border border-emerald-500/10 bg-card/60 p-5">
                                 <h3 className="text-sm font-semibold">We don&apos;t own data centers</h3>
                                 <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                                     Your messages run on infrastructure we rent rather than hardware we own.
                                     That means we don&apos;t directly control the buildings, cooling systems, or
                                     electricity supplying those servers, even though our models are running on them.
                                 </p>
                             </div>
                             <div className="rounded-2xl border border-emerald-500/10 bg-card/60 p-5">
                                 <h3 className="text-sm font-semibold">We can&apos;t fully measure every chat</h3>
                                 <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                                     No one can tell you the exact energy or water used for a single conversation.
                                     Infrastructure, hardware, workloads, and electricity sources all vary over time.
                                     Rather than pretend we know an exact number, we&apos;ll explain what we do know,
                                     where the impact comes from, and where the uncertainty remains.
                                 </p>
                             </div>
                         </div>
                    </motion.div>
                </section>

                {/* ── How Tripplet is actually built ── */}
                <section className="mx-auto w-full max-w-3xl px-4 py-20 md:py-28">
                    <motion.div
                        initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
                        whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.6, ease }}
                    >
                        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
                            What Tripplet <span className="text-emerald-400">actually</span> is, footprint-wise
                        </h2>
                        <div className="mt-5 space-y-4 text-muted-foreground leading-relaxed">
                            <p>
                                A lot of &quot;AI is boiling the oceans&quot; coverage is really about <strong className="text-foreground">training</strong> — the one-time, months-long process of building a frontier model from scratch. That stage is where the eye-watering energy and water numbers come from.
                            </p>
                            <p>
                                Tripplet does none of that. Our models — Astro, Taipei, Majuli, and Suzhou — are configurations of our own models that we have trained and released. We trained them using our own methods, making training extremely efficient, and creating our own models.
                            </p>
                            <p>
                                When you send a message, that&apos;s an <strong className="text-foreground">inference</strong> call — the model reads your prompt and writes a reply. Those calls run on our eco-friendly servers. We don&apos;t own that hardware, that building, or the power line feeding it. Our models are fine tunes, so they are not doing as much of an environmental impact.
                            </p>
                            <p>
                                So Tripplet&apos;s direct environmental impact is <strong className="text-foreground">inference, on infrastructure we rent</strong> — a real cost, but a small slice of AI&apos;s total footprint, and one we only partly control. That&apos;s the honest frame for everything below.
                            </p>
                        </div>
                    </motion.div>
                </section>

                {/* ── Industry context stats ── */}
                <section className="border-y border-emerald-500/10">
                    <div className="mx-auto w-full max-w-5xl px-4">
                        <motion.p
                            initial={{ opacity: 0 }}
                            whileInView={{ opacity: 1 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.5, ease }}
                            className="pt-8 text-center text-xs font-semibold uppercase tracking-wider text-emerald-400/80"
                        >
                            Industry context — not Tripplet&apos;s own numbers
                        </motion.p>
                        <div className="grid grid-cols-2 md:grid-cols-4">
                            {stats.map((s, i) => (
                                <motion.div
                                    key={s.label}
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    whileInView={{ opacity: 1, scale: 1 }}
                                    viewport={{ once: true }}
                                    transition={{ duration: 0.5, delay: i * 0.1, ease }}
                                    className="flex flex-col items-center py-8 border-r border-emerald-500/10 last:border-r-0 [&:nth-child(2)]:border-r-0 md:[&:nth-child(2)]:border-r"
                                >
                                    <span className="text-3xl font-bold tabular-nums text-emerald-400">
                                        {s.value}
                                    </span>
                                    <span className="mt-1 text-sm font-medium text-foreground text-center px-3">
                                        {s.label}
                                    </span>
                                    <span className="mt-1 text-[10px] text-muted-foreground/60 text-center px-3 leading-snug">
                                        {s.note}
                                    </span>
                                </motion.div>
                            ))}
                        </div>
                        <motion.p
                            initial={{ opacity: 0 }}
                            whileInView={{ opacity: 1 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.5, ease }}
                            className="pb-8 text-center text-xs text-muted-foreground/60 max-w-xl mx-auto px-4"
                        >
                            These figures come from other companies&apos; stacks and from academic
                            estimates. They tell you the scale of the industry — not the size of a
                            Tripplet chat. We include them so you have the real backdrop.
                        </motion.p>
                    </div>
                </section>

                {/* ── The honest two-column ── */}
                <section className="mx-auto w-full max-w-5xl px-4 py-20 md:py-28">
                    <div className="grid gap-12 md:grid-cols-2 md:gap-16 items-start">
                        <motion.div
                            initial={{ opacity: 0, x: -30, filter: 'blur(6px)' }}
                            whileInView={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                            viewport={{ once: true, margin: '-60px' }}
                            transition={{ duration: 0.7, ease }}
                        >
                            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
                                Let&apos;s be honest
                            </h2>
                            <div className="mt-5 space-y-4 text-muted-foreground leading-relaxed">
                                <p>
                                    Every message you send spins up a server somewhere that draws
                                    power and gets cooled. That&apos;s real, and it isn&apos;t free.
                                    A single AI reply is often estimated to use{' '}
                                    <strong className="text-foreground">several times the energy</strong>{' '}
                                    of a plain web search — the popular &quot;about 10x&quot; figure is
                                    a rough, widely-repeated estimate, and the true number swings
                                    hard with model size and prompt length.
                                </p>
                                <p>
                                    At industry scale the numbers are genuinely large: Microsoft
                                    reported a{' '}
                                    <strong className="text-foreground">34% jump in water use</strong>{' '}
                                    from 2021 to 2022, tied partly to AI, and Google&apos;s data
                                    centers drew{' '}
                                    <strong className="text-foreground">5.6 billion gallons</strong> in
                                    2022 across all operations.
                                </p>
                                <p>
                                    We&apos;re not going to wave those away. But notice: those are{' '}
                                    <strong className="text-foreground">their</strong> numbers, on{' '}
                                    <strong className="text-foreground">their</strong> clouds. Tripplet
                                    doesn&apos;t run on Microsoft or Google. Borrowing a hyperscaler&apos;s
                                    green press release to make ourselves look clean would be exactly
                                    the kind of spin we&apos;re trying to avoid.
                                </p>
                            </div>
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0, x: 30, filter: 'blur(6px)' }}
                            whileInView={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                            viewport={{ once: true, margin: '-60px' }}
                            transition={{ duration: 0.7, delay: 0.15, ease }}
                        >
                            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
                                ...but context matters a lot
                            </h2>
                            <div className="mt-5 space-y-4 text-muted-foreground leading-relaxed">
                                <p>
                                    Most data-center water goes to evaporative cooling, and unlike
                                    fossil fuel, that water isn&apos;t destroyed — it evaporates and
                                    rejoins the cycle. That doesn&apos;t make it harmless: the water{' '}
                                    <strong className="text-foreground">leaves the local
                                    community</strong> and may come back down as rain a thousand miles
                                    away.
                                </p>
                                <p>
                                    So the real question is{' '}
                                    <strong className="text-foreground">where</strong> and{' '}
                                    <strong className="text-foreground">when</strong> water is
                                    withdrawn. A facility in a wet region is a very different story
                                    from one straining an aquifer in a drought. Volume alone is a
                                    misleading headline.
                                </p>
                                <p>
                                    Energy is the bigger long-term lever, and it&apos;s genuinely
                                    moving — efficient inference hardware and cleaner grids both cut
                                    the cost per query over time. We benefit from that shift. We just
                                    can&apos;t take credit for causing it.
                                </p>
                            </div>
                        </motion.div>
                    </div>
                </section>

                {/* ── Water Cycle Illustration ── */}
                <section className="mx-auto w-full max-w-3xl px-4 pb-8">
                    <motion.div
                        initial={{ opacity: 0, y: 24 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.7, ease }}
                        className="flex justify-center rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.02] p-8 md:p-12"
                    >
                        <WaterCycleIllustration className="w-full max-w-md" />
                    </motion.div>
                </section>

                {/* ── Water Cycle Explainer ── */}
                <section className="border-t border-emerald-500/10">
                    <div className="mx-auto w-full max-w-3xl px-4 py-20 md:py-28">
                        <motion.div
                            initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
                            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.6, ease }}
                            className="text-center mb-14"
                        >
                            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
                                So where does the water{' '}
                                <span className="text-emerald-400">actually</span> go?
                            </h2>
                            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
                                Cooling a server taps into the same water cycle that&apos;s been
                                running on Earth for four billion years. Following it makes the real
                                concern obvious — and it isn&apos;t the one in the headlines.
                            </p>
                        </motion.div>

                        <div className="relative">
                            {/* Animated vertical line */}
                            <motion.div
                                className="absolute left-4 top-0 bottom-0 w-px bg-emerald-500/20 md:left-1/2"
                                initial={{ scaleY: 0, originY: 0 }}
                                whileInView={{ scaleY: 1 }}
                                viewport={{ once: true }}
                                transition={{ duration: 1.2, ease }}
                            />

                            <div className="space-y-10">
                                {waterCycleSteps.map((step, i) => (
                                    <motion.div
                                        key={step.title}
                                        initial={{ opacity: 0, x: i % 2 === 0 ? -24 : 24, filter: 'blur(4px)' }}
                                        whileInView={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                                        viewport={{ once: true, margin: '-40px' }}
                                        transition={{ duration: 0.6, delay: i * 0.12, ease }}
                                        className="relative pl-14 md:pl-0 md:grid md:grid-cols-2 md:gap-8"
                                    >
                                        <motion.div
                                            className="absolute left-2 top-1 flex h-5 w-5 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 md:left-1/2 md:-translate-x-2.5"
                                            initial={{ scale: 0 }}
                                            whileInView={{ scale: 1 }}
                                            viewport={{ once: true }}
                                            transition={{ duration: 0.4, delay: i * 0.12 + 0.2, type: 'spring', stiffness: 300 }}
                                        >
                                            <step.icon className="h-3 w-3 text-emerald-400" />
                                        </motion.div>

                                        <div className={i % 2 === 0 ? 'md:text-right' : 'md:col-start-2'}>
                                            <span className="text-xs font-medium text-emerald-400/80">Step {i + 1}</span>
                                            <h3 className="mt-1 font-semibold">{step.title}</h3>
                                            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{step.description}</p>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* ── What Tripplet does ── */}
                <section className="border-t border-emerald-500/10">
                    <div className="mx-auto w-full max-w-5xl px-4 py-20 md:py-28">
                        <motion.div
                            initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
                            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.6, ease }}
                            className="text-center mb-12"
                        >
                            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
                                What <span className="text-emerald-400">we</span> can actually point to
                            </h2>
                            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
                                We can&apos;t fix the grid or re-plumb a data center. But these are the
                                real, in-our-control choices baked into how Tripplet works.
                            </p>
                        </motion.div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {whatWeDo.map((item, i) => (
                                <motion.div
                                    key={item.title}
                                    initial={{ opacity: 0, y: 28, scale: 0.96 }}
                                    whileInView={{ opacity: 1, y: 0, scale: 1 }}
                                    viewport={{ once: true, margin: '-30px' }}
                                    transition={{ duration: 0.5, delay: i * 0.07, ease }}
                                    whileHover={{ y: -3, transition: { duration: 0.25 } }}
                                    className="rounded-2xl border border-emerald-500/10 bg-card p-6 hover:border-emerald-500/25 transition-colors"
                                >
                                    <motion.div
                                        className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/5"
                                        whileHover={{ scale: 1.1, rotate: 5 }}
                                        transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                                    >
                                        <item.icon className="h-5 w-5 text-emerald-400" />
                                    </motion.div>
                                    <h3 className="text-sm font-semibold">{item.title}</h3>
                                    <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{item.description}</p>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ── The honest scorecard ── */}
                <section className="border-t border-emerald-500/10">
                    <div className="mx-auto w-full max-w-4xl px-4 py-20 md:py-28">
                        <motion.div
                            initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
                            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.6, ease }}
                            className="text-center mb-12"
                        >
                            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
                                The honest scorecard
                            </h2>
                            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
                                The clearest test of whether a company is greenwashing is whether
                                it&apos;ll tell you what it <em>can&apos;t</em> claim. So here&apos;s both columns.
                            </p>
                        </motion.div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <motion.div
                                initial={{ opacity: 0, x: -20 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                viewport={{ once: true, margin: '-40px' }}
                                transition={{ duration: 0.6, ease }}
                                className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-6"
                            >
                                <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
                                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15">
                                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                                    </span>
                                    What we can honestly claim
                                </h3>
                                <ul className="space-y-3">
                                    {canClaim.map((c) => (
                                        <li key={c} className="flex gap-2.5 text-sm text-muted-foreground leading-relaxed">
                                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                                            <span>{c}</span>
                                        </li>
                                    ))}
                                </ul>
                            </motion.div>

                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                viewport={{ once: true, margin: '-40px' }}
                                transition={{ duration: 0.6, delay: 0.12, ease }}
                                className="rounded-2xl border border-border bg-card/50 p-6"
                            >
                                <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
                                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
                                        <Minus className="h-3.5 w-3.5 text-muted-foreground" />
                                    </span>
                                    What we can&apos;t claim (yet)
                                </h3>
                                <ul className="space-y-3">
                                    {cantClaim.map((c) => (
                                        <li key={c} className="flex gap-2.5 text-sm text-muted-foreground leading-relaxed">
                                            <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
                                            <span>{c}</span>
                                        </li>
                                    ))}
                                </ul>
                            </motion.div>
                        </div>

                        <motion.p
                            initial={{ opacity: 0, y: 12 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.5, delay: 0.2, ease }}
                            className="mt-8 text-center text-sm text-muted-foreground/70 max-w-lg mx-auto"
                        >
                            As we get real infrastructure data from our providers, items will move
                            from the right column to the left. We&apos;ll update this page when they do.
                        </motion.p>
                    </div>
                </section>

                {/* ── The nuance section ── */}
                <section className="border-t border-emerald-500/10">
                    <div className="mx-auto w-full max-w-3xl px-4 py-20 md:py-28">
                        <motion.div
                            initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
                            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.6, ease }}
                            className="text-center mb-10"
                        >
                            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
                                The nuance matters
                            </h2>
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.6, delay: 0.1, ease }}
                            className="space-y-6 text-muted-foreground leading-relaxed"
                        >
                            <p>
                                Some people say &quot;AI is boiling the oceans.&quot; Others say
                                &quot;it&apos;s fine, don&apos;t worry about it.&quot; Both are too
                                confident. The truth sits in the messy middle, and it depends on
                                specifics most takes skip right past.
                            </p>

                            <div className="rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.03] p-6 space-y-4">
                                <h3 className="font-semibold text-foreground flex items-center gap-2">
                                    <Droplets className="h-4 w-4 text-emerald-400" />
                                    Water: it&apos;s complicated
                                </h3>
                                <p>
                                    Evaporative cooling water isn&apos;t &quot;consumed&quot; the way
                                    gasoline is burned — it re-enters the atmosphere and eventually
                                    returns as rain. But if a data center sits in a drought-prone
                                    area, that local withdrawal still squeezes the community&apos;s
                                    water supply <em>right now</em>, even if the same water falls
                                    somewhere else later.
                                </p>
                                <p>
                                    That&apos;s why a facility&apos;s{' '}
                                    <strong className="text-foreground">location</strong> matters more
                                    than its raw water total. A water-rich region and a desert can
                                    post identical gallons-per-day and have completely different
                                    real-world impact.
                                </p>
                            </div>

                            <div className="rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.03] p-6 space-y-4">
                                <h3 className="font-semibold text-foreground flex items-center gap-2">
                                    <Zap className="h-4 w-4 text-emerald-400" />
                                    Energy: the bigger question
                                </h3>
                                <p>
                                    Energy is the more persistent concern. Data centers already use
                                    roughly{' '}
                                    <strong className="text-foreground">1.5% of global electricity</strong>{' '}
                                    (IEA, 2024), and AI demand is pushing that upward fast.
                                </p>
                                <p>
                                    There&apos;s real progress — inference-specialized chips squeeze
                                    more answers out of each watt, and grids keep getting cleaner. But
                                    we won&apos;t tell you our specific providers run on 100%
                                    carbon-free power, because we don&apos;t have the data to back
                                    that up. The honest answer is: it&apos;s improving, the trend
                                    helps us, and we don&apos;t control the pace.
                                </p>
                            </div>

                            <p className="text-center text-sm text-muted-foreground/70 pt-4">
                                We&apos;d rather give you the full picture — including the parts that
                                don&apos;t flatter us — than a tidy story that falls apart on a second read.
                            </p>
                        </motion.div>
                    </div>
                </section>

                {/* ── AI for good ── */}
                <section className="border-t border-emerald-500/10">
                    <div className="mx-auto w-full max-w-5xl px-4 py-20 md:py-28">
                        <motion.div
                            initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
                            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.6, ease }}
                            className="text-center mb-12"
                        >
                            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
                                The other side of the ledger
                            </h2>
                            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
                                Honesty cuts both ways. The same technology that draws power is also
                                speeding up real climate and science work.
                            </p>
                        </motion.div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                            {aiForGood.map((item, i) => (
                                <motion.div
                                    key={item.title}
                                    initial={{ opacity: 0, y: 24, scale: 0.96 }}
                                    whileInView={{ opacity: 1, y: 0, scale: 1 }}
                                    viewport={{ once: true, margin: '-30px' }}
                                    transition={{ duration: 0.5, delay: i * 0.08, ease }}
                                    className="rounded-2xl border border-emerald-500/10 bg-card p-6"
                                >
                                    <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                                        <item.icon className="h-5 w-5 text-emerald-400" />
                                    </div>
                                    <h3 className="text-sm font-semibold">{item.title}</h3>
                                    <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{item.description}</p>
                                </motion.div>
                            ))}
                        </div>
                        <motion.p
                            initial={{ opacity: 0 }}
                            whileInView={{ opacity: 1 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.5, ease }}
                            className="mt-8 text-center text-xs text-muted-foreground/60 max-w-lg mx-auto"
                        >
                            None of this cancels out AI&apos;s footprint — it&apos;s not a carbon
                            offset. It&apos;s just the part of the story that doom-takes leave out.
                        </motion.p>
                    </div>
                </section>

                {/* ── 3 things you can do ── */}
                <section className="border-t border-emerald-500/10">
                    <div className="mx-auto w-full max-w-3xl px-4 py-20 md:py-28">
                        <motion.div
                            initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
                            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.6, ease }}
                            className="text-center mb-10"
                        >
                            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
                                Three things you can do{' '}
                                <span className="text-emerald-400">right now</span>
                            </h2>
                            <p className="mt-3 text-muted-foreground">
                                Small, repeated choices add up faster than any single grand gesture.
                            </p>
                        </motion.div>

                        <div className="grid gap-4">
                            {actions.map((action, i) => (
                                <motion.div
                                    key={action.num}
                                    initial={{ opacity: 0, x: -20 }}
                                    whileInView={{ opacity: 1, x: 0 }}
                                    viewport={{ once: true, margin: '-30px' }}
                                    transition={{ duration: 0.5, delay: i * 0.1, ease }}
                                    className="flex gap-4 rounded-2xl border border-emerald-500/10 bg-card p-5 hover:border-emerald-500/25 transition-colors"
                                >
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-sm font-bold text-emerald-400">
                                        {action.num}
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-sm">{action.title}</h3>
                                        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                                            {action.description}
                                        </p>
                                    </div>
                                </motion.div>
                            ))}
                        </div>

                        <motion.p
                            initial={{ opacity: 0, y: 12 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.5, delay: 0.3, ease }}
                            className="mt-10 text-center text-muted-foreground leading-relaxed max-w-lg mx-auto"
                        >
                            Your generation is the first to grow up with AI — and the first in a
                            position to demand it&apos;s built responsibly. That demand is what
                            actually moves the industry.
                        </motion.p>
                    </div>
                </section>

                {/* ── Sources ── */}
                <section className="border-t border-emerald-500/10">
                    <div className="mx-auto w-full max-w-3xl px-4 py-12">
                        <motion.div
                            initial={{ opacity: 0, y: 16 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.5, ease }}
                            className="rounded-2xl border border-border/50 bg-card/50 p-6 text-xs text-muted-foreground/70 space-y-3"
                        >
                            <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                                <ScrollText className="h-4 w-4" />
                                Sources &amp; notes
                            </h3>
                            <ul className="space-y-1.5 list-disc pl-4">
                                <li>Microsoft 2022 Environmental Sustainability Report — water-use increase attributed partly to AI workloads (Microsoft&apos;s own infrastructure, not Tripplet&apos;s).</li>
                                <li>Google 2023 Environmental Report — 5.6 billion gallons covers all Google data-center operations, not AI specifically, and not Tripplet.</li>
                                <li>Li, P. et al. (2023) &quot;Making AI Less Thirsty,&quot; UC Riverside — water-per-conversation estimate for GPT-3.5-class models on Azure. A research estimate, not an official disclosure, and not measured on our stack.</li>
                                <li>IEA, Electricity 2024 — data centers at roughly 1.5% of global electricity, with AI cited as a key growth driver.</li>
                                <li>Merchant, A. et al. (2023) &quot;Scaling deep learning for materials discovery,&quot; Nature — DeepMind GNoME, 2.2 million predicted crystal structures.</li>
                                <li>The &quot;~10x a web search&quot; energy comparison is a widely-cited rough estimate, not a settled measurement; real figures vary with model and prompt.</li>
                            </ul>
                            <p className="pt-2 border-t border-border/30">
                                Tripplet runs inference on third-party providers (our default provider,
                                plus a separate gateway for the Astro flagship) using open-weight models we
                                did not train. We do not operate data centers and do not have
                                independently verified, Tripplet-specific energy or water figures.
                                Environmental accounting for AI is an emerging field and methodologies
                                vary across studies. We&apos;ll revise this page as better data
                                becomes available.
                            </p>
                        </motion.div>
                    </div>
                </section>

                {/* ── CTA ── */}
                <section className="border-t border-emerald-500/10">
                    <div className="mx-auto w-full max-w-3xl px-4 py-20 md:py-28 text-center">
                        <motion.div
                            initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
                            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.7, ease }}
                        >
                            <div className="flex justify-center mb-5">
                                <LeafPattern className="h-16 w-16" />
                            </div>
                            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
                                Honesty is the whole point
                            </h2>
                            <p className="mt-4 text-muted-foreground max-w-lg mx-auto leading-relaxed">
                                Every technology has a footprint. What separates the companies worth
                                trusting is whether they&apos;ll tell you the unflattering parts and
                                keep working to shrink the parts they control. That&apos;s the bar
                                we&apos;re holding ourselves to here.
                            </p>
                            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                                <Link
                                    href="/environment/report"
                                    className="inline-flex items-center gap-2 rounded-full bg-emerald-600 hover:bg-emerald-500 px-6 py-2.5 text-sm font-medium text-white transition-colors"
                                >
                                    <FileText className="h-4 w-4" />
                                    Read the full report
                                </Link>
                                <Link
                                    href="/chat"
                                    className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
                                >
                                    Try Tripplet
                                    <ArrowRight className="h-4 w-4" />
                                </Link>
                            </div>
                        </motion.div>
                    </div>
                </section>
            </main>

            <LandingFooter />
        </div>
    );
}
