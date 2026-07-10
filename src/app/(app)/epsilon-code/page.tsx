import Link from 'next/link';
import { ArrowUpRight, ShieldCheck, Terminal, Workflow } from 'lucide-react';

const featureLibrary = [
    {
        title: 'Repo-Aware Code Generation',
        whatItDoes: 'Reads your project context and proposes or writes code changes from the terminal.',
        whyUseful: 'Cuts iteration time for multi-file features and refactors.',
    },
    {
        title: 'Guided Refactors',
        whatItDoes: 'Helps rename, restructure, and modernize code safely across files.',
        whyUseful: 'Keeps larger changes organized and consistent.',
    },
    {
        title: 'Bug-Fix Workflows',
        whatItDoes: 'Targets failing behavior, suggests fixes, and iterates toward stable output.',
        whyUseful: 'Speeds up debug loops when you need practical fixes quickly.',
    },
    {
        title: 'Command-Line First Automation',
        whatItDoes: 'Runs from terminal sessions so it fits existing dev workflows and scripts.',
        whyUseful: 'Easy to integrate into daily engineering routines and CI-friendly processes.',
    },
    {
        title: 'Competitive Agentic Coding',
        whatItDoes: 'Built as a terminal CLI alternative to tools like Claude Code and Kimi Code.',
        whyUseful: 'Gives teams another high-agency coding assistant option in the same category.',
    },
    {
        title: 'Practical Output Focus',
        whatItDoes: 'Prioritizes actionable code edits and implementation-ready responses.',
        whyUseful: 'Reduces overhead and gets from prompt to working code faster.',
    },
];

export default function EpsilonCodePage() {
    return (
        <div className="h-full overflow-y-auto px-6 py-6">
            <div className="mx-auto w-full max-w-6xl space-y-6">
                <section className="rounded-2xl border border-border bg-card p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-2">
                            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                                <Terminal className="h-3.5 w-3.5" />
                                Terminal CLI
                            </div>
                            <h1 className="text-2xl font-semibold tracking-tight">Epsilon Code</h1>
                            <p className="max-w-3xl text-sm text-muted-foreground">
                                <code className="font-mono">epilsoncli</code> is a terminal-first coding agent in the same space as Claude Code and Kimi Code.
                                Use it to build features, refactor faster, and ship practical code updates from your CLI.
                            </p>
                        </div>
                        <Link
                            href="https://www.npmjs.com/package/epilsoncli"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
                        >
                            View on npm
                            <ArrowUpRight className="h-4 w-4" />
                        </Link>
                    </div>
                </section>

                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {featureLibrary.map((feature) => (
                        <article key={feature.title} className="rounded-xl border border-border bg-card p-4">
                            <h2 className="text-sm font-semibold">{feature.title}</h2>
                            <p className="mt-2 text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">What it does:</span> {feature.whatItDoes}
                            </p>
                            <p className="mt-1.5 text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">Why it is useful:</span> {feature.whyUseful}
                            </p>
                        </article>
                    ))}
                </section>

                <section className="grid gap-4 lg:grid-cols-2">
                    <article className="rounded-xl border border-border bg-card p-4">
                        <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
                            <Workflow className="h-4 w-4" />
                            How To Get It
                        </h2>
                        <ol className="space-y-3 text-sm text-muted-foreground">
                            <li>
                                1. Install globally:
                                <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground">npm install -g epilsoncli</pre>
                            </li>
                            <li>
                                2. Or run it without global install:
                                <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground">npx -y epilsoncli --help</pre>
                            </li>
                            <li>
                                3. Start using commands in your project directory:
                                <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground">epilsoncli --help</pre>
                            </li>
                        </ol>
                    </article>

                    <article className="rounded-xl border border-border bg-card p-4">
                        <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
                            <ShieldCheck className="h-4 w-4" />
                            Why Teams Use It
                        </h2>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                            <li>Faster feature delivery with CLI-native workflows.</li>
                            <li>Lower context switching between editor and terminal tasks.</li>
                            <li>Better consistency for iterative code improvements and refactors.</li>
                            <li>Strong fit for developers who prefer high-agency coding tools in terminal environments.</li>
                        </ul>
                    </article>
                </section>
            </div>
        </div>
    );
}
