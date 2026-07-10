'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    Image01Icon,
    Download04Icon,
    Delete02Icon,
    Tick01Icon,
    Edit02Icon,
    Cancel01Icon,
    SparklesIcon,
} from '@hugeicons/core-free-icons';
import { downloadWithWatermark } from '@/lib/utils/image-processing';

// ── Library item (published or just completed) ───────────────────────────────

interface LibraryItem {
    id: string;
    title: string;
    prompt: string;
    url: string;
    published: boolean;
    createdAt: Date;
}

const LIBRARY_KEY = 'tripplet_pixel_library';

function loadLibrary(): LibraryItem[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(LIBRARY_KEY);
        if (!raw) return [];
        return JSON.parse(raw).map((i: any) => ({ ...i, createdAt: new Date(i.createdAt) }));
    } catch { return []; }
}

function saveLibrary(items: LibraryItem[]) {
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(items)); } catch { }
}

// ── Gallery card (completed) ──────────────────────────────────────────────────

function GalleryCard({
    item,
    onDelete,
    onPublish,
    onRename,
}: {
    item: LibraryItem;
    onDelete: (id: string) => void;
    onPublish: (id: string, title: string) => void;
    onRename: (id: string, title: string) => void;
}) {
    const [hovered, setHovered] = useState(false);
    const [editing, setEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState(item.title);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

    const handleDownload = useCallback(async () => {
        await downloadWithWatermark(item.url, `pixel-${item.id}.png`);
    }, [item]);

    const commitTitle = useCallback(() => {
        const trimmed = titleDraft.trim();
        if (trimmed && trimmed !== item.title) onRename(item.id, trimmed);
        setEditing(false);
    }, [titleDraft, item, onRename]);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.93 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.93 }}
            className="relative rounded-2xl overflow-hidden border border-border group aspect-square"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => { setHovered(false); setEditing(false); }}
        >
            <img src={item.url} alt={item.title} className="w-full h-full object-cover" />

            {/* published badge */}
            {item.published && (
                <div className="absolute top-2 left-2 flex items-center gap-1 bg-brand/90 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
                    <HugeiconsIcon icon={Tick01Icon} size={10} />
                    Published
                </div>
            )}

            {/* hover overlay */}
            <AnimatePresence>
                {hovered && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-3"
                    >
                        {/* title row */}
                        <div className="flex items-center gap-1 mb-2">
                            {editing ? (
                                <input
                                    ref={inputRef}
                                    value={titleDraft}
                                    onChange={(e) => setTitleDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') commitTitle();
                                        if (e.key === 'Escape') { setTitleDraft(item.title); setEditing(false); }
                                    }}
                                    onBlur={commitTitle}
                                    className="flex-1 bg-white/10 text-white text-xs px-2 py-1 rounded-md outline-none border border-white/20 min-w-0"
                                />
                            ) : (
                                <p className="flex-1 text-white text-xs font-medium truncate">{item.title}</p>
                            )}
                            <button
                                onClick={() => setEditing(!editing)}
                                className="p-1 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                            >
                                <HugeiconsIcon icon={editing ? Cancel01Icon : Edit02Icon} size={13} />
                            </button>
                        </div>

                        {/* action row */}
                        <div className="flex items-center gap-1.5">
                            {!item.published && (
                                <button
                                    onClick={() => onPublish(item.id, item.title)}
                                    className="flex-1 flex items-center justify-center gap-1.5 bg-brand/90 hover:bg-brand text-white text-xs font-semibold py-1.5 rounded-xl transition-colors"
                                >
                                    <HugeiconsIcon icon={SparklesIcon} size={12} />
                                    Publish
                                </button>
                            )}
                            {item.published && (
                                <button
                                    onClick={() => onPublish(item.id, item.title)}
                                    className="flex-1 flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium py-1.5 rounded-xl transition-colors"
                                >
                                    <HugeiconsIcon icon={Tick01Icon} size={12} />
                                    Published
                                </button>
                            )}
                            <button
                                onClick={handleDownload}
                                className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
                            >
                                <HugeiconsIcon icon={Download04Icon} size={14} />
                            </button>
                            <button
                                onClick={() => onDelete(item.id)}
                                className="p-1.5 rounded-xl bg-white/10 hover:bg-red-500/60 text-white transition-colors"
                            >
                                <HugeiconsIcon icon={Delete02Icon} size={14} />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

// ── Main Pixel page ───────────────────────────────────────────────────────────

export default function PixelPage() {
    const [library, setLibrary] = useState<LibraryItem[]>(loadLibrary);
    const [publishingId, setPublishingId] = useState<string | null>(null);
    const [publishTitle, setPublishTitle] = useState('');

    // ── Library actions ───────────────────────────────────────────────────────
    const handleDelete = useCallback((id: string) => {
        setLibrary((prev) => {
            const updated = prev.filter((i) => i.id !== id);
            saveLibrary(updated);
            return updated;
        });
    }, []);

    const handleRename = useCallback((id: string, title: string) => {
        setLibrary((prev) => {
            const updated = prev.map((i) => i.id === id ? { ...i, title } : i);
            saveLibrary(updated);
            return updated;
        });
    }, []);

    const openPublish = useCallback((id: string, title: string) => {
        setPublishingId(id);
        setPublishTitle(title);
    }, []);

    const confirmPublish = useCallback(() => {
        if (!publishingId) return;
        const finalTitle = publishTitle.trim() || library.find((i) => i.id === publishingId)?.prompt.slice(0, 60) || 'Untitled';
        setLibrary((prev) => {
            const updated = prev.map((i) =>
                i.id === publishingId ? { ...i, published: true, title: finalTitle } : i
            );
            saveLibrary(updated);
            return updated;
        });
        setPublishingId(null);
    }, [publishingId, publishTitle, library]);

    const isEmpty = library.length === 0;

    return (
        <div className="flex flex-col h-full">
            {/* ── Gallery area ──────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-5 py-6">
                {isEmpty ? (
                    <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex flex-col items-center justify-center h-full gap-4 text-center"
                    >
                        <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/15 flex items-center justify-center">
                            <HugeiconsIcon icon={Image01Icon} size={28} className="text-violet-400" />
                        </div>
                        <div>
                            <h2 className="text-base font-semibold text-foreground">Your Pixel library</h2>
                            <p className="text-sm text-muted-foreground mt-1">
                                Your saved images will appear here.
                            </p>
                        </div>
                    </motion.div>
                ) : (
                    <div className="columns-2 sm:columns-3 lg:columns-4 gap-3 space-y-3 max-w-6xl mx-auto">
                        {/* Completed items */}
                        <AnimatePresence>
                            {library.map((item) => (
                                <div key={item.id} className="break-inside-avoid mb-3">
                                    <GalleryCard
                                        item={item}
                                        onDelete={handleDelete}
                                        onPublish={openPublish}
                                        onRename={handleRename}
                                    />
                                </div>
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </div>

            {/* ── Publish modal ─────────────────────────────────────────── */}
            <AnimatePresence>
                {publishingId && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
                            onClick={() => setPublishingId(null)}
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 8 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 8 }}
                            transition={{ duration: 0.18 }}
                            className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
                        >
                            <div
                                className="pointer-events-auto w-full max-w-md bg-card border border-border rounded-3xl p-6 shadow-2xl mx-4"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="flex items-center gap-3 mb-5">
                                    <div className="w-10 h-10 rounded-2xl bg-brand/15 border border-brand/20 flex items-center justify-center">
                                        <HugeiconsIcon icon={SparklesIcon} size={20} className="text-brand" />
                                    </div>
                                    <div>
                                        <h3 className="text-base font-semibold">Publish to Pixel</h3>
                                        <p className="text-xs text-muted-foreground">Give it a title and share it</p>
                                    </div>
                                </div>

                                <div className="space-y-2 mb-5">
                                    <label className="text-xs text-muted-foreground font-medium">Title</label>
                                    <input
                                        autoFocus
                                        value={publishTitle}
                                        onChange={(e) => setPublishTitle(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') confirmPublish(); }}
                                        placeholder="Enter a title for this creation…"
                                        className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand/50 transition-colors"
                                    />
                                    <p className="text-[11px] text-muted-foreground">
                                        Leave blank to use the original prompt as the title.
                                    </p>
                                </div>

                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setPublishingId(null)}
                                        className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={confirmPublish}
                                        className="flex-1 py-2 rounded-xl bg-brand text-brand-foreground text-sm font-semibold hover:bg-brand/90 transition-colors"
                                    >
                                        Publish
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
