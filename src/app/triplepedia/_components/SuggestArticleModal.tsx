'use client';

import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Trash2, Check, ImagePlus, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

interface Section {
    heading: string;
    content: string;
}

interface InfoboxEntry {
    label: string;
    value: string;
}

interface Props {
    open: boolean;
    onClose: () => void;
    onSubmitted?: () => void;
}

function slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

export default function SuggestArticleModal({ open, onClose, onSubmitted }: Props) {
    const [title, setTitle] = useState('');
    const [summary, setSummary] = useState('');
    const [sections, setSections] = useState<Section[]>([{ heading: '', content: '' }]);
    const [infobox, setInfobox] = useState<InfoboxEntry[]>([{ label: '', value: '' }]);

    // Image state
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [imageCaption, setImageCaption] = useState('');
    const [imageUploading, setImageUploading] = useState(false);
    const [imageDragging, setImageDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState('');
    const { user } = useAuth();

    // ── Section helpers ──────────────────────────────────────────────────
    const addSection = () => setSections((p) => [...p, { heading: '', content: '' }]);
    const removeSection = (i: number) => setSections((p) => p.filter((_, idx) => idx !== i));
    const updateSection = (i: number, f: keyof Section, v: string) =>
        setSections((p) => p.map((s, idx) => (idx === i ? { ...s, [f]: v } : s)));

    // ── Infobox helpers ──────────────────────────────────────────────────
    const addInfobox = () => setInfobox((p) => [...p, { label: '', value: '' }]);
    const removeInfobox = (i: number) => setInfobox((p) => p.filter((_, idx) => idx !== i));
    const updateInfobox = (i: number, f: keyof InfoboxEntry, v: string) =>
        setInfobox((p) => p.map((e, idx) => (idx === i ? { ...e, [f]: v } : e)));

    // ── Image helpers ────────────────────────────────────────────────────
    const applyImageFile = useCallback((file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('Please upload a valid image file.');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setError('Image must be under 5 MB.');
            return;
        }
        setError('');
        setImageFile(file);
        const url = URL.createObjectURL(file);
        setImagePreview(url);
    }, []);

    const handleFileInput = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const f = e.target.files?.[0];
            if (f) applyImageFile(f);
        },
        [applyImageFile]
    );

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setImageDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) applyImageFile(f);
        },
        [applyImageFile]
    );

    const removeImage = useCallback(() => {
        if (imagePreview) URL.revokeObjectURL(imagePreview);
        setImageFile(null);
        setImagePreview(null);
        setImageCaption('');
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, [imagePreview]);

    // ── Upload image to storage API ──────────────────────────────────────
    const uploadImage = useCallback(async (): Promise<string | null> => {
        if (!imageFile) return null;
        setImageUploading(true);
        const fd = new FormData();
        fd.append('file', imageFile);
        const res = await fetch('/api/triplepedia/upload', { method: 'POST', body: fd });
        setImageUploading(false);
        if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            setError(json.error ?? 'Image upload failed.');
            return null;
        }
        const { url } = await res.json();
        return url as string;
    }, [imageFile]);

    // ── Reset ────────────────────────────────────────────────────────────
    const reset = useCallback(() => {
        setTitle('');
        setSummary('');
        setSections([{ heading: '', content: '' }]);
        setInfobox([{ label: '', value: '' }]);
        removeImage();
        setImageCaption('');
        setError('');
        setDone(false);
    }, [removeImage]);

    // ── Submit ───────────────────────────────────────────────────────────
    const handleSubmit = async () => {
        if (!title.trim() || !summary.trim()) {
            setError('Title and summary are required.');
            return;
        }
        setError('');
        setSubmitting(true);

        // Upload image first if one is selected
        let uploadedImageUrl: string | null = null;
        if (imageFile) {
            uploadedImageUrl = await uploadImage();
            if (!uploadedImageUrl) {
                setSubmitting(false);
                return;
            }
        }

        const filteredSections = sections.filter((s) => s.heading.trim() || s.content.trim());
        const filteredInfobox = infobox.filter((e) => e.label.trim() && e.value.trim());

        // Prepend the image entry so it renders at the top of the infobox
        const finalInfobox: InfoboxEntry[] = [
            ...(uploadedImageUrl
                ? [
                      { label: '__image__', value: uploadedImageUrl },
                      ...(imageCaption.trim()
                          ? [{ label: '__image_caption__', value: imageCaption.trim() }]
                          : []),
                  ]
                : []),
            ...filteredInfobox,
        ];

        const slug = slugify(title.trim()) + '-' + Date.now().toString(36);

        let ok = false;
        try {
            const res = await fetch('/api/triplepedia/articles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title.trim(),
                    slug,
                    summary: summary.trim(),
                    sections: filteredSections,
                    infobox: finalInfobox,
                    submitted_by: user?.email ?? null,
                    status: 'published',
                }),
            });
            ok = res.ok;
        } catch {
            ok = false;
        }

        setSubmitting(false);

        if (!ok) {
            setError('Failed to submit. Please try again.');
            return;
        }

        setDone(true);
        onSubmitted?.();
        setTimeout(() => {
            reset();
            onClose();
        }, 2200);
    };

    const handleClose = useCallback(() => {
        if (!submitting) { reset(); onClose(); }
    }, [submitting, onClose, reset]);

    const isBusy = submitting || imageUploading;

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[500] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={(e) => e.target === e.currentTarget && handleClose()}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 16 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 16 }}
                        transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
                        className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
                            <div>
                                <h2 className="font-semibold text-lg text-foreground">Suggest an Article</h2>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Will be fact-checked by Taipei 3.1 Extended
                                </p>
                            </div>
                            <button
                                onClick={handleClose}
                                className="p-2 rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                            {done ? (
                                <div className="flex flex-col items-center justify-center h-40 gap-3">
                                    <div className="h-12 w-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
                                        <Check size={22} className="text-emerald-400" />
                                    </div>
                                    <p className="text-sm font-semibold text-foreground">Article submitted!</p>
                                    <p className="text-xs text-muted-foreground">
                                        It&apos;s live and fact-checked by Taipei 3.1 Extended.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    {/* Title */}
                                    <div>
                                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                                            Title *
                                        </label>
                                        <input
                                            value={title}
                                            onChange={(e) => setTitle(e.target.value)}
                                            placeholder="Article title..."
                                            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-foreground/30 transition-colors"
                                        />
                                    </div>

                                    {/* Summary */}
                                    <div>
                                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                                            Summary *
                                        </label>
                                        <textarea
                                            value={summary}
                                            onChange={(e) => setSummary(e.target.value)}
                                            placeholder="Brief overview of the topic..."
                                            rows={3}
                                            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-foreground/30 transition-colors resize-none"
                                        />
                                    </div>

                                    {/* Sections */}
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                                Sections
                                            </label>
                                            <button
                                                onClick={addSection}
                                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                            >
                                                <Plus size={12} /> Add
                                            </button>
                                        </div>
                                        <div className="space-y-3">
                                            {sections.map((s, i) => (
                                                <div key={i} className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            value={s.heading}
                                                            onChange={(e) => updateSection(i, 'heading', e.target.value)}
                                                            placeholder="Section heading..."
                                                            className="flex-1 bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground/40 outline-none"
                                                        />
                                                        {sections.length > 1 && (
                                                            <button onClick={() => removeSection(i)} className="text-muted-foreground/40 hover:text-destructive transition-colors">
                                                                <Trash2 size={13} />
                                                            </button>
                                                        )}
                                                    </div>
                                                    <textarea
                                                        value={s.content}
                                                        onChange={(e) => updateSection(i, 'content', e.target.value)}
                                                        placeholder="Section content..."
                                                        rows={3}
                                                        className="w-full bg-transparent text-sm text-foreground/80 placeholder:text-muted-foreground/40 outline-none resize-none"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* ── Infobox Image ───────────────────────────────── */}
                                    <div>
                                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
                                            Infobox Image
                                        </label>

                                        {imagePreview ? (
                                            /* Preview card */
                                            <div className="rounded-xl border border-border bg-muted/20 overflow-hidden">
                                                <div className="relative">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src={imagePreview}
                                                        alt="Preview"
                                                        className="w-full max-h-52 object-contain bg-checkerboard"
                                                    />
                                                    <button
                                                        onClick={removeImage}
                                                        className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center transition-colors"
                                                    >
                                                        <X size={13} className="text-white" />
                                                    </button>
                                                </div>
                                                <div className="px-3 py-2.5 border-t border-border">
                                                    <input
                                                        value={imageCaption}
                                                        onChange={(e) => setImageCaption(e.target.value)}
                                                        placeholder="Caption (optional)..."
                                                        className="w-full bg-transparent text-xs text-foreground/80 placeholder:text-muted-foreground/40 outline-none"
                                                    />
                                                </div>
                                            </div>
                                        ) : (
                                            /* Drop zone */
                                            <div
                                                onDragOver={(e) => { e.preventDefault(); setImageDragging(true); }}
                                                onDragLeave={() => setImageDragging(false)}
                                                onDrop={handleDrop}
                                                onClick={() => fileInputRef.current?.click()}
                                                className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-8 cursor-pointer transition-all duration-150 ${
                                                    imageDragging
                                                        ? 'border-foreground/40 bg-muted/40'
                                                        : 'border-border hover:border-foreground/25 hover:bg-muted/20'
                                                }`}
                                            >
                                                <div className="h-10 w-10 rounded-xl bg-muted/60 flex items-center justify-center">
                                                    <ImagePlus size={20} className="text-muted-foreground" />
                                                </div>
                                                <div className="text-center">
                                                    <p className="text-sm font-medium text-foreground/70">
                                                        {imageDragging ? 'Drop to upload' : 'Upload image'}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground/50 mt-0.5">
                                                        PNG, JPG, WebP, GIF · Max 5 MB
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={handleFileInput}
                                        />
                                    </div>

                                    {/* Infobox entries */}
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                                Infobox entries
                                            </label>
                                            <button
                                                onClick={addInfobox}
                                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                            >
                                                <Plus size={12} /> Add
                                            </button>
                                        </div>
                                        <div className="space-y-2">
                                            {infobox.map((e, i) => (
                                                <div key={i} className="flex items-center gap-2">
                                                    <input
                                                        value={e.label}
                                                        onChange={(el) => updateInfobox(i, 'label', el.target.value)}
                                                        placeholder="Label"
                                                        className="w-36 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-foreground/30 transition-colors"
                                                    />
                                                    <input
                                                        value={e.value}
                                                        onChange={(el) => updateInfobox(i, 'value', el.target.value)}
                                                        placeholder="Value"
                                                        className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-foreground/30 transition-colors"
                                                    />
                                                    {infobox.length > 1 && (
                                                        <button
                                                            onClick={() => removeInfobox(i)}
                                                            className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0"
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {error && (
                                        <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                                            {error}
                                        </p>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Footer */}
                        {!done && (
                            <div className="px-6 py-4 border-t border-border shrink-0 flex items-center justify-between gap-4">
                                <p className="text-xs text-muted-foreground/50 leading-relaxed">
                                    Fact-checked by Taipei 3.1 Extended upon submission
                                </p>
                                <button
                                    onClick={handleSubmit}
                                    disabled={isBusy}
                                    className="shrink-0 flex items-center gap-2 px-5 py-2 rounded-xl bg-foreground text-background text-sm font-semibold hover:opacity-80 transition-opacity disabled:opacity-50"
                                >
                                    {isBusy && <Loader2 size={14} className="animate-spin" />}
                                    {imageUploading ? 'Uploading image...' : submitting ? 'Submitting...' : 'Submit Article'}
                                </button>
                            </div>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
