'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MODELS, type Model } from '@/lib/ai/models';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import ConnectorsMenu from './ConnectorsMenu';
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

    // Show the Connectors (Composio apps) chip + menu. Opt-in so surfaces
    // like the /dev panel stay unchanged.
    connectors?: boolean;

    // Hide the attach button and ignore pasted/dropped files. For surfaces
    // where uploads can't go anywhere (e.g. the landing hero, which hands the
    // message off across a navigation).
    attachments?: boolean;

    placeholder?: string;
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
                        // eslint-disable-next-line @next/next/no-img-element
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
    connectors,
    attachments = true,
    placeholder,
}: SonomaComposerProps) {
    const modelList = models ?? MODELS;
    const isMobile = useIsMobile();
    const taRef = useRef<HTMLTextAreaElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    useLayoutEffect(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
    }, [value]);

    const onKey = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
            }
        },
        [onSend],
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
            className="w-full"
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
            <textarea
                ref={taRef}
                rows={1}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={onKey}
                onPaste={onPaste}
                onDrop={onDrop}
                onDragOver={onDragOver}
                placeholder={placeholder || 'How can Tripplet help?'}
                className="w-full resize-none border-0 bg-transparent leading-[1.55] outline-none"
                style={{
                    color: 'var(--sonoma-ink)',
                    // 16px keeps iOS Safari from auto-zooming the field on focus.
                    fontSize: 16,
                    padding: '4px 6px 6px',
                    minHeight: 28,
                    maxHeight: 220,
                    fontFamily: 'inherit',
                }}
            />
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
                        compact={isMobile}
                    />
                )}
                {onToggleReason && (
                    <ToolChip
                        active={!!reason}
                        onClick={onToggleReason}
                        icon={<SonomaReason />}
                        label="Reason"
                        compact={isMobile}
                    />
                )}
                {onToggleCode && (
                    <ToolChip
                        active={!!code}
                        onClick={onToggleCode}
                        icon={<SonomaCode size={16} />}
                        label="Code"
                        compact={isMobile}
                    />
                )}
                {onToggleDeepCode && (
                    <ToolChip
                        active={!!deepCode}
                        onClick={onToggleDeepCode}
                        icon={<SonomaCode size={16} />}
                        label="DeepCode"
                        compact={isMobile}
                    />
                )}
                {connectors && <ConnectorsMenu compact={isMobile} />}

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
