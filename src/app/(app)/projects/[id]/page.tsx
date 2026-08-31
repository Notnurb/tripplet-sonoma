'use client';

// A single project: chat that carries the project's name, plus a panel for
// the memory that project has collected.

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { Folder01Icon } from '@hugeicons/core-free-icons';
import SonomaChatShell from '@/components/Sonoma/ChatShell';
import { SERVERLESS_EVENT } from '@/lib/dev/serverless';

interface Project {
    id: string;
    name: string;
    description: string;
}

interface ProjectMemory {
    id: string;
    content: string;
    source: 'explicit' | 'auto';
    createdAt: string;
}

export default function ProjectPage() {
    const params = useParams();
    const id = typeof params?.id === 'string' ? params.id : undefined;
    const [project, setProject] = useState<Project | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [memories, setMemories] = useState<ProjectMemory[]>([]);
    const [memoryError, setMemoryError] = useState<string | null>(null);
    const [panelOpen, setPanelOpen] = useState(false);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!id) return;
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch(`/api/projects/${id}`);
                const json = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(json.error || 'Could not load this project');
                if (!cancelled) setProject(json.project);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load this project');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [id]);

    const loadMemories = useCallback(async () => {
        if (!id) return;
        try {
            const res = await fetch(`/api/projects/${id}/memory`);
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || 'Could not load project memory');
            setMemories(json.memories ?? []);
            setMemoryError(null);
        } catch (e) {
            setMemoryError(e instanceof Error ? e.message : 'Could not load project memory');
        }
    }, [id]);

    useEffect(() => {
        void loadMemories();
    }, [loadMemories]);

    // Memory is learned in the background after each reply, so refresh when
    // the panel opens, on a slow tick while it's open, and whenever the
    // serverless store changes.
    useEffect(() => {
        if (!panelOpen) return;
        void loadMemories();
        const t = setInterval(() => void loadMemories(), 8000);
        const onServerless = () => void loadMemories();
        window.addEventListener(SERVERLESS_EVENT, onServerless);
        return () => {
            clearInterval(t);
            window.removeEventListener(SERVERLESS_EVENT, onServerless);
        };
    }, [panelOpen, loadMemories]);

    const addMemory = useCallback(async () => {
        const content = draft.trim();
        if (!id || !content || saving) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/projects/${id}/memory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || 'Could not save that');
            setDraft('');
            await loadMemories();
        } catch (e) {
            setMemoryError(e instanceof Error ? e.message : 'Could not save that');
        } finally {
            setSaving(false);
        }
    }, [draft, id, saving, loadMemories]);

    const removeMemory = useCallback(
        async (memoryId: string) => {
            if (!id) return;
            setMemories((prev) => prev.filter((m) => m.id !== memoryId));
            try {
                await fetch(`/api/projects/${id}/memory?memoryId=${encodeURIComponent(memoryId)}`, {
                    method: 'DELETE',
                });
            } finally {
                await loadMemories();
            }
        },
        [id, loadMemories],
    );

    if (error) {
        return (
            <div
                className="flex h-full w-full items-center justify-center p-6 text-center text-[14px]"
                style={{ background: 'var(--sonoma-chat-bg)', color: 'var(--sonoma-muted)' }}
            >
                {error}
            </div>
        );
    }

    return (
        <div className="relative flex h-full w-full">
            <div className="relative min-w-0 flex-1">
                <SonomaChatShell
                    projectId={id}
                    projectName={project?.name}
                    greeting={{
                        title: project?.name ?? 'Project',
                        sub: project?.description || 'Everything here is remembered for this project.',
                        placeholder: 'How may I help?',
                    }}
                />

                {/* Memory toggle — mirrors the project pill on the other side. */}
                <button
                    type="button"
                    onClick={() => setPanelOpen((o) => !o)}
                    className="absolute right-5 top-3 z-20 inline-flex items-center gap-1.5 rounded-full text-[13px] font-medium"
                    style={{
                        padding: '6px 12px',
                        background: panelOpen ? 'var(--sonoma-accent-soft)' : 'var(--sonoma-surface)',
                        border: '1px solid var(--sonoma-border)',
                        color: panelOpen ? 'var(--sonoma-accent-2)' : 'var(--sonoma-ink)',
                        boxShadow: 'var(--sonoma-shadow-sm)',
                    }}
                >
                    <HugeiconsIcon icon={Folder01Icon} size={15} strokeWidth={1.8} />
                    Memory
                    <span style={{ color: 'var(--sonoma-muted)' }}>{memories.length}</span>
                </button>
            </div>

            {panelOpen && (
                <aside
                    className="flex h-full w-[320px] shrink-0 flex-col overflow-hidden max-md:absolute max-md:right-0 max-md:z-30 max-md:w-[86vw]"
                    style={{
                        background: 'var(--sonoma-sidebar-bg)',
                        borderLeft: '1px solid var(--sonoma-border)',
                    }}
                >
                    <div
                        className="flex items-center justify-between px-4"
                        style={{ minHeight: 56 }}
                    >
                        <span className="text-[14px] font-medium" style={{ color: 'var(--sonoma-ink)' }}>
                            Project memory
                        </span>
                        <button
                            type="button"
                            onClick={() => setPanelOpen(false)}
                            aria-label="Close project memory"
                            className="rounded-md px-2 text-[16px]"
                            style={{ color: 'var(--sonoma-ink-2)' }}
                        >
                            ×
                        </button>
                    </div>

                    <p className="px-4 pb-3 text-[12px] leading-relaxed" style={{ color: 'var(--sonoma-muted)' }}>
                        What Sonoma remembers about this project. Facts are collected automatically
                        after each reply; you can also add or delete them here.
                    </p>

                    <div className="px-4 pb-3">
                        <textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    void addMemory();
                                }
                            }}
                            rows={2}
                            placeholder="Remember that…"
                            className="w-full resize-none rounded-[10px] px-3 py-2 text-[13px] outline-none"
                            style={{
                                border: '1px solid var(--sonoma-border)',
                                background: 'var(--sonoma-surface)',
                                color: 'var(--sonoma-ink)',
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => void addMemory()}
                            disabled={!draft.trim() || saving}
                            className="mt-2 w-full rounded-full py-1.5 text-[13px] font-medium"
                            style={{
                                background: draft.trim() ? 'var(--sonoma-accent)' : 'var(--sonoma-bg-2)',
                                color: draft.trim() ? '#fff' : 'var(--sonoma-faint)',
                            }}
                        >
                            {saving ? 'Saving…' : 'Add memory'}
                        </button>
                    </div>

                    {memoryError && (
                        <p className="px-4 pb-2 text-[12px]" style={{ color: 'var(--sonoma-ink-2)' }}>
                            {memoryError}
                        </p>
                    )}

                    <div className="flex-1 overflow-y-auto px-4 pb-6">
                        {memories.length === 0 && !memoryError && (
                            <p className="text-[12.5px]" style={{ color: 'var(--sonoma-muted)' }}>
                                Nothing yet — chat in this project and facts will show up here.
                            </p>
                        )}
                        <ul className="flex flex-col gap-2">
                            {memories.map((m) => (
                                <li
                                    key={m.id}
                                    className="group rounded-[12px] px-3 py-2.5 text-[13px]"
                                    style={{
                                        border: '1px solid var(--sonoma-border)',
                                        background: 'var(--sonoma-surface)',
                                        color: 'var(--sonoma-ink)',
                                    }}
                                >
                                    <div className="flex items-start gap-2">
                                        <span className="min-w-0 flex-1 leading-[1.45]">{m.content}</span>
                                        <button
                                            type="button"
                                            onClick={() => void removeMemory(m.id)}
                                            aria-label="Delete memory"
                                            className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                                            style={{ color: 'var(--sonoma-ink-2)' }}
                                        >
                                            ×
                                        </button>
                                    </div>
                                    <span
                                        className="mt-1 block text-[11px] uppercase tracking-wide"
                                        style={{ color: 'var(--sonoma-faint)' }}
                                    >
                                        {m.source === 'auto' ? 'learned' : 'saved by you'}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </aside>
            )}
        </div>
    );
}
