'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MODELS, type Model } from '@/lib/ai/models';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import ConnectorsMenu from './ConnectorsMenu';
import {
    DEEP_CODE_REASONING_LEVELS,
    DEEP_CODE_REASONING_LEVEL_LABELS,
    type DeepCodeReasoningLevel,
} from '@/lib/sonoma/reasoning-levels';
import {
    SonomaClip,
    SonomaSend,
    SonomaStop,
    SonomaChevron,
    SonomaBrowse,
    SonomaReason,
    SonomaCode,
    SonomaFile,
    SonomaX,
} from './icons';

interface UploadedFile {
    id: string;
    file: File;
    preview?: string;
    name: string;
    kb: number;
}

interface SonomaComposerProps {
    value: string;
    onChange: (v: string) => void;
    onSend: () => void;
    onStop?: () => void;
    busy: boolean;

    model: string;
    onModelChange: (id: string) => void;
    models?: Model[];

    files: UploadedFile[];
    onAddFiles: (files: File[]) => void;
    onRemoveFile: (id: string) => void;

    browse?: boolean;
    onToggleBrowse?: () => void;
    reason?: boolean;
    onToggleReason?: () => void;
    code?: boolean;
    onToggleCode?: () => void;
    deepCode?: boolean;
    onToggleDeepCode?: () => void;
    deepCodeLevel?: DeepCodeReasoningLevel;
    onDeepCodeLevelChange?: (level: DeepCodeReasoningLevel) => void;

    // Show the Connectors (Composio apps) chip + menu. Opt-in so surfaces
    // like the /dev panel stay unchanged.
    connectors?: boolean;
    buildWorkspace?: boolean;

    // Hide the attach button and ignore pasted/dropped files. For surfaces
    // where uploads can't go anywhere (e.g. the landing hero, which hands the
    // message off across a navigation).
    attachments?: boolean;

    placeholder?: string;

    // Paired OpenSonoma machines available to @mention.
    machines?: { deviceId: string; machineName: string }[];
    mentionedMachine?: { deviceId: string; machineName: string } | null;
    onMentionMachine?: (m: { deviceId: string; machineName: string } | null) => void;
}

function ToolChip({
    active,
    onClick,
    icon,
    label,
    compact,
}: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    compact?: boolean;
}) {
    const palette = {
        border: `1px solid ${active ? 'color-mix(in oklch, var(--sonoma-accent) 50%, transparent)' : 'var(--sonoma-border)'}`,
        background: active ? 'var(--sonoma-accent-soft)' : 'var(--sonoma-surface)',
        color: active ? 'var(--sonoma-accent-2)' : 'var(--sonoma-ink-2)',
        boxShadow: 'var(--sonoma-shadow-sm)',
    };

    // Compact (mobile): icon-only circle, no text label.
    if (compact) {
        return (
            <button
                type="button"
                onClick={onClick}
                aria-label={label}
                title={label}
                aria-pressed={active}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors"
                style={palette}
            >
                <span className="inline-flex" style={{ opacity: active ? 1 : 0.85 }}>
                    {icon}
                </span>
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={onClick}
            className="inline-flex items-center gap-2 rounded-full text-[13.5px] font-medium transition-colors"
            style={{ ...palette, padding: '7px 12px 7px 11px' }}
        >
            <span className="inline-flex" style={{ opacity: active ? 1 : 0.85 }}>
                {icon}
            </span>
            <span>{label}</span>
        </button>
    );
}

// DeepCode's tool chip plus a chevron that opens a popover with a slider for
// picking the pipeline's reasoning level (Low ... Agentic).
function DeepCodeChip({
    active,
    onClick,
    level,
    onLevelChange,
    compact,
    buildWorkspace,
}: {
    active: boolean;
    onClick: () => void;
    level: DeepCodeReasoningLevel;
    onLevelChange: (level: DeepCodeReasoningLevel) => void;
    compact?: boolean;
    buildWorkspace?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const idx = Math.max(0, DEEP_CODE_REASONING_LEVELS.indexOf(level));
    const [sliderValue, setSliderValue] = useState(idx);
    const sliderMax = DEEP_CODE_REASONING_LEVELS.length - 1;
    const sliderPercent = (sliderValue / sliderMax) * 100;
    const visualLevel = DEEP_CODE_REASONING_LEVELS[Math.min(sliderMax, Math.max(0, Math.round(sliderValue)))];
    const isUltra = visualLevel === 'supercode';

    useEffect(() => setSliderValue(idx), [idx]);

    useEffect(() => {
        function onDoc(e: MouseEvent) {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, []);

    return (
        <div ref={wrapRef} className="relative inline-flex items-center gap-0.5">
            <ToolChip active={active} onClick={onClick} icon={<SonomaCode size={16} />} label={buildWorkspace ? 'Agentic' : level === 'supercode' ? 'Agentic' : 'DeepCode'} compact={compact} />
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-label="DeepCode reasoning level"
                aria-expanded={open}
                title={`Reasoning: ${DEEP_CODE_REASONING_LEVEL_LABELS[level]}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors"
                style={{
                    color: active ? 'var(--sonoma-accent-2)' : 'var(--sonoma-ink-2)',
                    transform: open ? 'rotate(180deg)' : undefined,
                }}
            >
                <SonomaChevron />
            </button>
            {open && (
                <div
                        className="sm-pop absolute z-30"
                    style={{
                        bottom: 'calc(100% + 8px)',
                        left: 0,
                        width: 224,
                        padding: '12px 14px 14px',
                        background: 'var(--sonoma-surface)',
                        border: '1px solid var(--sonoma-border)',
                        borderRadius: 14,
                        boxShadow: 'var(--sonoma-shadow-lg)',
                    }}
                >
                    <div className="mb-2.5 flex items-center justify-between">
                        <span className="text-[12px] font-medium" style={{ color: 'var(--sonoma-ink-2)' }}>
                            Reasoning level
                        </span>
                        <span className="text-[12.5px] font-semibold" style={{ color: 'var(--sonoma-accent-2)' }}>
                            <span key={visualLevel} className="deepcode-level-label">
                                {buildWorkspace && visualLevel === 'supercode' ? 'Ultra' : DEEP_CODE_REASONING_LEVEL_LABELS[visualLevel]}
                            </span>
                        </span>
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={DEEP_CODE_REASONING_LEVELS.length - 1}
                        value={sliderValue}
                        step={0.01}
                        onChange={(e) => setSliderValue(Number(e.target.value))}
                        onPointerUp={() => {
                            const target = Math.round(sliderValue);
                            setSliderValue(target);
                            onLevelChange(DEEP_CODE_REASONING_LEVELS[target]);
                        }}
                        className={`deepcode-range w-full ${isUltra ? 'deepcode-range-rgb' : ''}`}
                        style={{
                            background: isUltra
                                ? '#ef4444'
                                : `linear-gradient(to right, #3b82f6 ${sliderPercent}%, var(--sonoma-border) ${sliderPercent}%)`,
                        }}
                        aria-label="DeepCode reasoning level slider"
                    />
                    <div className="mt-1.5 flex justify-between px-0.5">
                        {DEEP_CODE_REASONING_LEVELS.map((l) => (
                            <span
                                key={l}
                                className="text-[9.5px] font-medium"
                                style={{
                                    color: l === level ? 'var(--sonoma-ink)' : 'var(--sonoma-faint)',
                                }}
                            >
                                {(buildWorkspace && l === 'supercode' ? 'Ultra' : DEEP_CODE_REASONING_LEVEL_LABELS[l])[0]}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function BuildPlanChip() {
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<'Build' | 'Plan'>('Build');
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onDoc = (event: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, []);

    return (
        <div ref={wrapRef} className="relative inline-flex items-center">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-label={`Build mode: ${mode}`}
                aria-expanded={open}
                className="inline-flex items-center gap-1.5 rounded-full text-[13.5px] font-medium transition-colors"
                style={{ border: '1px solid var(--sonoma-border)', background: 'var(--sonoma-surface)', color: 'var(--sonoma-ink-2)', padding: '7px 10px 7px 12px' }}
            >
                <span>{mode}</span>
                <SonomaChevron />
            </button>
            {open && (
                <div className="absolute bottom-[calc(100%+8px)] left-0 z-30 min-w-[120px] rounded-[12px] border p-1 shadow-lg" style={{ background: 'var(--sonoma-surface)', borderColor: 'var(--sonoma-border)' }}>
                    {(['Build', 'Plan'] as const).map((option) => (
                        <button
                            key={option}
                            type="button"
                            className="block w-full rounded-lg px-3 py-2 text-left text-[13px]"
                            style={{ background: mode === option ? 'var(--sonoma-accent-soft)' : 'transparent', color: 'var(--sonoma-ink)' }}
                            onClick={() => {
                                setMode(option);
                                setOpen(false);
                                window.dispatchEvent(new CustomEvent('tripplet:build-mode', { detail: { mode: option } }));
                            }}
                        >
                            {option}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export function ModelMenu({
    value,
    onChange,
    models,
    placement = 'up',
    variant = 'inline',
}: {
    value: string;
    onChange: (id: string) => void;
    models: Model[];
    /** Which way the dropdown opens. */
    placement?: 'up' | 'down';
    /** `pill` gives the trigger a bordered surface (for the mobile top bar). */
    variant?: 'inline' | 'pill';
}) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function onDoc(e: MouseEvent) {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, []);

    const current = models.find((m) => m.id === value) || models[0];

    const triggerStyle: React.CSSProperties =
        variant === 'pill'
            ? {
                  padding: '7px 10px 7px 14px',
                  color: 'var(--sonoma-ink)',
                  background: 'var(--sonoma-surface)',
                  border: '1px solid var(--sonoma-border)',
                  boxShadow: 'var(--sonoma-shadow-sm)',
              }
            : {
                  padding: '7px 8px 7px 12px',
                  color: 'var(--sonoma-ink-2)',
                  background: open ? 'var(--sonoma-surface)' : 'transparent',
              };

    const menuStyle: React.CSSProperties = {
        ...(placement === 'down' ? { top: 'calc(100% + 8px)' } : { bottom: 'calc(100% + 8px)' }),
        ...(variant === 'pill'
            ? { left: '50%', transform: 'translateX(-50%)' }
            : { right: 0 }),
        width: 'min(268px, calc(100vw - 32px))',
        background: 'var(--sonoma-surface)',
        border: '1px solid var(--sonoma-border)',
        borderRadius: 14,
        boxShadow: 'var(--sonoma-shadow-lg)',
    };

    return (
        <div ref={wrapRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-full text-[13.5px] font-medium"
                style={triggerStyle}
            >
                <span>{current.name}</span>
                <SonomaChevron />
            </button>
            {open && (
                <div role="menu" className="absolute z-30 p-1.5" style={menuStyle}>
                    {models.map((m) => {
                        const sel = m.id === value;
                        return (
                            <button
                                key={m.id}
                                onClick={() => {
                                    onChange(m.id);
                                    setOpen(false);
                                }}
                                className="flex w-full items-start gap-2.5 rounded-[10px] px-2.5 py-2.5 text-left"
                                style={{ background: sel ? 'var(--sonoma-surface)' : 'transparent' }}
                            >
                                <div className="min-w-0 flex-1">
                                    <div
                                        className="text-[13.5px] font-medium"
                                        style={{ color: 'var(--sonoma-ink)' }}
                                    >
                                        {m.name}
                                    </div>
                                    {m.description && (
                                        <div
                                            className="mt-0.5 text-[12px] leading-[1.4]"
                                            style={{ color: 'var(--sonoma-muted)' }}
                                        >
                                            {m.description}
                                        </div>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function Attachments({
    files,
    onRemove,
}: {
    files: UploadedFile[];
    onRemove: (id: string) => void;
}) {
    if (files.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1.5 px-1 pb-2 pt-1">
            {files.map((f) => (
                <div
                    key={f.id}
                    className="sm-pop inline-flex max-w-[260px] items-center gap-2 rounded-full text-[12.5px]"
                    style={{
                        padding: '6px 8px 6px 10px',
                        background: 'var(--sonoma-surface)',
                        border: '1px solid var(--sonoma-border)',
                        color: 'var(--sonoma-ink-2)',
                    }}
                >
                    {f.preview ? (
                         
                        <img
                            src={f.preview}
                            alt=""
                            style={{
                                width: 22,
                                height: 22,
                                borderRadius: 4,
                                objectFit: 'cover',
                                flexShrink: 0,
                            }}
                        />
                    ) : (
                        <span
                            className="inline-flex"
                            style={{ color: 'var(--sonoma-muted)' }}
                        >
                            <SonomaFile />
                        </span>
                    )}
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                        {f.name}
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--sonoma-faint)' }}>
                        {f.kb}KB
                    </span>
                    <button
                        onClick={() => onRemove(f.id)}
                        title="Remove"
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors"
                        style={{ color: 'var(--sonoma-muted)' }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--sonoma-bg-2)';
                            e.currentTarget.style.color = 'var(--sonoma-ink)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = 'var(--sonoma-muted)';
                        }}
                    >
                        <SonomaX />
                    </button>
                </div>
            ))}
        </div>
    );
}

export default function SonomaComposer({
    value,
    onChange,
    onSend,
    onStop,
    busy,
    model,
    onModelChange,
    models,
    files,
    onAddFiles,
    onRemoveFile,
    browse,
    onToggleBrowse,
    reason,
    onToggleReason,
    code,
    onToggleCode,
    deepCode,
    onToggleDeepCode,
    deepCodeLevel,
    onDeepCodeLevelChange,
    connectors,
    buildWorkspace = false,
    attachments = true,
    placeholder,
    machines = [],
    mentionedMachine,
    onMentionMachine,
}: SonomaComposerProps) {
    const modelList = models ?? MODELS;
    const isMobile = useIsMobile();
    const taRef = useRef<HTMLTextAreaElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
    }, [value]);

    // ── @mention autocomplete ────────────────────────────────────────────
    // Active whenever the caret sits inside an unbroken "@query" run (no
    // whitespace between the @ and the caret). Tab/Enter picks the
    // highlighted machine and inserts "@Machine Name " at that position.
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [mentionStart, setMentionStart] = useState(0);
    const [mentionIndex, setMentionIndex] = useState(0);

    const mentionMatches = useMemo(() => {
        if (mentionQuery === null) return [];
        const q = mentionQuery.toLowerCase();
        return machines.filter((m) => m.machineName.toLowerCase().includes(q));
    }, [mentionQuery, machines]);

    const detectMention = useCallback((text: string, caret: number) => {
        const upTo = text.slice(0, caret);
        const at = upTo.lastIndexOf('@');
        if (at === -1 || /\s/.test(upTo.slice(at + 1))) {
            setMentionQuery(null);
            return;
        }
        setMentionQuery(upTo.slice(at + 1));
        setMentionStart(at);
        setMentionIndex(0);
    }, []);

    const pickMention = useCallback(
        (m: { deviceId: string; machineName: string }) => {
            const ta = taRef.current;
            const caret = ta ? ta.selectionStart : value.length;
            const before = value.slice(0, mentionStart);
            const after = value.slice(caret);
            const inserted = `@${m.machineName} `;
            onChange(before + inserted + after);
            onMentionMachine?.(m);
            setMentionQuery(null);
            requestAnimationFrame(() => {
                if (!ta) return;
                const pos = before.length + inserted.length;
                ta.focus();
                ta.setSelectionRange(pos, pos);
            });
        },
        [value, mentionStart, onChange, onMentionMachine],
    );

    // Highlighted-text overlay sitting exactly under the (text-transparent)
    // textarea, so the current @mention token renders in the accent color
    // while everything else stays the normal ink color.
    const mentionNamePattern = useMemo(() => {
        if (machines.length === 0) return null;
        const names = machines.map((m) => m.machineName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        return new RegExp(`@(?:${names.join('|')})\\b|@${mentionQuery ? mentionQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : ''}$`, 'g');
    }, [machines, mentionQuery]);

    const overlayNodes = useMemo(() => {
        if (!mentionNamePattern || (machines.length === 0 && mentionQuery === null)) return null;
        const nodes: React.ReactNode[] = [];
        let last = 0;
        let m: RegExpExecArray | null;
        mentionNamePattern.lastIndex = 0;
        let key = 0;
        while ((m = mentionNamePattern.exec(value))) {
            if (m.index > last) nodes.push(<span key={key++}>{value.slice(last, m.index)}</span>);
            nodes.push(
                <span key={key++} style={{ color: 'var(--sonoma-accent-2)', fontWeight: 600 }}>
                    {m[0]}
                </span>,
            );
            last = m.index + m[0].length;
            if (m.index === m.index && m[0].length === 0) break; // safety
        }
        nodes.push(<span key={key++}>{value.slice(last)}</span>);
        return nodes;
    }, [mentionNamePattern, value, machines.length, mentionQuery]);

    const onKey = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (mentionQuery !== null && mentionMatches.length > 0) {
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                    e.preventDefault();
                    pickMention(mentionMatches[mentionIndex] ?? mentionMatches[0]);
                    return;
                }
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setMentionIndex((i) => (i + 1) % mentionMatches.length);
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
                    return;
                }
                if (e.key === 'Escape') {
                    setMentionQuery(null);
                    return;
                }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
            }
        },
        [onSend, mentionQuery, mentionMatches, mentionIndex, pickMention],
    );

    const onPick = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const list = Array.from(e.target.files || []);
            if (list.length) onAddFiles(list);
            e.target.value = '';
        },
        [onAddFiles],
    );

    const onPaste = useCallback(
        (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
            if (!attachments) return;
            const items = e.clipboardData?.items;
            if (!items || items.length === 0) return;
            const pasted: File[] = [];
            for (let i = 0; i < items.length; i += 1) {
                const item = items[i];
                if (item.kind !== 'file') continue;
                if (!item.type.startsWith('image/')) continue;
                const file = item.getAsFile();
                if (file) {
                    // Clipboard images are often named "image.png" generically — make them unique.
                    const ext = (file.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
                    const renamed = new File([file], `pasted-${Date.now()}.${ext}`, { type: file.type });
                    pasted.push(renamed);
                }
            }
            if (pasted.length > 0) {
                e.preventDefault();
                onAddFiles(pasted);
            }
        },
        [onAddFiles, attachments],
    );

    const onDrop = useCallback(
        (e: React.DragEvent<HTMLTextAreaElement>) => {
            if (!attachments) return;
            const list = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'));
            if (list.length > 0) {
                e.preventDefault();
                onAddFiles(list);
            }
        },
        [onAddFiles, attachments],
    );

    const onDragOver = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
        if (e.dataTransfer?.types?.includes('Files')) {
            e.preventDefault();
        }
    }, []);

    const canSend = (value.trim().length > 0 || files.length > 0) && !busy;

    return (
        <div
            className={`w-full ${deepCode && deepCodeLevel === 'supercode' ? 'supercode-composer' : ''}`}
            style={{
                background: 'var(--sonoma-surface)',
                border: '1px solid var(--sonoma-border)',
                borderRadius: 22,
                padding: '14px 14px 10px',
                boxShadow: 'var(--sonoma-shadow-md)',
                transition: 'border-color .2s, box-shadow .2s',
            }}
        >
            <Attachments files={files} onRemove={onRemoveFile} />
            <div className="relative">
                {overlayNodes && (
                    <div
                        ref={overlayRef}
                        aria-hidden
                        className="pointer-events-none absolute inset-0 w-full resize-none whitespace-pre-wrap break-words leading-[1.55]"
                        style={{
                            fontSize: 16,
                            padding: '4px 6px 6px',
                            minHeight: 28,
                            maxHeight: 220,
                            fontFamily: 'inherit',
                            color: 'var(--sonoma-ink)',
                            overflow: 'hidden',
                        }}
                    >
                        {overlayNodes}
                    </div>
                )}
                <textarea
                    ref={taRef}
                    rows={1}
                    value={value}
                    onChange={(e) => {
                        onChange(e.target.value);
                        detectMention(e.target.value, e.target.selectionStart);
                    }}
                    onKeyUp={(e) => {
                        const ta = e.currentTarget;
                        detectMention(ta.value, ta.selectionStart);
                    }}
                    onClick={(e) => {
                        const ta = e.currentTarget;
                        detectMention(ta.value, ta.selectionStart);
                    }}
                    onScroll={(e) => {
                        if (overlayRef.current) overlayRef.current.scrollTop = e.currentTarget.scrollTop;
                    }}
                    onKeyDown={onKey}
                    onPaste={onPaste}
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    placeholder={placeholder || 'How can Tripplet help?'}
                    className="relative w-full resize-none border-0 bg-transparent leading-[1.55] outline-none"
                    style={{
                        color: overlayNodes ? 'transparent' : 'var(--sonoma-ink)',
                        caretColor: 'var(--sonoma-ink)',
                        // 16px keeps iOS Safari from auto-zooming the field on focus.
                        fontSize: 16,
                        padding: '4px 6px 6px',
                        minHeight: 28,
                        maxHeight: 220,
                        fontFamily: 'inherit',
                    }}
                />
                {mentionQuery !== null && mentionMatches.length > 0 && (
                    <div
                        className="absolute left-0 top-full z-20 mt-1 min-w-[200px] overflow-hidden rounded-[12px]"
                        style={{
                            background: 'var(--sonoma-surface)',
                            border: '1px solid var(--sonoma-border)',
                            boxShadow: 'var(--sonoma-shadow-md)',
                        }}
                    >
                        {mentionMatches.map((m, i) => (
                            <button
                                key={m.deviceId}
                                type="button"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    pickMention(m);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]"
                                style={{
                                    background: i === mentionIndex ? 'var(--sonoma-accent-soft)' : 'transparent',
                                    color: i === mentionIndex ? 'var(--sonoma-accent-2)' : 'var(--sonoma-ink)',
                                }}
                            >
                                @{m.machineName}
                            </button>
                        ))}
                        <div
                            className="px-3 py-1.5 text-[11px]"
                            style={{ color: 'var(--sonoma-faint)', borderTop: '1px solid var(--sonoma-border)' }}
                        >
                            Tab to select
                        </div>
                    </div>
                )}
            </div>
            {mentionedMachine && (
                <div className="mt-1 flex items-center gap-1.5 px-1 text-[11.5px]" style={{ color: 'var(--sonoma-faint)' }}>
                    <span style={{ color: 'var(--sonoma-accent-2)' }}>@{mentionedMachine.machineName}</span>
                    attached — Sonoma may ask permission to run commands on it.
                    <button
                        type="button"
                        onClick={() => onMentionMachine?.(null)}
                        className="ml-0.5 underline"
                    >
                        remove
                    </button>
                </div>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {attachments && (
                    <>
                        <input
                            ref={fileRef}
                            type="file"
                            multiple
                            accept="image/*"
                            className="hidden"
                            onChange={onPick}
                        />
                        <button
                            type="button"
                            title="Attach files"
                            onClick={() => fileRef.current?.click()}
                            className={cn(
                                'inline-flex h-8 w-8 max-md:h-9 max-md:w-9 items-center justify-center rounded-full transition-colors',
                            )}
                            style={{
                                border: '1px solid var(--sonoma-border)',
                                color: 'var(--sonoma-ink-2)',
                                background: 'var(--sonoma-surface)',
                                boxShadow: 'var(--sonoma-shadow-sm)',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'var(--sonoma-surface-2)';
                                e.currentTarget.style.borderColor = 'var(--sonoma-border-2)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'var(--sonoma-surface)';
                                e.currentTarget.style.borderColor = 'var(--sonoma-border)';
                            }}
                        >
                            <SonomaClip />
                        </button>
                    </>
                )}

                {onToggleBrowse && (
                    <ToolChip
                        active={!!browse}
                        onClick={onToggleBrowse}
                        icon={<SonomaBrowse />}
                        label="Browse"
                        compact={isMobile || buildWorkspace}
                    />
                )}
                {onToggleReason && !buildWorkspace && (
                    <ToolChip
                        active={!!reason}
                        onClick={onToggleReason}
                        icon={<SonomaReason />}
                        label="Reason"
                        compact={isMobile || buildWorkspace}
                    />
                )}
                {onToggleCode && (
                    <ToolChip
                        active={!!code}
                        onClick={onToggleCode}
                        icon={<SonomaCode size={16} />}
                        label="Code"
                        compact={isMobile || buildWorkspace}
                    />
                )}
                {onToggleDeepCode && (
                    <DeepCodeChip
                        active={!!deepCode}
                        onClick={onToggleDeepCode}
                        level={deepCodeLevel ?? 'high'}
                        onLevelChange={onDeepCodeLevelChange ?? (() => {})}
                        compact={isMobile || buildWorkspace}
                    />
                )}
                {buildWorkspace ? <BuildPlanChip /> : connectors && <ConnectorsMenu compact={isMobile} />}

                <div className="min-w-0 flex-1" />

                {/* On mobile the model picker lives in the top bar (see ChatShell). */}
                {!isMobile && (
                    <ModelMenu value={model} onChange={onModelChange} models={modelList} />
                )}

                <button
                    type="button"
                    onClick={busy ? onStop : onSend}
                    disabled={!busy && !canSend}
                    aria-label={busy ? 'Stop' : 'Send'}
                    className="inline-flex h-8 w-8 max-md:h-9 max-md:w-9 items-center justify-center rounded-full transition-all"
                    style={{
                        background: busy
                            ? 'var(--sonoma-ink)'
                            : canSend
                                ? 'var(--sonoma-accent)'
                                : 'var(--sonoma-bg-2)',
                        color: busy ? '#fff' : canSend ? '#fff' : 'var(--sonoma-faint)',
                        cursor: busy || canSend ? 'pointer' : 'not-allowed',
                        boxShadow:
                            canSend && !busy
                                ? '0 4px 12px -4px color-mix(in oklch, var(--sonoma-accent) 50%, transparent)'
                                : 'none',
                    }}
                >
                    {busy ? <SonomaStop /> : <SonomaSend />}
                </button>
            </div>
        </div>
    );
}
