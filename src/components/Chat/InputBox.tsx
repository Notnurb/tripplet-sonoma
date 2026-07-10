'use client';

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowUp02Icon, Cancel01Icon } from '@hugeicons/core-free-icons';
import { X, ArrowRight, Square } from 'lucide-react';
import Link from 'next/link';
import PlusMenu from './PlusMenu';
import ModelSelector from './ModelSelector';
import { ToneType, ChatMode, AutoSkillSetting } from '@/types';
import { MODE_CONFIGS } from '@/lib/ai/modes';
import { Model } from '@/lib/ai/models';
import { cn } from '@/lib/utils';
import { loadSettings, SETTINGS_EVENT } from '@/lib/settings';
import { useReducedMotionPreference } from '@/hooks/useReducedMotionPreference';

// ── Contextual feature hints ──────────────────────────────────────────────────
const HINTS: Array<{ pattern: RegExp; label: string; sub: string; href: string; mode?: ChatMode }> = [
    {
        pattern: /\b(build|app|website|deploy|component|react|next\.?js|tailwind|frontend|backend|code it|write.*code|make.*app)\b/i,
        label: 'Try the Code workspace',
        sub: 'Live editor + instant preview',
        href: '/code',
    },
    {
        pattern: /\b(search|latest|current|today|news|price|weather|recent|2024|2025|who won|right now)\b/i,
        label: 'Enable Web Search',
        sub: 'Get real-time results',
        href: '',
        mode: 'web-search',
    },
    {
        pattern: /\b(write.*code|debug|fix.*bug|function|class|component|api|endpoint|typescript|python|javascript|rust|golang|sql|regex|refactor)\b/i,
        label: 'Enable Code Mode',
        sub: 'Optimized for programming',
        href: '',
        mode: 'code',
    },
    {
        pattern: /\b(story|poem|creative|imagine|fiction|character|narrative|lyrics|song|haiku|limerick|fairy tale)\b/i,
        label: 'Enable Creative Mode',
        sub: 'Unleash imagination',
        href: '',
        mode: 'creative',
    },
    {
        pattern: /\b(summarize|summary|tldr|tl;dr|condense|shorten|key points|main points|brief|recap)\b/i,
        label: 'Enable Summarize Mode',
        sub: 'Get the key points fast',
        href: '',
        mode: 'summarize',
    },
    {
        pattern: /\b(explain.*simply|eli5|simple terms|dumb it down|for a kid|for a beginner|what even is|what the heck)\b/i,
        label: 'Enable ELI5 Mode',
        sub: 'Super simple explanations',
        href: '',
        mode: 'eli5',
    },
    {
        pattern: /\b(brainstorm|ideas? for|come up with|think of|suggest.*ideas?|what could|possibilities|options for|ways to)\b/i,
        label: 'Enable Brainstorm Mode',
        sub: 'Generate tons of ideas',
        href: '',
        mode: 'brainstorm',
    },
    {
        pattern: /\b(pretend|roleplay|act as|you are a|be a|character|persona|impersonate|in character)\b/i,
        label: 'Enable Roleplay Mode',
        sub: 'Stay in character',
        href: '',
        mode: 'roleplay',
    },
    {
        pattern: /\b(debate|pros? and cons?|argue|devil.?s advocate|both sides|for and against|counterargument)\b/i,
        label: 'Enable Debate Mode',
        sub: 'Explore every angle',
        href: '',
        mode: 'debate',
    },
    {
        pattern: /\b(translate|translat|in spanish|in french|in german|in japanese|in chinese|in korean|in arabic|in portuguese|in hindi|en espa[nñ]ol|auf deutsch)\b/i,
        label: 'Enable Translate Mode',
        sub: 'Natural translations',
        href: '',
        mode: 'translate',
    },
    {
        pattern: /\b(fact.?check|is it true|is this true|verify|myth|actually true|real or fake|accurate|debunk)\b/i,
        label: 'Enable Fact-Check Mode',
        sub: 'Verify with evidence',
        href: '',
        mode: 'fact-check',
    },
];

function useContextualHint(content: string, activeModes: ChatMode[]) {
    return useMemo(() => {
        if (content.length < 6) return null;
        for (const hint of HINTS) {
            if (hint.pattern.test(content)) {
                // Don't suggest web-search if it's already active
                if (hint.mode && activeModes.includes(hint.mode)) return null;
                return hint;
            }
        }
        return null;
    }, [content, activeModes]);
}

interface UploadedFile {
    file: File;
    preview?: string;
}

interface InputBoxProps {
    selectedModel: string;
    extendedThinking: boolean;
    isStreaming: boolean;
    activeModes: ChatMode[];
    activeTone: ToneType | null;
    autoSkillSetting: AutoSkillSetting;
    onSend: (content: string, file?: File) => void;
    onModelChange: (model: string) => void;
    onExtendedThinkingChange: () => void;
    onToggleMode: (mode: ChatMode) => void;
    onSetTone: (tone: ToneType | null) => void;
    onAutoSkillSettingChange: (s: AutoSkillSetting) => void;
    onSelectModel?: (model: string) => void;
    onToggleExtended?: () => void;
    modelOptions?: Model[];
    modelSelectorTitle?: string;
    secondarySelector?: React.ReactNode;
    multiAgent?: boolean;
    onToggleMultiAgent?: () => void;
    initialContent?: string;
    initialFile?: File;
    renderPlusMenu?: (props: {
        onUploadFile: (file: File) => void;
        onScreenshot: () => void;
    }) => React.ReactNode;
    onInputChange?: (text: string) => void;
    onStop?: () => void;
}

const TONE_EMOJI: Record<ToneType, string> = {
    formal: '👔',
    concise: '⚡',
    detailed: '📝',
    minimal: '·',
};

const PLACEHOLDERS_FIRST = [
    'Ask anything…',
    'What are you building?',
    'Explore an idea…',
    "What's on your mind?",
    "Let's figure it out together…",
    'What do you need?',
];

const PLACEHOLDERS_RETURNING = [
    'Welcome back — what are we working on?',
    'Pick up where you left off…',
    'Good to see you again…',
    "What's next on your list?",
    'Your AI is ready…',
    "Let's keep going…",
];

function getPlaceholders(): string[] {
    if (typeof window === 'undefined') return PLACEHOLDERS_FIRST;
    try {
        const count = parseInt(localStorage.getItem('tripplet_session_count') ?? '0', 10);
        return count > 1 ? PLACEHOLDERS_RETURNING : PLACEHOLDERS_FIRST;
    } catch {
        return PLACEHOLDERS_FIRST;
    }
}

// Bump session count once per browser session (client only)
if (typeof window !== 'undefined') {
    try {
        const counted = sessionStorage.getItem('tripplet_session_counted');
        if (!counted) {
            const prev = parseInt(localStorage.getItem('tripplet_session_count') ?? '0', 10);
            localStorage.setItem('tripplet_session_count', String(prev + 1));
            sessionStorage.setItem('tripplet_session_counted', '1');
        }
    } catch { /* private browsing */ }
}

// PLACEHOLDERS is determined client-side after hydration (see useEffect in InputBox)
const DRAFT_KEY = 'tripplet_input_draft';
const DRAFT_SAVE_DELAY = 400; // ms

function InputBox({
    selectedModel,
    extendedThinking,
    isStreaming,
    activeModes,
    activeTone,
    autoSkillSetting,
    onSend,
    onModelChange,
    onExtendedThinkingChange,
    onToggleMode,
    onSetTone,
    onAutoSkillSettingChange,
    onSelectModel,
    onToggleExtended,
    modelOptions,
    modelSelectorTitle,
    secondarySelector,
    multiAgent,
    onToggleMultiAgent,
    initialContent,
    initialFile,
    renderPlusMenu,
    onInputChange,
    onStop,
}: InputBoxProps) {
    // Start with SSR-safe defaults — hydrate from localStorage in useEffect
    const [content, setContent] = useState(initialContent ?? '');
    const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
    const [placeholders, setPlaceholders] = useState<string[]>(PLACEHOLDERS_FIRST);
    const [placeholderIndex, setPlaceholderIndex] = useState(0);
    const [isFocused, setIsFocused] = useState(false);
    const [hadDraft, setHadDraft] = useState(false);
    const [sendOnEnter, setSendOnEnter] = useState(true);
    const [isComposing, setIsComposing] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reducedMotion = useReducedMotionPreference();

    const handleModelChange = onSelectModel || onModelChange;
    const handleToggleExtended = onToggleExtended || onExtendedThinkingChange;

    // After hydration: read localStorage for draft + returning-user placeholders
    useEffect(() => {
        if (initialContent) return;
        try {
            const draft = localStorage.getItem(DRAFT_KEY) ?? '';
            if (draft) { setContent(draft); setHadDraft(true); }
        } catch { /* private browsing */ }
        setPlaceholders(getPlaceholders());
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const syncInputSettings = () => {
            setSendOnEnter(loadSettings().sendOnEnter);
        };

        syncInputSettings();
        window.addEventListener(SETTINGS_EVENT, syncInputSettings);
        return () => window.removeEventListener(SETTINGS_EVENT, syncInputSettings);
    }, []);

    // Persist draft to localStorage (debounced) — Zeigarnik: unfinished input pulls you back
    useEffect(() => {
        if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        draftTimerRef.current = setTimeout(() => {
            try { localStorage.setItem(DRAFT_KEY, content); } catch { /* ignore */ }
        }, DRAFT_SAVE_DELAY);
        return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
    }, [content]);

    // Rotate placeholder while empty and not focused
    useEffect(() => {
        if (content.length > 0 || isFocused) return;
        const t = setInterval(() => {
            setPlaceholderIndex((i) => (i + 1) % placeholders.length);
        }, 3500);
        return () => clearInterval(t);
    }, [content.length, isFocused, placeholders.length]);

    useEffect(() => {
        return () => {
            if (uploadedFile?.preview) URL.revokeObjectURL(uploadedFile.preview);
        };
    }, [uploadedFile?.preview]);

    useEffect(() => {
        if (initialFile) {
            const isImage = initialFile.type.startsWith('image/');
            const preview = isImage ? URL.createObjectURL(initialFile) : undefined;
            setUploadedFile({ file: initialFile, preview });
        }
    }, [initialFile]);

    useEffect(() => {
        if (initialContent && content === '') setContent(initialContent);
    }, [initialContent]);

    const autoResize = useCallback(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
    }, []);

    // Auto-resize textarea if draft was restored
    useEffect(() => { if (hadDraft) autoResize(); }, [hadDraft, autoResize]);

    const handleSend = useCallback(() => {
        if ((!content.trim() && !uploadedFile) || isStreaming) return;
        onSend(content, uploadedFile?.file);
        setContent('');
        setUploadedFile(null);
        try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
    }, [content, uploadedFile, isStreaming, onSend]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key !== 'Enter') return;
        if (isComposing || e.nativeEvent.isComposing) return;

        const shouldSend = sendOnEnter ? !e.shiftKey : (e.metaKey || e.ctrlKey);
        if (!shouldSend) return;

        e.preventDefault();
        handleSend();
    }, [handleSend, isComposing, sendOnEnter]);

    const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setContent(val);
        onInputChange?.(val);
        autoResize();
    }, [autoResize, onInputChange]);

    const handleFileUpload = useCallback((file: File) => {
        const isImage = file.type.startsWith('image/');
        const preview = isImage ? URL.createObjectURL(file) : undefined;
        setUploadedFile({ file, preview });
    }, []);

    const removeFile = useCallback(() => setUploadedFile(null), []);

    const handleStop = useCallback(() => {
        onStop?.();
    }, [onStop]);

    const contextualHint = useContextualHint(content, activeModes);
    const hasActivePills = activeModes.length > 0 || activeTone !== null;
    const canSend = Boolean(content.trim() || uploadedFile) && !isStreaming;
    const sendShortcutLabel = sendOnEnter ? '↵ send · ⇧↵ newline' : '⌘/Ctrl ↵ send · ↵ newline';
    const stopEnabled = isStreaming && Boolean(onStop);

    return (
        <div className="w-full max-w-3xl mx-auto px-4 mb-0">

            <motion.div
                animate={
                    reducedMotion
                        ? undefined
                        : isFocused
                            ? { scale: 1.005, y: -1 }
                            : { scale: 1, y: 0 }
                }
                transition={{ duration: reducedMotion ? 0 : 0.15 }}
                className={cn(
                    'relative flex flex-col rounded-[20px] border-2 bg-card transition-all duration-200',
                    isFocused
                        ? 'border-foreground/30 shadow-lg shadow-foreground/5'
                        : 'border-border shadow-sm',
                    isStreaming && 'border-foreground/20 shadow-lg shadow-foreground/[0.03]'
                )}
                aria-busy={isStreaming}
            >
                {/* Uploaded file preview */}
                <AnimatePresence>
                    {uploadedFile && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="px-4 pt-3 pb-1"
                        >
                            <div className="inline-flex items-center gap-2.5 rounded-xl border border-border bg-muted/60 px-3 py-2">
                                {uploadedFile.preview ? (
                                    <img src={uploadedFile.preview} alt="" className="h-9 w-9 rounded-lg object-cover" />
                                ) : (
                                    <div className="h-9 w-9 rounded-lg bg-foreground/10 flex items-center justify-center text-[10px] font-bold text-foreground/50">
                                        {uploadedFile.file.name.split('.').pop()?.toUpperCase()}
                                    </div>
                                )}
                                <div className="flex flex-col min-w-0">
                                    <span className="text-xs font-semibold truncate max-w-[160px]">{uploadedFile.file.name}</span>
                                    <span className="text-[10px] text-muted-foreground">{(uploadedFile.file.size / 1024).toFixed(0)} KB</span>
                                </div>
                                <button onClick={removeFile} className="ml-auto p-1 rounded-full hover:bg-foreground/10 transition-colors">
                                    <X size={12} className="text-muted-foreground" />
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Active mode pills */}
                <AnimatePresence>
                    {hasActivePills && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="flex flex-wrap items-center gap-1.5 px-4 pt-3"
                        >
                            {activeModes.map((modeId) => {
                                const config = MODE_CONFIGS[modeId];
                                return (
                                    <span key={modeId} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-foreground text-background rounded-full text-xs font-semibold">
                                        <span>{config.emoji}</span>
                                        <span>{config.label}</span>
                                        <button onClick={() => onToggleMode(modeId)} className="ml-0.5 hover:opacity-70 transition-opacity">
                                            <HugeiconsIcon icon={Cancel01Icon} size={9} />
                                        </button>
                                    </span>
                                );
                            })}
                            {activeTone && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-foreground text-background rounded-full text-xs font-semibold">
                                    <span>{TONE_EMOJI[activeTone]}</span>
                                    <span className="capitalize">{activeTone}</span>
                                    <button onClick={() => onSetTone(null)} className="ml-0.5 hover:opacity-70 transition-opacity">
                                        <HugeiconsIcon icon={Cancel01Icon} size={9} />
                                    </button>
                                </span>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Contextual feature hint */}
                <AnimatePresence>
                    {contextualHint && (
                        <motion.div
                            key={contextualHint.label}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2 }}
                            className="px-4 pt-2.5 overflow-hidden"
                        >
                            {contextualHint.href ? (
                                <Link href={contextualHint.href}>
                                    <div className="inline-flex items-center gap-2 rounded-lg bg-violet-500/8 border border-violet-500/15 px-3 py-1.5 hover:bg-violet-500/15 transition-colors cursor-pointer group">
                                        <span className="text-[11px] font-semibold text-violet-400">{contextualHint.label}</span>
                                        <span className="text-[10px] text-violet-400/60">·</span>
                                        <span className="text-[10px] text-violet-400/70">{contextualHint.sub}</span>
                                        <ArrowRight className="h-3 w-3 text-violet-400/50 transition-transform duration-150 group-hover:translate-x-0.5" />
                                    </div>
                                </Link>
                            ) : contextualHint.mode ? (
                                <button onClick={() => onToggleMode(contextualHint.mode!)}>
                                    <div className="inline-flex items-center gap-2 rounded-lg bg-indigo-500/8 border border-indigo-500/15 px-3 py-1.5 hover:bg-indigo-500/15 transition-colors cursor-pointer group">
                                        <span className="text-[11px] font-semibold text-indigo-400">{contextualHint.label}</span>
                                        <span className="text-[10px] text-indigo-400/60">·</span>
                                        <span className="text-[10px] text-indigo-400/70">{contextualHint.sub}</span>
                                        <ArrowRight className="h-3 w-3 text-indigo-400/50 transition-transform duration-150 group-hover:translate-x-0.5" />
                                    </div>
                                </button>
                            ) : null}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Text area row */}
                <div className="flex items-end gap-2 px-3 pt-3 pb-2">
                    {/* Plus menu (file uploads) */}
                    <div className={cn('shrink-0 mb-0.5', isStreaming && 'pointer-events-none opacity-60')}>
                        {renderPlusMenu ? renderPlusMenu({
                            onUploadFile: handleFileUpload,
                            onScreenshot: () => {},
                        }) : (
                            <PlusMenu
                                onUploadFile={handleFileUpload}
                                onScreenshot={() => {}}
                            />
                        )}
                    </div>

                    {/* Textarea */}
                    <textarea
                        ref={textareaRef}
                        value={content}
                        disabled={isStreaming}
                        onChange={handleInput}
                        onKeyDown={handleKeyDown}
                        onCompositionStart={() => setIsComposing(true)}
                        onCompositionEnd={() => setIsComposing(false)}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => setIsFocused(false)}
                        placeholder={hadDraft && content.length > 0 ? 'Pick up where you left off…' : placeholders[placeholderIndex]}
                        rows={1}
                        className="flex-1 min-h-[44px] max-h-[220px] resize-none bg-transparent text-[15px] font-medium text-foreground placeholder:text-muted-foreground/50 outline-none py-2.5 px-1 leading-relaxed scrollbar-thin"
                    />

                    {/* Send button */}
                    <motion.button
                        onClick={isStreaming ? handleStop : handleSend}
                        disabled={isStreaming ? !stopEnabled : !canSend}
                        whileHover={(!isStreaming && canSend) || stopEnabled ? { scale: 1.05 } : {}}
                        whileTap={(!isStreaming && canSend) || stopEnabled ? { scale: 0.92 } : {}}
                        className={cn(
                            'shrink-0 mb-0.5 h-9 w-9 rounded-xl flex items-center justify-center transition-all duration-200 font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                            isStreaming
                                ? 'bg-muted-foreground/10 text-muted-foreground border border-border/40 hover:bg-muted-foreground/15'
                                : canSend
                                    ? 'bg-black text-white shadow-lg hover:shadow-xl hover:bg-black/90'
                                    : 'bg-muted text-muted-foreground/40 cursor-not-allowed'
                        )}
                        title={isStreaming ? 'Stop generation' : 'Send message'}
                        aria-label={isStreaming ? 'Stop generation' : 'Send message'}
                    >
                        {isStreaming ? (
                            <Square className="h-3.5 w-3.5 fill-current" />
                        ) : (
                            <motion.div
                                animate={canSend && !reducedMotion ? { y: [0, -2, 0] } : {}}
                                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                            >
                                <HugeiconsIcon icon={ArrowUp02Icon} size={19} strokeWidth={2.5} />
                            </motion.div>
                        )}
                    </motion.button>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-4 pb-2.5 pt-0">
                    <div className={cn('flex items-center gap-2', isStreaming && 'pointer-events-none opacity-70')}>
                        <ModelSelector
                            selectedModelId={selectedModel}
                            onSelectModel={handleModelChange}
                            extendedThinking={extendedThinking}
                            onToggleExtended={handleToggleExtended}
                            models={modelOptions}
                            menuTitle={modelSelectorTitle}
                            multiAgent={multiAgent}
                            onToggleMultiAgent={onToggleMultiAgent}
                        />
                        {secondarySelector}
                    </div>
                    <span className="text-[10px] text-muted-foreground/40 font-mono select-none hidden sm:block">
                        {sendShortcutLabel}
                    </span>
                </div>
            </motion.div>
        </div>
    );
}

function areInputBoxPropsEqual(prev: InputBoxProps, next: InputBoxProps) {
    return (
        prev.selectedModel === next.selectedModel &&
        prev.extendedThinking === next.extendedThinking &&
        prev.isStreaming === next.isStreaming &&
        prev.activeModes === next.activeModes &&
        prev.activeTone === next.activeTone &&
        prev.autoSkillSetting === next.autoSkillSetting &&
        prev.onSend === next.onSend &&
        prev.onModelChange === next.onModelChange &&
        prev.onExtendedThinkingChange === next.onExtendedThinkingChange &&
        prev.onToggleMode === next.onToggleMode &&
        prev.onSetTone === next.onSetTone &&
        prev.onAutoSkillSettingChange === next.onAutoSkillSettingChange &&
        prev.onSelectModel === next.onSelectModel &&
        prev.onToggleExtended === next.onToggleExtended &&
        prev.modelOptions === next.modelOptions &&
        prev.modelSelectorTitle === next.modelSelectorTitle &&
        prev.secondarySelector === next.secondarySelector &&
        prev.multiAgent === next.multiAgent &&
        prev.onToggleMultiAgent === next.onToggleMultiAgent &&
        prev.initialContent === next.initialContent &&
        prev.initialFile === next.initialFile &&
        prev.renderPlusMenu === next.renderPlusMenu &&
        prev.onInputChange === next.onInputChange &&
        prev.onStop === next.onStop
    );
}

export default memo(InputBox, areInputBoxPropsEqual);
