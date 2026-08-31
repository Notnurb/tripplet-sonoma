import type { Metadata } from 'next'
import { GlassNav } from '@/components/ui/glass-nav'
import { AppWindow } from '@/components/computer/AppWindow'
import { BuildCommand } from '@/components/computer/BuildCommand'
import './computer.css'

export const metadata: Metadata = {
    title: 'Tripplet Computer — an agent that works on your Mac',
    description:
        'A native macOS agent workstation written in Rust. Point it at a project and it reads, edits, runs commands, browses the web, and acts across your connected apps — behind an approval gate you control.',
    openGraph: {
        title: 'Tripplet Computer',
        description: 'A native macOS agent workstation, written in Rust.',
        type: 'website',
    },
}

const MODELS = [
    { name: 'Suzhou 4', note: 'Quick edits and everyday automation' },
    { name: 'Majuli 4', note: 'Balanced reasoning with strong tool use' },
    { name: 'Taipei 4', note: 'Deliberate, long-horizon problem solving' },
    { name: 'Astro 5.1', note: 'Flagship — deepest reasoning, widest fan-out', flagship: true },
]

const EFFORTS = [
    { label: 'Low', detail: 'Fastest. Short answers, minimal tool use.', fleet: 0 },
    { label: 'Medium', detail: 'Everyday default. Balanced depth and speed.', fleet: 0 },
    { label: 'High', detail: 'Thinks longer and keeps working through tool calls.', fleet: 0 },
    { label: 'XHigh', detail: 'Long-horizon work with a small verification pool.', fleet: 3 },
    { label: 'Max', detail: 'Deepest single-agent reasoning with parallel review.', fleet: 6 },
    { label: 'Ultra', detail: 'Fans the task across a subagent fleet, then synthesises.', fleet: 16 },
]

const CAPABILITIES = [
    {
        title: 'Files',
        body: 'Reads, searches, and edits inside the project you opened. Paths are resolved through the sandbox, so `..` and symlinks cannot quietly escape it.',
    },
    {
        title: 'Terminal',
        body: 'Runs builds, tests, and git with a hard timeout and captured output. A risk classifier knows `git status` from `git push`.',
    },
    {
        title: 'Browser',
        body: 'Searches the web and reads documentation. Loopback and private-range addresses are refused outright, not merely prompted.',
    },
    {
        title: 'Connectors',
        body: 'Hundreds of apps through Composio — GitHub, Gmail, Slack, Notion, Linear. Everything they return is fenced as untrusted data.',
    },
]

const APPROVALS = [
    {
        title: 'Ask for approval',
        body: 'Anything that leaves the project folder or touches the network stops for you first.',
    },
    {
        title: 'Approve for me',
        body: 'Ordinary work runs uninterrupted. Only actions the classifier flags come to you.',
    },
    {
        title: 'Custom (config.toml)',
        body: 'Explicit allow-lists for paths, commands, hosts, and connector tools.',
    },
]

export default function ComputerPage() {
    return (
        <div className="tc-root min-h-screen">
            <GlassNav tone="dark" />

            {/* ── Hero ── */}
            <section className="relative overflow-hidden px-6 pb-20 pt-32 sm:pt-40">
                <div className="tc-ambient" />
                <div className="tc-grid" />

                <div className="relative mx-auto max-w-4xl text-center">
                    <span className="tc-glass tc-glass-edge inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[11px] tracking-wide text-white/60 uppercase">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#b388ff]" />
                        Written in Rust · macOS
                    </span>

                    <h1 className="mt-7 text-[42px] leading-[1.05] font-medium tracking-tight sm:text-6xl md:text-7xl">
                        <span className="tc-gradient-text">Tripplet Computer</span>
                    </h1>

                    <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/55 sm:text-lg">
                        An agent that actually works on your Mac. Point it at a project and it reads
                        the code, makes the edits, runs the tests, and reaches into the apps you
                        already use — with an approval gate you set, not one it decides.
                    </p>

                    <div className="mt-10 flex flex-col items-center gap-3">
                        <BuildCommand />
                        <p className="text-[12px] text-white/30">
                            Requires Rust and Xcode command-line tools. Signed builds are on the way.
                        </p>
                    </div>
                </div>

                <div className="relative mt-16 sm:mt-20">
                    <AppWindow />
                </div>
            </section>

            {/* ── Capabilities ── */}
            <section className="relative px-6 py-20">
                <div className="mx-auto max-w-5xl">
                    <h2 className="text-2xl font-medium tracking-tight sm:text-3xl">
                        It has hands, not just opinions.
                    </h2>
                    <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-white/50">
                        Every capability is a real tool in the Rust core, sandboxed to the project
                        you opened.
                    </p>

                    <div className="mt-10 grid gap-3 sm:grid-cols-2">
                        {CAPABILITIES.map((item) => (
                            <div
                                key={item.title}
                                className="tc-glass tc-glass-edge rounded-2xl p-6 transition-colors duration-300 hover:bg-white/[0.04]"
                            >
                                <h3 className="text-[15px] font-medium text-white/90">
                                    {item.title}
                                </h3>
                                <p className="mt-2 text-[13.5px] leading-relaxed text-white/50">
                                    {item.body}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── Models and effort ── */}
            <section className="relative px-6 py-20">
                <div className="mx-auto max-w-5xl">
                    <h2 className="text-2xl font-medium tracking-tight sm:text-3xl">
                        Four models. Six gears.
                    </h2>
                    <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-white/50">
                        Pick the model for the kind of thinking, and the effort for how much of it.
                        They compose.
                    </p>

                    <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {MODELS.map((model) => (
                            <div
                                key={model.name}
                                className="tc-glass tc-glass-edge rounded-2xl p-5"
                                style={
                                    model.flagship
                                        ? { borderColor: 'rgba(179,136,255,0.28)' }
                                        : undefined
                                }
                            >
                                <div className="flex items-center gap-2">
                                    <h3 className="text-[15px] font-medium text-white/90">
                                        {model.name}
                                    </h3>
                                    {model.flagship && (
                                        <span className="rounded-full bg-[#8350e8]/20 px-2 py-0.5 text-[10px] tracking-wide text-[#c9b0ff] uppercase">
                                            Flagship
                                        </span>
                                    )}
                                </div>
                                <p className="mt-2 text-[13px] leading-relaxed text-white/45">
                                    {model.note}
                                </p>
                            </div>
                        ))}
                    </div>

                    <div className="tc-rule my-12" />

                    <div className="grid gap-px overflow-hidden rounded-2xl border border-white/[0.07]">
                        {EFFORTS.map((effort) => (
                            <div
                                key={effort.label}
                                className="flex flex-col gap-1 bg-white/[0.02] px-5 py-4 sm:flex-row sm:items-center sm:gap-6"
                            >
                                <span className="w-20 shrink-0 font-mono text-[13px] text-white/85">
                                    {effort.label}
                                </span>
                                <span className="flex-1 text-[13.5px] text-white/50">
                                    {effort.detail}
                                </span>
                                {effort.fleet > 0 && (
                                    <span className="flex shrink-0 items-center gap-2 text-[12px] text-[#c9b0ff]">
                                        <span className="flex items-center gap-1">
                                            {Array.from({
                                                length: Math.min(effort.fleet, 8),
                                            }).map((_, index) => (
                                                <span
                                                    key={index}
                                                    className="tc-pip"
                                                    style={{
                                                        animationDelay: `${index * 0.16}s`,
                                                    }}
                                                />
                                            ))}
                                        </span>
                                        {effort.fleet} subagents
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── Ultra ── */}
            <section className="relative overflow-hidden px-6 py-20">
                <div className="tc-ambient opacity-60" />
                <div className="relative mx-auto max-w-3xl text-center">
                    <span className="font-mono text-[12px] tracking-widest text-[#c9b0ff] uppercase">
                        Ultra
                    </span>
                    <h2 className="mt-4 text-2xl font-medium tracking-tight sm:text-4xl">
                        Sixteen agents, sixteen angles.
                    </h2>
                    <p className="mx-auto mt-5 max-w-2xl text-[15px] leading-relaxed text-white/55">
                        Ultra does not just think longer — it changes shape. A planner splits your
                        request into distinct investigative lenses, a fleet of read-only subagents
                        works them in parallel, and the lead agent reconciles what comes back before
                        touching a single file.
                    </p>
                    <p className="mx-auto mt-4 max-w-2xl text-[13.5px] leading-relaxed text-white/35">
                        Read-only is the point: sixteen agents editing one working tree is a race,
                        not a fleet. They investigate. The lead agent acts.
                    </p>
                </div>
            </section>

            {/* ── Approvals ── */}
            <section className="relative px-6 py-20">
                <div className="mx-auto max-w-5xl">
                    <h2 className="text-2xl font-medium tracking-tight sm:text-3xl">
                        You decide what it may do.
                    </h2>
                    <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-white/50">
                        Three modes, switchable mid-conversation. One rule sits above all of them:
                        destructive commands always stop and ask, even under a blanket allow-list.
                    </p>

                    <div className="mt-10 grid gap-3 sm:grid-cols-3">
                        {APPROVALS.map((mode) => (
                            <div
                                key={mode.title}
                                className="tc-glass tc-glass-edge rounded-2xl p-6"
                            >
                                <h3 className="text-[14.5px] font-medium text-white/90">
                                    {mode.title}
                                </h3>
                                <p className="mt-2 text-[13px] leading-relaxed text-white/50">
                                    {mode.body}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── Close ── */}
            <section className="relative px-6 pb-28 pt-10">
                <div className="tc-glass tc-glass-edge mx-auto max-w-3xl rounded-3xl px-8 py-14 text-center">
                    <h2 className="text-2xl font-medium tracking-tight sm:text-3xl">
                        Run it on something real.
                    </h2>
                    <p className="mx-auto mt-4 max-w-lg text-[14.5px] leading-relaxed text-white/50">
                        It is most useful pointed at a project you already know — you can tell
                        immediately whether it got the answer right.
                    </p>
                    <div className="mt-8 flex justify-center">
                        <BuildCommand />
                    </div>
                </div>
            </section>
        </div>
    )
}
