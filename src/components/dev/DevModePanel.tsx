'use client';

/**
 * Dev-mode panel (src/lib/dev-mode.ts). Mounted globally from providers.tsx;
 * renders nothing unless dev-mode is active on the dev server.
 *
 * Press "q" anywhere outside a text box to toggle it. Esc closes it.
 *  - Screenshots: full-resolution tab capture via getDisplayMedia. The whole
 *    panel (pill included) unmounts before the picker opens, so captures never
 *    contain dev UI. The 3s-delay variant leaves time to open menus/hover.
 *  - Blog: writes a real post into the blog source files via /api/dev/blog —
 *    live after hot reload, ships with the next commit.
 *  - Experiments: layout outlines + viewport readout for quick UI poking.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { usePathname } from 'next/navigation';
import { DEV_USER, isDevModeActive } from '@/lib/dev-mode';

export function DevModePanel() {
    if (!isDevModeActive()) return null;
    return <DevModePanelInner />;
}

const BLOG_CATEGORIES = ['Engineering', 'Models', 'Product', 'Company'];

const nextPaint = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function DevModePanelInner() {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const [capturing, setCapturing] = useState(false);
    const [shotStatus, setShotStatus] = useState<string | null>(null);
    const [viewport, setViewport] = useState('');
    const [outlines, setOutlines] = useState(false);

    // Blog composer state
    const [title, setTitle] = useState('');
    const [category, setCategory] = useState('Engineering');
    const [excerpt, setExcerpt] = useState('');
    const [body, setBody] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [blogError, setBlogError] = useState<string | null>(null);
    const [blogResult, setBlogResult] = useState<{ slug: string; url: string; files: string[] } | null>(null);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing) return;
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            if (event.key === 'Escape') {
                setOpen(false);
                return;
            }
            if (event.key.toLowerCase() !== 'q') return;
            const target = event.target as HTMLElement | null;
            if (
                target &&
                (target.isContentEditable ||
                    target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'))
            ) {
                return;
            }
            event.preventDefault();
            setOpen((value) => !value);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    useEffect(() => {
        const update = () => setViewport(`${window.innerWidth}×${window.innerHeight} @ ${window.devicePixelRatio}x`);
        update();
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);

    useEffect(() => {
        if (!outlines) return;
        const style = document.createElement('style');
        style.textContent = '* { outline: 1px solid rgba(244, 114, 182, 0.4) !important; }';
        document.head.appendChild(style);
        return () => style.remove();
    }, [outlines]);

    const captureScreenshot = useCallback(async (delayMs: number) => {
        setShotStatus(null);
        setCapturing(true); // unmounts all dev UI before anything is captured
        try {
            await nextPaint();
            const constraints = {
                audio: false,
                video: { displaySurface: 'browser' },
                // Chrome hints: offer/preselect this tab, keep the capture on it.
                preferCurrentTab: true,
                selfBrowserSurface: 'include',
                surfaceSwitching: 'exclude',
            } as unknown as Parameters<MediaDevices['getDisplayMedia']>[0];
            const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
            try {
                if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
                const video = document.createElement('video');
                video.srcObject = stream;
                video.muted = true;
                video.playsInline = true;
                await video.play();
                if (video.readyState < 2) {
                    await new Promise<void>((resolve, reject) => {
                        video.onloadeddata = () => resolve();
                        video.onerror = () => reject(new Error('could not read the capture stream'));
                    });
                }
                await nextPaint();
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('canvas 2D context unavailable');
                ctx.drawImage(video, 0, 0);
                const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
                if (!blob) throw new Error('PNG encoding failed');
                const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `tripplet-${stamp}.png`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
                setShotStatus(`Saved ${link.download} (${canvas.width}×${canvas.height})`);
            } finally {
                stream.getTracks().forEach((track) => track.stop());
            }
        } catch (error) {
            const cancelled = error instanceof DOMException && error.name === 'NotAllowedError';
            setShotStatus(
                cancelled
                    ? 'Capture cancelled.'
                    : `Capture failed: ${error instanceof Error ? error.message : 'unknown error'}`,
            );
        } finally {
            setCapturing(false);
        }
    }, []);

    const submitBlog = useCallback(
        async (event: FormEvent) => {
            event.preventDefault();
            setSubmitting(true);
            setBlogError(null);
            setBlogResult(null);
            try {
                const res = await fetch('/api/dev/blog', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, category, excerpt, body }),
                });
                const data = (await res.json()) as { slug?: string; url?: string; files?: string[]; error?: string };
                if (!res.ok || !data.slug || !data.url) {
                    throw new Error(data.error || `HTTP ${res.status}`);
                }
                setBlogResult({ slug: data.slug, url: data.url, files: data.files ?? [] });
                setTitle('');
                setExcerpt('');
                setBody('');
            } catch (error) {
                setBlogError(error instanceof Error ? error.message : 'Failed to publish the post.');
            } finally {
                setSubmitting(false);
            }
        },
        [title, category, excerpt, body],
    );

    // While capturing, every trace of dev UI leaves the DOM so it can't appear
    // in the screenshot.
    if (capturing) return null;

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="fixed bottom-4 right-4 z-[9998] inline-flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-lg backdrop-blur transition-colors hover:text-foreground"
                aria-label="Open the dev panel (q)"
            >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                DEV
                <kbd className="rounded border border-border px-1 font-mono text-[10px]">q</kbd>
            </button>
        );
    }

    const inputClass =
        'w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-foreground/30';
    const buttonClass =
        'rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10 disabled:cursor-not-allowed disabled:opacity-50';

    return (
        <div
            className="fixed bottom-4 right-4 z-[9999] flex max-h-[min(680px,calc(100vh-2rem))] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-2xl border border-border bg-card/95 p-4 text-sm shadow-2xl backdrop-blur-xl"
            role="dialog"
            aria-label="Tripplet dev panel"
        >
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="font-semibold">Tripplet Dev</span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        dev-mode
                    </span>
                </div>
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-md px-2 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="Close dev panel"
                >
                    ×
                </button>
            </div>

            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Login bypass active — signed in as <span className="text-foreground">{DEV_USER.name}</span> ({DEV_USER.email}).
                A real login always takes precedence.
            </p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {pathname} · {viewport}
            </p>

            {/* Screenshots */}
            <div className="mt-4 border-t border-border pt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Screenshot</div>
                <div className="mt-2 flex gap-2">
                    <button type="button" className={buttonClass} onClick={() => captureScreenshot(0)}>
                        Capture now
                    </button>
                    <button type="button" className={buttonClass} onClick={() => captureScreenshot(3000)}>
                        Capture in 3s
                    </button>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    Full-resolution tab capture — the panel hides itself first. Pick “This Tab” in the browser prompt.
                    The 3s delay runs after the prompt, so you can open menus or hover things.
                </p>
                {shotStatus && <p className="mt-1.5 text-[11px] text-foreground">{shotStatus}</p>}
            </div>

            {/* Blog composer */}
            <div className="mt-4 border-t border-border pt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">New blog post</div>
                <form onSubmit={submitBlog} className="mt-2 space-y-2">
                    <input
                        className={inputClass}
                        placeholder="Title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={120}
                        required
                    />
                    <input
                        className={inputClass}
                        placeholder="Category"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        maxLength={40}
                        list="devmode-blog-categories"
                    />
                    <datalist id="devmode-blog-categories">
                        {BLOG_CATEGORIES.map((c) => (
                            <option key={c} value={c} />
                        ))}
                    </datalist>
                    <textarea
                        className={`${inputClass} min-h-[52px] resize-y`}
                        placeholder="Excerpt (shown on the blog index)"
                        value={excerpt}
                        onChange={(e) => setExcerpt(e.target.value)}
                        maxLength={500}
                        required
                    />
                    <textarea
                        className={`${inputClass} min-h-[120px] resize-y font-mono text-xs`}
                        placeholder={'Body — blank line = new paragraph, start a line with "## " for a section heading.'}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        maxLength={20000}
                        required
                    />
                    <button type="submit" className={buttonClass} disabled={submitting}>
                        {submitting ? 'Writing…' : 'Publish to source'}
                    </button>
                </form>
                {blogError && <p className="mt-1.5 text-[11px] text-red-400">{blogError}</p>}
                {blogResult && (
                    <div className="mt-2 rounded-lg border border-border bg-background p-2 text-[11px] leading-relaxed text-muted-foreground">
                        Post written to {blogResult.files.length} source file{blogResult.files.length === 1 ? '' : 's'} —
                        live after hot reload, ships with your next commit.{' '}
                        <a href={blogResult.url} className="text-foreground underline underline-offset-2">
                            Open {blogResult.url}
                        </a>
                    </div>
                )}
            </div>

            {/* Experiments */}
            <div className="mt-4 border-t border-border pt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Experiment</div>
                <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                        type="checkbox"
                        checked={outlines}
                        onChange={(e) => setOutlines(e.target.checked)}
                        className="h-3.5 w-3.5 accent-current"
                    />
                    Outline every element (layout debug)
                </label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {[
                        ['/', 'Landing'],
                        ['/chat', 'Chat'],
                        ['/blog', 'Blog'],
                        ['/triplepedia', 'Triplepedia'],
                    ].map(([href, label]) => (
                        <a
                            key={href}
                            href={href}
                            className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                            {label}
                        </a>
                    ))}
                </div>
            </div>

            <p className="mt-4 border-t border-border pt-2 text-[10px] leading-relaxed text-muted-foreground/70">
                q toggles · Esc closes · flip DEV_MODE_ACTIVE in src/lib/dev-mode.ts to turn dev-mode off.
            </p>
        </div>
    );
}
