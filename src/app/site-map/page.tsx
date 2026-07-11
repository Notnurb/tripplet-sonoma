'use client';

import Link from 'next/link';
import { LandingHeader } from '@/components/ui/landing-header';
import { LandingFooter } from '@/components/ui/landing-footer';
import { SITEMAP_SECTIONS } from '@/lib/sitemap-data';

type SitemapEntry = {
    url: string;
    changeFrequency: string;
    priority: number;
};

type Section = {
    title: string;
    entries: SitemapEntry[];
};

const sections: Section[] = SITEMAP_SECTIONS.map((section) => ({
    title: section.title,
    entries: section.entries.map((entry) => ({
        url: entry.path,
        changeFrequency: entry.changeFrequency,
        priority: entry.priority,
    })),
}));

const totalUrls = sections.reduce((sum, s) => sum + s.entries.length, 0);

function priorityColor(p: number): string {
    if (p >= 0.9) return 'text-emerald-400';
    if (p >= 0.7) return 'text-sky-400';
    if (p >= 0.5) return 'text-amber-400';
    return 'text-zinc-500';
}

function frequencyLabel(f: string): string {
    return f.charAt(0).toUpperCase() + f.slice(1);
}

export default function SiteMapPage() {
    return (
        <div className="flex min-h-screen w-full flex-col bg-background">
            <LandingHeader />

            <main className="flex-1 w-full max-w-5xl mx-auto px-6 py-16">
                {/* Header */}
                <div className="mb-12">
                    <p className="text-xs font-mono text-muted-foreground/60 tracking-widest uppercase mb-3">
                        sitemap
                    </p>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">
                        Site Map
                    </h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        {totalUrls} indexed pages across {sections.length} sections.
                        Machine-readable sitemaps available at{' '}
                        <Link
                            href="/sitemap.xml"
                            className="font-mono text-foreground/70 underline underline-offset-4 decoration-foreground/20 hover:text-foreground transition-colors"
                        >
                            /sitemap.xml
                        </Link>{' '}
                        and{' '}
                        <Link
                            href="/sitemap.txt"
                            className="font-mono text-foreground/70 underline underline-offset-4 decoration-foreground/20 hover:text-foreground transition-colors"
                        >
                            /sitemap.txt
                        </Link>
                    </p>
                </div>

                {/* Sections */}
                <div className="space-y-10">
                    {sections.map((section) => (
                        <section key={section.title}>
                            <div className="flex items-center gap-3 mb-4">
                                <h2 className="text-xs font-mono font-semibold tracking-widest uppercase text-muted-foreground">
                                    {section.title}
                                </h2>
                                <span className="text-[10px] font-mono text-muted-foreground/40">
                                    {section.entries.length}
                                </span>
                                <div className="flex-1 h-px bg-border" />
                            </div>

                            {/* Table header */}
                            <div className="grid grid-cols-[1fr_100px_70px] gap-2 px-3 mb-1">
                                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/40">
                                    URL
                                </span>
                                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/40">
                                    Frequency
                                </span>
                                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/40 text-right">
                                    Priority
                                </span>
                            </div>

                            {/* Rows */}
                            <div className="rounded-lg border border-border overflow-hidden">
                                {section.entries.map((entry, i) => {
                                    const path = entry.url;
                                    return (
                                        <Link
                                            key={path}
                                            href={path}
                                            className={`grid grid-cols-[1fr_100px_70px] gap-2 px-3 py-2.5 transition-colors hover:bg-muted/50 ${
                                                i !== section.entries.length - 1 ? 'border-b border-border/50' : ''
                                            }`}
                                        >
                                            <span className="font-mono text-sm text-foreground/80 truncate">
                                                {path || '/'}
                                            </span>
                                            <span className="font-mono text-xs text-muted-foreground self-center">
                                                {frequencyLabel(entry.changeFrequency)}
                                            </span>
                                            <span className={`font-mono text-xs text-right self-center font-semibold ${priorityColor(entry.priority)}`}>
                                                {entry.priority.toFixed(1)}
                                            </span>
                                        </Link>
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                </div>

                {/* Footer note */}
                <div className="mt-16 pt-8 border-t border-border">
                    <p className="text-xs font-mono text-muted-foreground/40">
                        Auto-generated from route manifest. XML sitemap conforms to the{' '}
                        <span className="text-muted-foreground/60">sitemaps.org/protocol</span>{' '}
                        specification.
                    </p>
                </div>
            </main>

            <LandingFooter />
        </div>
    );
}
