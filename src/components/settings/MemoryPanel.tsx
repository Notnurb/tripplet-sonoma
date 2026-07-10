'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { HugeiconsIcon } from '@hugeicons/react';
import { Loading01Icon, Delete02Icon, Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons';

interface Memory {
    id: string;
    content: string;
    tags: string[];
    source: string;
    createdAt: string;
}

// The prompt the user copies and pastes into another AI assistant.
// Designed to elicit a structured JSON dump that the importer below can parse
// without the user having to clean it up by hand.
const EXPORT_PROMPT = `I want to migrate my profile and memories from this assistant to another AI. Based on everything you know about me from our conversations — my preferences, projects, work, goals, communication style, expertise, ongoing context, and personal details I've shared — generate a structured memory dump.

Output ONLY a JSON code block with this exact shape:

\`\`\`json
{
  "profile": "<2-4 sentence summary of who I am, my role, and how I like to work>",
  "memories": [
    { "content": "<single short fact about me, written in third person>", "tags": ["tag1", "tag2"] }
  ]
}
\`\`\`

Rules:
- Each memory is a single self-contained fact, under 200 chars.
- Tags are short categories (preferences, work, projects, goals, technical, personal, communication, tools, etc).
- Aim for 15–40 memories covering breadth, not depth.
- Skip anything sensitive (credentials, financial info, addresses, health data).
- Skip ephemeral context (today's weather, what we discussed yesterday).
- Focus on durable traits and ongoing context that would help a new AI assistant get to know me faster.

Output only the JSON block. No preamble, no commentary.`;

export default function MemoryPanel() {
    const [memories, setMemories] = useState<Memory[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // When the API returns code: MISSING_TABLE it also returns a SQL snippet
    // the user can paste into Neon's SQL editor to create the table.
    const [setupSql, setSetupSql] = useState<string | null>(null);
    const [sqlCopied, setSqlCopied] = useState(false);
    // When code: INVALID_KEY, we also get a list of fix steps + project ref.
    const [fixSteps, setFixSteps] = useState<string[] | null>(null);
    // Diagnostic results from /api/memory/diagnose
    const [diagnostics, setDiagnostics] = useState<{
        overall: 'ok' | 'fail';
        host: string;
        checks: { name: string; status: 'ok' | 'fail' | 'warn'; detail: string; fix?: string }[];
    } | null>(null);
    const [diagnosing, setDiagnosing] = useState(false);

    const [importText, setImportText] = useState('');
    const [importing, setImporting] = useState(false);
    const [replaceAll, setReplaceAll] = useState(false);
    const [promptCopied, setPromptCopied] = useState(false);

    const fetchMemories = useCallback(async () => {
        setLoading(true);
        setError(null);
        setSetupSql(null);
        setFixSteps(null);
        try {
            const res = await fetch('/api/memory?limit=200');
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (res.status === 401) {
                    setMemories([]);
                    return;
                }
                if (data?.code === 'MISSING_TABLE' && typeof data?.sql === 'string') {
                    setSetupSql(data.sql);
                }
                if (data?.code === 'INVALID_KEY' && Array.isArray(data?.fixSteps)) {
                    setFixSteps(data.fixSteps);
                }
                // Surface the server's actual error message (table missing, etc)
                // instead of swallowing it.
                throw new Error(data?.error || `Server returned ${res.status}`);
            }
            setMemories(data.memories ?? []);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load');
            setMemories([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const runDiagnostics = useCallback(async () => {
        setDiagnosing(true);
        setDiagnostics(null);
        try {
            const res = await fetch('/api/memory/diagnose');
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`);
            setDiagnostics(data);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Diagnostics failed');
        } finally {
            setDiagnosing(false);
        }
    }, []);

    const copySetupSql = useCallback(async () => {
        if (!setupSql) return;
        try {
            if (navigator.clipboard?.writeText && window.isSecureContext) {
                await navigator.clipboard.writeText(setupSql);
            } else {
                const ta = document.createElement('textarea');
                ta.value = setupSql;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            setSqlCopied(true);
            toast.success('SQL copied — paste it into the Neon SQL Editor');
            setTimeout(() => setSqlCopied(false), 2000);
        } catch {
            toast.error('Could not copy. Select the SQL manually.');
        }
    }, [setupSql]);

    useEffect(() => {
        fetchMemories();
    }, [fetchMemories]);

    const copyPrompt = useCallback(async () => {
        try {
            if (navigator.clipboard?.writeText && window.isSecureContext) {
                await navigator.clipboard.writeText(EXPORT_PROMPT);
            } else {
                const ta = document.createElement('textarea');
                ta.value = EXPORT_PROMPT;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            setPromptCopied(true);
            toast.success('Prompt copied — paste it into ChatGPT, Claude, or another assistant');
            setTimeout(() => setPromptCopied(false), 2000);
        } catch {
            toast.error('Could not copy. Select the text manually.');
        }
    }, []);

    const handleImport = useCallback(async () => {
        if (!importText.trim()) {
            toast.error('Paste the AI output first');
            return;
        }
        setImporting(true);
        try {
            const res = await fetch('/api/memory/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ raw: importText, replace: replaceAll }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Import failed');
            }
            toast.success(
                `Imported ${data.imported} memor${data.imported === 1 ? 'y' : 'ies'}${data.profileImported ? ' (including profile summary)' : ''}.`,
            );
            setImportText('');
            setReplaceAll(false);
            await fetchMemories();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Import failed');
        } finally {
            setImporting(false);
        }
    }, [importText, replaceAll, fetchMemories]);

    const deleteMemory = useCallback(
        async (id: string) => {
            try {
                const res = await fetch('/api/memory', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'delete', id }),
                });
                if (!res.ok) throw new Error('Delete failed');
                setMemories((prev) => (prev ? prev.filter((m) => m.id !== id) : prev));
            } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Delete failed');
            }
        },
        [],
    );

    const clearAll = useCallback(async () => {
        if (!confirm('Delete ALL memories? This cannot be undone.')) return;
        try {
            const res = await fetch('/api/memory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'clear' }),
            });
            if (!res.ok) throw new Error('Clear failed');
            setMemories([]);
            toast.success('All memories deleted');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Clear failed');
        }
    }, []);

    const memoryCount = memories?.length ?? 0;
    const profileMemory = useMemo(
        () => memories?.find((m) => m.tags.includes('profile')) ?? null,
        [memories],
    );

    return (
        <section className="space-y-4">
            <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Memory & Profile
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                    Tripplet builds a persistent profile from every conversation. Export it to another AI, or
                    seed a fresh account with memories from an existing assistant.
                </p>
            </div>

            {/* Profile summary card (if exists) */}
            {profileMemory && (
                <div className="rounded-xl border border-border bg-muted/30 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Profile summary
                    </div>
                    <p className="text-sm leading-relaxed">{profileMemory.content}</p>
                </div>
            )}

            {/* Export prompt */}
            <div className="rounded-xl border border-border p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="text-sm font-medium">Export prompt</div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Copy this prompt and paste it into another AI assistant (ChatGPT, Claude, Gemini, etc.)
                            that already knows you. It will reply with a structured memory dump you can paste back below.
                        </p>
                    </div>
                    <Button onClick={copyPrompt} variant="outline" size="sm">
                        <HugeiconsIcon
                            icon={promptCopied ? Tick02Icon : Copy01Icon}
                            size={14}
                            className="mr-2"
                        />
                        {promptCopied ? 'Copied' : 'Copy prompt'}
                    </Button>
                </div>
                <pre className="text-[11.5px] leading-relaxed font-mono whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 max-h-44 overflow-y-auto">
                    {EXPORT_PROMPT}
                </pre>
            </div>

            {/* Import memories */}
            <div className="rounded-xl border border-border p-5 space-y-3">
                <div>
                    <div className="text-sm font-medium">Import memories</div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Paste the output from another AI (JSON or bullet list). Tripplet will load it into your
                        persistent memory so Sonoma already knows you from message one.
                    </p>
                </div>
                <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder='Paste the JSON block from the other AI here…'
                    rows={6}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] font-mono outline-none focus:border-foreground/40"
                />
                <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
                        <input
                            type="checkbox"
                            checked={replaceAll}
                            onChange={(e) => setReplaceAll(e.target.checked)}
                            className="accent-foreground"
                        />
                        Replace all existing memories
                    </label>
                    <Button
                        onClick={handleImport}
                        disabled={importing || !importText.trim()}
                        size="sm"
                    >
                        {importing && (
                            <HugeiconsIcon icon={Loading01Icon} className="animate-spin mr-2" size={14} />
                        )}
                        Import
                    </Button>
                </div>
            </div>

            {/* Stored memories list */}
            <div className="rounded-xl border border-border p-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <div className="text-sm font-medium">
                            Stored memories
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                                ({memoryCount})
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Persistent across every chat, every device, every workspace.
                        </p>
                    </div>
                    {memoryCount > 0 && (
                        <Button
                            onClick={clearAll}
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                        >
                            Clear all
                        </Button>
                    )}
                </div>

                {loading && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                        <HugeiconsIcon icon={Loading01Icon} className="animate-spin" size={14} />
                        Loading…
                    </div>
                )}

                {error && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 space-y-3">
                        <p className="text-xs text-destructive">{error}</p>

                        {fixSteps && fixSteps.length > 0 && (
                            <div className="space-y-1.5">
                                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                                    How to fix
                                </p>
                                <ol className="space-y-1 text-[11.5px] text-muted-foreground list-decimal pl-4">
                                    {fixSteps.map((step, i) => {
                                        // Make any embedded URL clickable.
                                        const urlMatch = step.match(/(https?:\/\/\S+)/);
                                        if (urlMatch) {
                                            const [pre, post] = step.split(urlMatch[0]);
                                            return (
                                                <li key={i}>
                                                    {pre}
                                                    <a
                                                        href={urlMatch[0]}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="underline text-foreground font-medium hover:opacity-80"
                                                    >
                                                        {urlMatch[0]}
                                                    </a>
                                                    {post}
                                                </li>
                                            );
                                        }
                                        return <li key={i}>{step}</li>;
                                    })}
                                </ol>
                            </div>
                        )}

                        {setupSql && (
                            <div className="space-y-2">
                                <p className="text-[11px] text-muted-foreground">
                                    Copy this SQL, open your Neon project → SQL Editor → New query, paste, and Run.
                                    Then click Retry below.
                                </p>
                                <pre className="text-[10.5px] leading-relaxed font-mono whitespace-pre-wrap rounded-lg border border-border bg-background/60 p-2.5 max-h-48 overflow-y-auto">
                                    {setupSql}
                                </pre>
                                <Button onClick={copySetupSql} variant="outline" size="sm">
                                    <HugeiconsIcon
                                        icon={sqlCopied ? Tick02Icon : Copy01Icon}
                                        size={14}
                                        className="mr-2"
                                    />
                                    {sqlCopied ? 'SQL copied' : 'Copy SQL'}
                                </Button>
                            </div>
                        )}

                        <div className="flex flex-wrap items-center gap-3 pt-1">
                            <button
                                type="button"
                                onClick={fetchMemories}
                                className="text-[11px] font-medium underline text-destructive hover:opacity-80"
                            >
                                Retry
                            </button>
                            <button
                                type="button"
                                onClick={runDiagnostics}
                                disabled={diagnosing}
                                className="text-[11px] font-medium underline text-muted-foreground hover:text-foreground disabled:opacity-50"
                            >
                                {diagnosing ? 'Diagnosing…' : 'Run diagnostics'}
                            </button>
                        </div>

                        {diagnostics && (
                            <div className="mt-2 space-y-1.5 rounded-lg border border-border bg-background/60 p-2.5">
                                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                                    Diagnostics ({diagnostics.overall === 'ok' ? 'all green ✓' : 'issues found'})
                                </p>
                                <ul className="space-y-1">
                                    {diagnostics.checks.map((c, i) => (
                                        <li key={i} className="text-[11.5px] leading-snug">
                                            <span
                                                className={
                                                    c.status === 'ok'
                                                        ? 'text-emerald-500'
                                                        : c.status === 'warn'
                                                            ? 'text-amber-500'
                                                            : 'text-destructive'
                                                }
                                            >
                                                {c.status === 'ok' ? '✓' : c.status === 'warn' ? '!' : '✗'}{' '}
                                            </span>
                                            <span className="font-mono">{c.name}</span>
                                            <span className="text-muted-foreground"> — {c.detail}</span>
                                            {c.fix && (
                                                <div className="text-[10.5px] text-muted-foreground pl-4 mt-0.5">
                                                    → {c.fix}
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}

                {!loading && memories && memories.length === 0 && (
                    <div className="text-xs text-muted-foreground py-3">
                        No memories yet. Start chatting — Tripplet will remember important things automatically.
                        Or import memories above to bootstrap your profile.
                    </div>
                )}

                {!loading && memories && memories.length > 0 && (
                    <ul className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                        {memories.map((m) => (
                            <li
                                key={m.id}
                                className="group flex items-start gap-2 rounded-lg border border-border bg-background hover:bg-muted/30 px-3 py-2 transition-colors"
                            >
                                <div className="flex-1 min-w-0">
                                    <p className="text-[13px] leading-snug break-words">{m.content}</p>
                                    {m.tags.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-1.5">
                                            {m.tags.map((t) => (
                                                <span
                                                    key={t}
                                                    className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                                                >
                                                    {t}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => deleteMemory(m.id)}
                                    title="Delete memory"
                                    aria-label="Delete memory"
                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1 rounded-md hover:bg-destructive/10"
                                >
                                    <HugeiconsIcon icon={Delete02Icon} size={14} />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}
