'use client';

// Projects index — every project the signed-in user owns, plus the Add button
// in the top-right corner that asks for a new one.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { Folder01Icon } from '@hugeicons/core-free-icons';

interface Project {
    id: string;
    name: string;
    description: string;
    updatedAt: string;
}

export default function ProjectsPage() {
    const router = useRouter();
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/projects');
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || 'Could not load projects');
            setProjects(json.projects ?? []);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load projects');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const create = useCallback(async () => {
        const trimmed = name.trim();
        if (!trimmed || saving) return;
        setSaving(true);
        try {
            const res = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: trimmed, description: description.trim() }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || 'Could not create the project');
            setAdding(false);
            setName('');
            setDescription('');
            router.push(`/projects/${json.project.id}`);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not create the project');
        } finally {
            setSaving(false);
        }
    }, [name, description, saving, router]);

    return (
        <div className="h-full w-full overflow-y-auto" style={{ background: 'var(--sonoma-chat-bg)' }}>
            <div className="mx-auto w-full" style={{ maxWidth: 860, padding: '32px 24px 64px' }}>
                <header className="flex items-start justify-between gap-4">
                    <div>
                        <h1
                            className="text-[26px] font-medium tracking-[-0.015em]"
                            style={{ fontFamily: 'var(--font-serif)', color: 'var(--sonoma-ink)' }}
                        >
                            Projects
                        </h1>
                        <p className="mt-1 text-[13.5px]" style={{ color: 'var(--sonoma-muted)' }}>
                            Each project keeps its own chats and its own memory.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setAdding(true)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full text-[13.5px] font-medium transition-colors"
                        style={{
                            padding: '9px 14px',
                            background: 'var(--sonoma-accent)',
                            color: '#fff',
                            boxShadow: 'var(--sonoma-shadow-sm)',
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        Add
                    </button>
                </header>

                {error && (
                    <div
                        className="mt-5 rounded-[12px] px-3.5 py-3 text-[13px]"
                        style={{
                            border: '1px solid var(--sonoma-border)',
                            background: 'var(--sonoma-surface)',
                            color: 'var(--sonoma-ink-2)',
                        }}
                    >
                        {error}
                    </div>
                )}

                <div className="mt-6 flex flex-col gap-2">
                    {loading && (
                        <p className="text-[13.5px]" style={{ color: 'var(--sonoma-muted)' }}>
                            Loading…
                        </p>
                    )}
                    {!loading && projects.length === 0 && !error && (
                        <div
                            className="rounded-[14px] px-4 py-8 text-center"
                            style={{
                                border: '1px dashed var(--sonoma-border)',
                                color: 'var(--sonoma-muted)',
                            }}
                        >
                            <p className="text-[14px]">No projects yet.</p>
                            <p className="mt-1 text-[13px]">
                                Use Add in the top right to start one.
                            </p>
                        </div>
                    )}
                    {projects.map((p) => (
                        <Link
                            key={p.id}
                            href={`/projects/${p.id}`}
                            className="flex items-center gap-3 rounded-[14px] px-4 py-3.5 transition-colors"
                            style={{
                                border: '1px solid var(--sonoma-border)',
                                background: 'var(--sonoma-surface)',
                                color: 'var(--sonoma-ink)',
                            }}
                        >
                            <HugeiconsIcon icon={Folder01Icon} size={18} strokeWidth={1.8} />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[14.5px] font-medium">{p.name}</span>
                                {p.description && (
                                    <span
                                        className="mt-0.5 block truncate text-[13px]"
                                        style={{ color: 'var(--sonoma-muted)' }}
                                    >
                                        {p.description}
                                    </span>
                                )}
                            </span>
                        </Link>
                    ))}
                </div>
            </div>

            {adding && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onClick={() => !saving && setAdding(false)}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="w-full max-w-[420px] rounded-[18px] p-5"
                        style={{
                            background: 'var(--sonoma-surface)',
                            border: '1px solid var(--sonoma-border)',
                            boxShadow: 'var(--sonoma-shadow-lg)',
                        }}
                    >
                        <h2 className="text-[17px] font-medium" style={{ color: 'var(--sonoma-ink)' }}>
                            New project
                        </h2>
                        <p className="mt-1 text-[13px]" style={{ color: 'var(--sonoma-muted)' }}>
                            What is this project?
                        </p>
                        <input
                            autoFocus
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') void create();
                                if (e.key === 'Escape') setAdding(false);
                            }}
                            placeholder="Project name"
                            className="mt-4 w-full rounded-[10px] px-3 py-2 text-[14px] outline-none"
                            style={{
                                border: '1px solid var(--sonoma-border)',
                                background: 'var(--sonoma-bg)',
                                color: 'var(--sonoma-ink)',
                            }}
                        />
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="What it's about (optional) — this goes into the project's memory."
                            rows={3}
                            className="mt-2 w-full resize-none rounded-[10px] px-3 py-2 text-[14px] outline-none"
                            style={{
                                border: '1px solid var(--sonoma-border)',
                                background: 'var(--sonoma-bg)',
                                color: 'var(--sonoma-ink)',
                            }}
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setAdding(false)}
                                disabled={saving}
                                className="rounded-full px-3.5 py-2 text-[13.5px]"
                                style={{ color: 'var(--sonoma-ink-2)' }}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void create()}
                                disabled={!name.trim() || saving}
                                className="rounded-full px-4 py-2 text-[13.5px] font-medium"
                                style={{
                                    background: name.trim() ? 'var(--sonoma-accent)' : 'var(--sonoma-bg-2)',
                                    color: name.trim() ? '#fff' : 'var(--sonoma-faint)',
                                }}
                            >
                                {saving ? 'Creating…' : 'Create project'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
