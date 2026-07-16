'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Instrument_Serif } from 'next/font/google';
import { ArrowRight, Globe } from 'lucide-react';
import { TabVisibility } from '@/components/ui/tab-visibility';
import { GlassNav } from '@/components/ui/glass-nav';
import VideoBackdrop from '@/components/Sonoma/VideoBackdrop';
import SonomaComposer from '@/components/Sonoma/Composer';
import OutageNotice from '@/components/Sonoma/OutageNotice';
import { OUTAGE_ACTIVE } from '@/lib/outage';
import { modelsForPage } from '@/lib/ai/models';
import { setChatHandoff } from '@/lib/sonoma/handoff';
import { APP_NAME } from '@/lib/branding';

const instrumentSerif = Instrument_Serif({
    subsets: ['latin'],
    weight: '400',
    style: ['normal', 'italic'],
    display: 'swap',
    variable: '--font-instrument-serif',
});

const DISPLAY_FONT = { fontFamily: "var(--font-instrument-serif), 'Instrument Serif', serif" };

const NAV_LINKS = [
    { label: 'Home', href: '/' },
    { label: 'Chat', href: '/chat' },
    { label: 'Code', href: '/code' },
    { label: 'Blog', href: '/blog' },
    { label: 'About', href: '/about' },
];

const MODELS = [
    {
        id: 'astro-5',
        name: 'Astro 5',
        role: 'Flagship',
        desc: 'Our most capable model — deep reasoning, agentic tool use, and full code pipelines through Astro 5 Code.',
    },
    {
        id: 'tura-3',
        name: 'Taipei 4',
        role: 'Reasoning',
        desc: 'Structured thinking for research, analysis, and multi-step problems that deserve more than a first guess.',
    },
    {
        id: 'majuli-3',
        name: 'Majuli 4',
        role: 'Everyday',
        desc: 'The balanced daily driver — fast enough to keep up, thoughtful enough to be worth asking.',
    },
    {
        id: 'suzhou-3',
        name: 'Suzhou 4',
        role: 'Instant',
        desc: 'Light and immediate. Free for guests, no account required — start a conversation in one click.',
    },
];

const CAPABILITIES = [
    {
        title: 'Streaming chat',
        desc: 'Responses arrive token by token, so you read while the model writes — no spinner, no waiting for the whole answer.',
    },
    {
        title: 'Live web search',
        desc: 'Fresh results pulled into context as you ask, so answers reflect the world as it is today.',
    },
    {
        title: 'Persistent memory',
        desc: 'Tripplet remembers what matters across conversations. Pick up where you left off, weeks later.',
    },
    {
        title: 'Real Python execution',
        desc: 'Code runs in a sandboxed interpreter — actual output, actual errors, not a plausible imitation.',
    },
    {
        title: 'Connectors',
        desc: 'Link GitHub, Gmail, Notion, and more. Your assistant works with your tools, scoped to your account.',
    },
    {
        title: 'Triplepedia',
        desc: 'A built-in knowledge base you can read, extend, and pull into any conversation.',
    },
];

const MODES = [
    {
        key: 'think',
        title: 'Think',
        desc: 'Slows the model down for careful, low-temperature reasoning when precision matters.',
    },
    {
        key: 'deep-research',
        title: 'Deep research',
        desc: 'A longer leash and a bigger budget — thorough, multi-angle answers for hard questions.',
    },
    {
        key: 'web-search',
        title: 'Web search',
        desc: 'Live results woven into the conversation, cited and current.',
    },
    {
        key: 'study',
        title: 'Study',
        desc: 'Explains instead of solves — guides you to the answer so it sticks.',
    },
];

const TONES = ['formal', 'concise', 'detailed', 'minimal'];

const CONNECTOR_APPS = ['GitHub', 'Gmail', 'Notion', 'and more'];

const PY_SNIPPET = `>>> primes = [n for n in range(2, 50)
...     if all(n % d for d in range(2, n))]
>>> sum(primes)
328`;

const API_SNIPPET = `const res = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({
    model: 'astro-5',
    messages: [{ role: 'user', content: 'Explain quines.' }],
  }),
});

// Server-sent events — tokens as they're generated
for await (const chunk of readSSE(res.body)) {
  render(chunk.delta);
}`;

/**
 * Fade the hero backdrop out as the visitor scrolls into the sections, so the
 * video dissolves into the page background instead of ending at a hard edge.
 */
function useScrollFade() {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        let frame = 0;
        const update = () => {
            frame = 0;
            const fadeEnd = window.innerHeight * 0.85;
            const opacity = Math.max(0, 1 - window.scrollY / fadeEnd);
            el.style.opacity = String(opacity);
        };
        const onScroll = () => {
            if (!frame) frame = requestAnimationFrame(update);
        };
        update();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            window.removeEventListener('scroll', onScroll);
            if (frame) cancelAnimationFrame(frame);
        };
    }, []);

    return ref;
}

function SectionHeading({ kicker, title, sub }: { kicker: string; title: string; sub?: string }) {
    return (
        <div className="mb-14 max-w-2xl">
            <p className="mb-4 font-mono text-xs uppercase tracking-[0.25em] text-white/50">
                {kicker}
            </p>
            <h2 className="text-3xl font-medium tracking-tight text-white sm:text-4xl">{title}</h2>
            {sub && <p className="mt-4 text-base leading-relaxed text-white/60">{sub}</p>}
        </div>
    );
}

function TerminalCard({ title, children }: { title: string; children: string }) {
    return (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="ml-2 font-mono text-xs text-white/40">{title}</span>
            </div>
            <pre className="overflow-x-auto p-6 font-mono text-[13px] leading-relaxed text-white/80">
                <code>{children}</code>
            </pre>
        </div>
    );
}

export default function Landing() {
    const router = useRouter();
    const backdropRef = useScrollFade();
    const pageModels = useMemo(() => modelsForPage('chat'), []);
    const [draft, setDraft] = useState('');
    const [model, setModel] = useState<string>(pageModels[0].id);
    const [browse, setBrowse] = useState(false);
    const [reason, setReason] = useState(false);
    const [codeMode, setCodeMode] = useState(false);

    // The real conversation starts on /chat: stash the message (and options)
    // for the chat shell to pick up and send on arrival.
    const handleSend = () => {
        if (OUTAGE_ACTIVE) return;
        const text = draft.trim();
        if (!text) return;
        setChatHandoff({ text, model, browse, reason, code: codeMode });
        router.push('/chat');
    };

    return (
        <div className={`${instrumentSerif.variable} relative min-h-svh bg-black font-sans`}>
            <TabVisibility message="👋 Come back — your AI is waiting" />

            {/* ── Hero: chat-page backdrop, glass nav, the real composer ── */}
            <section className="relative flex min-h-svh flex-col overflow-hidden">
                <div ref={backdropRef} className="absolute inset-0 will-change-[opacity]">
                    <VideoBackdrop>
                        <div />
                    </VideoBackdrop>
                    {/* Dissolve the backdrop's bottom edge into the page
                        background so the video never ends on a visible line. */}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-48 bg-gradient-to-b from-transparent to-black" />
                </div>

                {/* Navigation */}
                <GlassNav tone="dark" />

                {/* Hero content — the chat composer front and center */}
                <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
                    <h1
                        className="animate-fade-rise mb-4 max-w-4xl text-5xl leading-[0.98] tracking-[-0.02em] text-white sm:text-6xl md:text-7xl"
                        style={DISPLAY_FONT}
                    >
                        Built for the <em className="text-white/75">curious</em>
                    </h1>

                    <p className="animate-fade-rise-delay mx-auto mb-10 max-w-xl text-base leading-relaxed text-white/75 sm:text-lg">
                        One workspace for chat, code, and research — four specialized
                        models, one conversation. Ask anything to begin.
                    </p>

                    <div className="animate-fade-rise-delay-2 w-full max-w-[680px] text-left">
                        {OUTAGE_ACTIVE && <OutageNotice />}
                        <div
                            aria-disabled={OUTAGE_ACTIVE}
                            style={
                                OUTAGE_ACTIVE
                                    ? {
                                        opacity: 0.45,
                                        filter: 'grayscale(1)',
                                        pointerEvents: 'none',
                                        userSelect: 'none',
                                    }
                                    : undefined
                            }
                        >
                            <SonomaComposer
                                value={draft}
                                onChange={setDraft}
                                onSend={handleSend}
                                busy={false}
                                model={model}
                                onModelChange={setModel}
                                models={pageModels}
                                files={[]}
                                onAddFiles={() => {}}
                                onRemoveFile={() => {}}
                                browse={browse}
                                onToggleBrowse={() => setBrowse((b) => !b)}
                                reason={reason}
                                onToggleReason={() => setReason((r) => !r)}
                                code={codeMode}
                                onToggleCode={() => setCodeMode((c) => !c)}
                                attachments={false}
                                placeholder="How can Tripplet help?"
                            />
                        </div>
                    </div>

                    <p className="animate-fade-rise-delay-2 mt-4 text-xs tracking-wide text-white/50">
                        Free to start · No account required · Your message carries into the chat
                    </p>
                </main>
            </section>

            {/* ── Models ── */}
            <section className="mx-auto max-w-7xl px-8 py-24">
                <SectionHeading
                    kicker="The lineup"
                    title="Four models. One conversation away."
                    sub="Every model in Tripplet is tuned for a different kind of thinking. Switch between them mid-conversation — your context comes along."
                />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {MODELS.map(({ id, name, role, desc }) => (
                        <div
                            key={id}
                            className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-white/20"
                        >
                            <div className="mb-4 flex items-center justify-between">
                                <span className="font-mono text-xs text-white/40">{id}</span>
                                <span className="rounded-full border border-white/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-white/60">
                                    {role}
                                </span>
                            </div>
                            <h3 className="mb-2 text-lg font-medium text-white">{name}</h3>
                            <p className="text-sm leading-relaxed text-white/60">{desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── Capabilities ── */}
            <section className="border-t border-white/10">
                <div className="mx-auto max-w-7xl px-8 py-24">
                    <SectionHeading
                        kicker="Capabilities"
                        title="Everything a workspace should do."
                        sub="Not a chat box with extras bolted on — search, memory, execution, and your own tools, woven into every conversation."
                    />
                    <div className="grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                        {CAPABILITIES.map(({ title, desc }) => (
                            <div key={title}>
                                <h3 className="mb-2 text-base font-medium text-white">{title}</h3>
                                <p className="text-sm leading-relaxed text-white/60">{desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── Modes & tones ── */}
            <section className="border-t border-white/10">
                <div className="mx-auto max-w-7xl px-8 py-24">
                    <SectionHeading
                        kicker="Modes & tones"
                        title="Shape how it thinks — and how it talks."
                        sub="Modes change the model's approach; tones change its voice. Stack them however the moment calls for."
                    />
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {MODES.map(({ key, title, desc }) => (
                            <div
                                key={key}
                                className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"
                            >
                                <p className="mb-3 font-mono text-xs text-white/40">{key}</p>
                                <h3 className="mb-2 text-base font-medium text-white">{title}</h3>
                                <p className="text-sm leading-relaxed text-white/60">{desc}</p>
                            </div>
                        ))}
                    </div>
                    <div className="mt-8 flex flex-wrap items-center gap-3">
                        <span className="text-sm text-white/50">Tones:</span>
                        {TONES.map((tone) => (
                            <span
                                key={tone}
                                className="rounded-full border border-white/10 px-4 py-1.5 font-mono text-xs text-white/70"
                            >
                                {tone}
                            </span>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── Real execution ── */}
            <section className="border-t border-white/10">
                <div className="mx-auto grid max-w-7xl items-center gap-16 px-8 py-24 lg:grid-cols-2">
                    <div>
                        <SectionHeading
                            kicker="Real execution"
                            title="It runs the code. Actually."
                            sub="When Tripplet writes Python, it executes it in a sandboxed interpreter and shows you the real output — and real errors. No confidently wrong arithmetic, no imagined results."
                        />
                        <p className="text-sm leading-relaxed text-white/60">
                            Want more than Python? Enable the sandboxed Linux skill in
                            Settings and the assistant gets a full in-browser VM with a
                            real shell.
                        </p>
                    </div>
                    <TerminalCard title="python — sandboxed">{PY_SNIPPET}</TerminalCard>
                </div>
            </section>

            {/* ── Connectors ── */}
            <section className="border-t border-white/10">
                <div className="mx-auto max-w-7xl px-8 py-24">
                    <SectionHeading
                        kicker="Connectors"
                        title="Bring your own tools."
                        sub="Link the apps you already live in, and Tripplet can read and act on them — issues, mail, docs — scoped to your account, revocable any time."
                    />
                    <div className="flex flex-wrap gap-3">
                        {CONNECTOR_APPS.map((app) => (
                            <span
                                key={app}
                                className="rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm text-white/80"
                            >
                                {app}
                            </span>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── For developers ── */}
            <section className="border-t border-white/10">
                <div className="mx-auto grid max-w-7xl items-center gap-16 px-8 py-24 lg:grid-cols-2">
                    <div>
                        <SectionHeading
                            kicker="For developers"
                            title="Streamed, not spooled."
                            sub="Every response is server-sent events from the first token. Build on the same streaming API the Tripplet interface runs on — plus an MCP server and OAuth for your own agents."
                        />
                        <Link
                            href="/register"
                            className="liquid-glass inline-block rounded-full px-8 py-3 text-sm text-white transition-transform hover:scale-[1.03]"
                        >
                            Get an account
                        </Link>
                    </div>
                    <TerminalCard title="stream.ts">{API_SNIPPET}</TerminalCard>
                </div>
            </section>

            {/* ── Triplepedia ── */}
            <section className="border-t border-white/10">
                <div className="mx-auto max-w-7xl px-8 py-24">
                    <SectionHeading
                        kicker="Triplepedia"
                        title="A knowledge base that grows with you."
                        sub="Articles you can read, extend, and pull straight into a conversation — Tripplet's collective memory, one tab away."
                    />
                    <Link
                        href="/triplepedia"
                        className="group inline-flex items-center gap-1.5 text-sm text-white/60 transition-colors hover:text-white"
                    >
                        Browse Triplepedia
                        <ArrowRight
                            size={14}
                            aria-hidden="true"
                            className="transition-transform group-hover:translate-x-0.5"
                        />
                    </Link>
                </div>
            </section>

            {/* ── Closing CTA ── */}
            <section className="border-t border-white/10">
                <div className="mx-auto flex max-w-7xl flex-col items-center px-8 py-32 text-center">
                    <h2
                        className="max-w-3xl text-4xl leading-[1.05] tracking-tight text-white sm:text-6xl"
                        style={DISPLAY_FONT}
                    >
                        Stay <em className="text-white/70">curious</em>.
                    </h2>
                    <p className="mt-6 max-w-xl text-base leading-relaxed text-white/60">
                        Free to start — no card, no setup. Guests get Suzhou 4 instantly;
                        an account unlocks the full lineup.
                    </p>
                    <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
                        <Link
                            href="/register"
                            className="liquid-glass rounded-full px-10 py-4 text-base text-white transition-transform hover:scale-[1.03]"
                        >
                            Create an account
                        </Link>
                        <Link
                            href="/about"
                            className="group inline-flex items-center gap-1.5 px-2 py-4 text-sm text-white/60 transition-colors hover:text-white"
                        >
                            Read the manifesto
                            <ArrowRight
                                size={14}
                                aria-hidden="true"
                                className="transition-transform group-hover:translate-x-0.5"
                            />
                        </Link>
                    </div>
                </div>
            </section>

            {/* ── Footer ── */}
            <footer className="border-t border-white/10">
                <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-8 py-10 sm:flex-row">
                    <span className="flex items-center gap-2 text-white">
                        <Globe size={18} aria-hidden="true" />
                        <span className="text-base font-semibold">{APP_NAME}</span>
                    </span>
                    <nav className="flex flex-wrap items-center justify-center gap-6">
                        {NAV_LINKS.map(({ label, href }) => (
                            <Link
                                key={label}
                                href={href}
                                className="text-sm text-white/60 transition-colors hover:text-white"
                            >
                                {label}
                            </Link>
                        ))}
                        <Link
                            href="/triplepedia"
                            className="text-sm text-white/60 transition-colors hover:text-white"
                        >
                            Triplepedia
                        </Link>
                    </nav>
                    <span className="font-mono text-xs text-white/40">© 2026 {APP_NAME}</span>
                </div>
            </footer>
        </div>
    );
}
