'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Settings2, User, Paintbrush, Info, Plus, Download, Upload, Keyboard, Shield, Trash2, FileJson, ExternalLink, Wand2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { loadSettings, updateSetting, applySettings, saveSettings } from '@/lib/settings';
import { downloadVm, isVmDownloaded, bootVm } from '@/lib/sandbox/trippletLinux';
import type { AutoSkillSetting } from '@/types';
import Link from 'next/link';

// ── Types ──────────────────────────────────────────────────────────────────────

interface PersonalizationPreset {
    version: '1.0';
    name: string;
    keywords: string[];
    instructions: string;
}

const STORAGE = {
    name: 'tripplet_persona_name',
    keywords: 'tripplet_persona_keywords',
    instructions: 'tripplet_persona_instructions',
};

function loadPersonalization(): PersonalizationPreset {
    if (typeof window === 'undefined') return { version: '1.0', name: '', keywords: [], instructions: '' };
    return {
        version: '1.0',
        name: localStorage.getItem(STORAGE.name) || '',
        keywords: JSON.parse(localStorage.getItem(STORAGE.keywords) || '[]'),
        instructions: localStorage.getItem(STORAGE.instructions) || '',
    };
}

function savePersonalization(name: string, keywords: string[], instructions: string) {
    localStorage.setItem(STORAGE.name, name);
    localStorage.setItem(STORAGE.keywords, JSON.stringify(keywords));
    localStorage.setItem(STORAGE.instructions, instructions);
}

// ── Sections ───────────────────────────────────────────────────────────────────

const SECTIONS = [
    { id: 'general', label: 'General', icon: Settings2 },
    { id: 'personalization', label: 'Personalization', icon: User },
    { id: 'appearance', label: 'Appearance', icon: Paintbrush },
    { id: 'skills', label: 'Manage Skills', icon: Wand2 },
    { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
    { id: 'privacy', label: 'Privacy & Data', icon: Shield },
    { id: 'about', label: 'About', icon: Info },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

// ── Sub-components ─────────────────────────────────────────────────────────────

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{label}</p>
                {description && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>}
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}

function SectionDivider({ label }: { label: string }) {
    return (
        <div className="pt-2 pb-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">{label}</p>
        </div>
    );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={cn(
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200',
                checked ? 'bg-brand' : 'bg-muted-foreground/25'
            )}
        >
            <span className={cn(
                'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                checked ? 'translate-x-4' : 'translate-x-0'
            )} />
        </button>
    );
}

function GeneralSection() {
    const s = loadSettings();
    const [sendOnEnter, setSendOnEnter] = useState(s.sendOnEnter);
    const [autoTitle, setAutoTitle] = useState(s.autoTitle);
    const [showTimestamps, setShowTimestamps] = useState(s.showTimestamps);
    const [soundEffects, setSoundEffects] = useState(s.soundEffects);
    const [autoSkills, setAutoSkills] = useState<AutoSkillSetting>(s.autoSkills ?? 'off');
    const [legacyModels, setLegacyModels] = useState(s.legacyModels ?? false);
    const [sandboxedLinux, setSandboxedLinux] = useState(s.sandboxedLinux ?? true);
    const [vmDownloaded, setVmDownloaded] = useState(false);
    const [vmDownloading, setVmDownloading] = useState(false);
    useEffect(() => { setVmDownloaded(isVmDownloaded()); }, []);

    const handleDownloadVm = async () => {
        setVmDownloading(true);
        try {
            await downloadVm();
            setVmDownloaded(true);
            // Boot in the background immediately so the first run_bash lands
            // on a warm guest instead of waiting out the cold boot.
            void bootVm().catch(() => { /* surfaces on first run */ });
            // Re-broadcast so open chat surfaces pick up that the skill is now live.
            saveSettings(loadSettings());
        } catch {
            toast.error('Could not download the Linux VM. Check your connection and try again.');
        } finally {
            setVmDownloading(false);
        }
    };

    const set = <K extends 'sendOnEnter' | 'autoTitle' | 'showTimestamps' | 'soundEffects' | 'legacyModels' | 'sandboxedLinux'>(
        key: K, val: boolean, setState: (v: boolean) => void
    ) => {
        setState(val);
        applySettings(updateSetting(key, val));
    };

    const setSkillSetting = (val: AutoSkillSetting) => {
        setAutoSkills(val);
        applySettings(updateSetting('autoSkills', val));
    };

    return (
        <div className="space-y-5">
            <SectionDivider label="Chat" />
            <SettingRow label="Default model" description="The model selected when you open a new chat.">
                <select className="text-xs bg-muted/50 border border-border rounded-lg px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-brand/30">
                    <option value="suzhou-3">Suzhou 3.1</option>
                    <option value="majuli-3">Majuli 3.1</option>
                    <option value="taipei-3">Taipei 3.1</option>
                </select>
            </SettingRow>
            <SettingRow label="Send on Enter" description="Press Enter to send. Shift+Enter for a new line.">
                <Toggle checked={sendOnEnter} onChange={(v) => set('sendOnEnter', v, setSendOnEnter)} />
            </SettingRow>
            <SettingRow label="Auto-title conversations" description="Automatically generate a title from the first message.">
                <Toggle checked={autoTitle} onChange={(v) => set('autoTitle', v, setAutoTitle)} />
            </SettingRow>
            <SettingRow label="AI Auto-Skills" description="Let the AI activate skills based on what you ask.">
                <div className="flex items-center bg-muted/50 border border-border rounded-lg p-0.5 gap-0.5">
                    {([['off', 'Off'], ['ask', 'Ask'], ['auto', 'Auto']] as const).map(([val, label]) => (
                        <button
                            key={val}
                            onClick={() => setSkillSetting(val)}
                            className={cn(
                                'px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150',
                                autoSkills === val
                                    ? 'bg-foreground/10 text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </SettingRow>
            <SettingRow label="Show message timestamps" description="Display the time each message was sent.">
                <Toggle checked={showTimestamps} onChange={(v) => set('showTimestamps', v, setShowTimestamps)} />
            </SettingRow>
            <SettingRow label="Sound effects" description="Play a soft sound when a response finishes.">
                <Toggle checked={soundEffects} onChange={(v) => set('soundEffects', v, setSoundEffects)} />
            </SettingRow>
            <SectionDivider label="Models" />
            <SettingRow label="Legacy Models" description="Show older personas (Synthara 5.2 Plus, Taipei 3, Majuli 3, Suzhou 3) in the model picker.">
                <Toggle checked={legacyModels} onChange={(v) => set('legacyModels', v, setLegacyModels)} />
            </SettingRow>
            <SectionDivider label="Skills" />
            <SettingRow label="Tripplet Sandboxed Linux" description="Let the assistant run bash in a real Linux VM that runs entirely in your browser (the run_bash skill).">
                <Toggle checked={sandboxedLinux} onChange={(v) => set('sandboxedLinux', v, setSandboxedLinux)} />
            </SettingRow>
            {sandboxedLinux && (
                <SettingRow label="Linux VM runtime" description="~12 MB, downloaded once and cached. The skill only works after this is downloaded.">
                    {vmDownloaded ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">
                            <Download className="h-3.5 w-3.5" /> Downloaded
                        </span>
                    ) : (
                        <button
                            onClick={handleDownloadVm}
                            disabled={vmDownloading}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground bg-muted/60 border border-border rounded-lg px-3 py-1.5 hover:bg-muted disabled:opacity-60"
                        >
                            <Download className="h-3.5 w-3.5" />
                            {vmDownloading ? 'Downloading…' : 'Download (~12 MB)'}
                        </button>
                    )}
                </SettingRow>
            )}
            <SectionDivider label="Storage" />
            <SettingRow label="Chat history" description="Conversations are saved locally in your browser.">
                <span className="inline-flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">
                    Saved locally
                </span>
            </SettingRow>
        </div>
    );
}

function PersonalizationSection({
    name, keywords, instructions, keywordInput,
    onNameChange, onKeywordInputChange, onAddKeyword, onRemoveKeyword,
    onInstructionsChange, onSavePreset, onLoadPresetClick, fileInputRef, onFileChange,
}: {
    name: string;
    keywords: string[];
    instructions: string;
    keywordInput: string;
    onNameChange: (v: string) => void;
    onKeywordInputChange: (v: string) => void;
    onAddKeyword: () => void;
    onRemoveKeyword: (kw: string) => void;
    onInstructionsChange: (v: string) => void;
    onSavePreset: () => void;
    onLoadPresetClick: () => void;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
    return (
        <div className="space-y-5">
            <SectionDivider label="Identity" />

            {/* Name */}
            <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">What should Tripplet call you?</label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    placeholder="Your name or nickname..."
                    className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-brand/30 transition-all"
                />
            </div>

            <SectionDivider label="Context" />

            {/* Keywords */}
            <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Keywords</label>
                <p className="text-xs text-muted-foreground">Topics and interests that shape how Tripplet responds to you.</p>
                <div className="flex flex-wrap gap-1.5 min-h-[32px]">
                    {keywords.map((kw) => (
                        <span
                            key={kw}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-brand/10 border border-brand/20 text-brand text-xs font-medium"
                        >
                            {kw}
                            <button
                                onClick={() => onRemoveKeyword(kw)}
                                className="ml-0.5 rounded-full hover:bg-brand/20 p-0.5 transition-colors"
                                aria-label={`Remove ${kw}`}
                            >
                                <X size={9} />
                            </button>
                        </span>
                    ))}
                </div>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={keywordInput}
                        onChange={(e) => onKeywordInputChange(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddKeyword(); } }}
                        placeholder="Add a keyword..."
                        className="flex-1 bg-muted/40 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-brand/30 transition-all"
                    />
                    <button
                        onClick={onAddKeyword}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand/10 text-brand border border-brand/20 text-xs font-medium hover:bg-brand/20 transition-colors"
                    >
                        <Plus size={12} />
                        Add
                    </button>
                </div>
            </div>

            {/* Instructions */}
            <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Custom instructions</label>
                <p className="text-xs text-muted-foreground">Tell Tripplet how you want it to behave, format responses, or what to always keep in mind.</p>
                <textarea
                    value={instructions}
                    onChange={(e) => onInstructionsChange(e.target.value)}
                    placeholder="e.g. Always reply with code examples. Keep responses concise. I'm a senior engineer..."
                    rows={4}
                    className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-brand/30 resize-none transition-all"
                />
            </div>

            <SectionDivider label="Presets" />

            {/* Save / Load */}
            <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Save your personalization as a <code className="font-mono text-brand">.prsn</code> file to reuse across devices, or load one to apply it instantly.</p>
                <div className="flex gap-2">
                    <button
                        onClick={onSavePreset}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-foreground/80 hover:bg-muted/50 hover:text-foreground transition-all"
                    >
                        <Download size={13} />
                        Save as .prsn
                    </button>
                    <button
                        onClick={onLoadPresetClick}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-foreground/80 hover:bg-muted/50 hover:text-foreground transition-all"
                    >
                        <Upload size={13} />
                        Load .prsn
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".prsn,.json"
                        onChange={onFileChange}
                        className="hidden"
                    />
                </div>
            </div>
        </div>
    );
}

function AppearanceSection() {
    const s = loadSettings();
    const [activeTheme, setActiveTheme] = useState(s.theme);
    const [density, setDensity] = useState(s.messageDensity);
    const [sidebarWidth, setSidebarWidth] = useState(s.sidebarWidth);
    const [reducedMotion, setReducedMotion] = useState(s.reduceMotion);
    const [codeTheme, setCodeTheme] = useState(s.codeTheme);

    const selectTheme = (id: string) => {
        setActiveTheme(id);
        applySettings(updateSetting('theme', id));
    };

    return (
        <div className="space-y-5">
            <SectionDivider label="Theme" />
            <SettingRow label="Color theme" description="White is the default. Midnight is pure black, Dark is the classic dark mode.">
                <select
                    value={activeTheme}
                    onChange={(e) => selectTheme(e.target.value)}
                    className="text-xs bg-muted/50 border border-border rounded-lg px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-brand/30"
                >
                    <option value="white">White</option>
                    <option value="midnight">Midnight</option>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="arctic">Arctic</option>
                    <option value="rose">Rose</option>
                    <option value="brown">Brown</option>
                    <option value="volcano">Volcano</option>
                    <option value="ocean">Ocean</option>
                    <option value="forest">Forest</option>
                    <option value="sunset">Sunset</option>
                    <option value="grape">Grape</option>
                    <option value="amber">Amber</option>
                    <option value="slate">Slate</option>
                    <option value="crimson">Crimson</option>
                    <option value="emerald">Emerald</option>
                </select>
            </SettingRow>

            <SectionDivider label="Layout" />
            <SettingRow label="Message density" description="Controls spacing between chat messages.">
                <select
                    value={density}
                    onChange={(e) => {
                        const v = e.target.value as typeof density;
                        setDensity(v);
                        applySettings(updateSetting('messageDensity', v));
                    }}
                    className="text-xs bg-muted/50 border border-border rounded-lg px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-brand/30"
                >
                    <option value="comfortable">Comfortable</option>
                    <option value="compact">Compact</option>
                </select>
            </SettingRow>
            <SettingRow label="Sidebar width" description="Adjust the sidebar to fit your workflow.">
                <select
                    value={sidebarWidth}
                    onChange={(e) => {
                        const v = e.target.value as typeof sidebarWidth;
                        setSidebarWidth(v);
                        applySettings(updateSetting('sidebarWidth', v));
                    }}
                    className="text-xs bg-muted/50 border border-border rounded-lg px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-brand/30"
                >
                    <option value="narrow">Narrow (210px)</option>
                    <option value="default">Default (260px)</option>
                    <option value="wide">Wide (320px)</option>
                </select>
            </SettingRow>
            <SettingRow label="Reduce motion" description="Minimize animations for accessibility.">
                <Toggle
                    checked={reducedMotion}
                    onChange={(v) => {
                        setReducedMotion(v);
                        applySettings(updateSetting('reduceMotion', v));
                    }}
                />
            </SettingRow>

            <SectionDivider label="Code Blocks" />
            <SettingRow label="Syntax theme" description="Color theme for code in responses.">
                <select
                    value={codeTheme}
                    onChange={(e) => {
                        const v = e.target.value as typeof codeTheme;
                        setCodeTheme(v);
                        applySettings(updateSetting('codeTheme', v));
                    }}
                    className="text-xs bg-muted/50 border border-border rounded-lg px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-brand/30"
                >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="github">GitHub</option>
                    <option value="monokai">Monokai</option>
                </select>
            </SettingRow>

            {/* Skins */}
            <div className="pt-2 pb-1 flex items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Skins</p>
                <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/25 rounded-full leading-none">
                    Beta
                </span>
            </div>
            <div className="space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                    Apply custom CSS skins to change Tripplet&apos;s appearance. Upload a <code className="font-mono text-foreground/70 bg-muted/50 px-1 py-0.5 rounded">.css</code> file or use the AI Quickstart to generate one.
                </p>
                <SkinsUploadRow />
                <Link
                    href="/skins"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:text-brand/80 transition-colors"
                >
                    Learn more
                    <ExternalLink size={11} />
                </Link>
            </div>
        </div>
    );
}

function SkinsUploadRow() {
    const fileRef = useRef<HTMLInputElement>(null);
    const [activeName, setActiveName] = useState<string | null>(() => {
        if (typeof window === 'undefined') return null;
        try {
            const stored = localStorage.getItem('tripplet_custom_skin');
            return stored ? JSON.parse(stored).name : null;
        } catch { return null; }
    });

    const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !file.name.endsWith('.css')) {
            toast.error('Invalid file', { description: 'Please upload a .css file.' });
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            const css = ev.target?.result as string;
            const name = file.name.replace(/\.css$/, '');
            localStorage.setItem('tripplet_custom_skin', JSON.stringify({ css, name }));
            let el = document.getElementById('tripplet-custom-skin');
            if (!el) {
                el = document.createElement('style');
                el.id = 'tripplet-custom-skin';
                document.head.appendChild(el);
            }
            el.textContent = css;
            setActiveName(name);
            toast.success('Skin applied!', { description: `Loaded ${file.name}` });
        };
        reader.readAsText(file);
        e.target.value = '';
    }, []);

    const handleRemove = useCallback(() => {
        const el = document.getElementById('tripplet-custom-skin');
        if (el) el.remove();
        localStorage.removeItem('tripplet_custom_skin');
        setActiveName(null);
        toast('Skin removed');
    }, []);

    return (
        <div className="flex items-center gap-2">
            {activeName ? (
                <>
                    <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">
                        {activeName}
                    </span>
                    <button
                        onClick={handleRemove}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Remove
                    </button>
                </>
            ) : (
                <button
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
                >
                    <Upload size={12} />
                    Upload .css
                </button>
            )}
            <input ref={fileRef} type="file" accept=".css" onChange={handleUpload} className="hidden" />
        </div>
    );
}

const SHORTCUTS = [
    { keys: ['⌘', 'N'], label: 'New chat' },
    { keys: ['⌘', 'K'], label: 'Focus input' },
    { keys: ['⌘', '/'], label: 'Open shortcuts' },
    { keys: ['⌘', 'B'], label: 'Toggle sidebar' },
    { keys: ['Esc'], label: 'Close modal / Cancel' },
    { keys: ['↑'], label: 'Edit last message' },
    { keys: ['⌘', 'C'], label: 'Copy last response' },
    { keys: ['⌘', '⇧', 'C'], label: 'Copy code block' },
    { keys: ['Enter'], label: 'Send message' },
    { keys: ['⇧', 'Enter'], label: 'New line in input' },
];

function ShortcutsSection() {
    return (
        <div className="space-y-5">
            <SectionDivider label="Keyboard Shortcuts" />
            <div className="space-y-1">
                {SHORTCUTS.map(({ keys, label }) => (
                    <div key={label} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                        <span className="text-sm text-muted-foreground">{label}</span>
                        <div className="flex items-center gap-1">
                            {keys.map((k, i) => (
                                <kbd key={i} className="inline-flex items-center justify-center min-w-[26px] h-6 px-1.5 text-[11px] font-mono font-medium bg-muted/60 border border-border rounded-md text-foreground/70">
                                    {k}
                                </kbd>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function PrivacySection() {
    const [confirmClear, setConfirmClear] = useState(false);
    const s = loadSettings();
    const [trainTriplepediaModels, setTrainTriplepediaModels] = useState(s.trainTriplepediaModels);

    const set = <K extends 'trainTriplepediaModels'>(key: K, val: boolean, setState: (v: boolean) => void) => {
        setState(val);
        applySettings(updateSetting(key, val));
    };

    const handleExport = useCallback(() => {
        try {
            const keys = Object.keys(localStorage).filter((k) => k.startsWith('tripplet_') || k.startsWith('chat_'));
            const data: Record<string, unknown> = {};
            keys.forEach((k) => {
                try { data[k] = JSON.parse(localStorage.getItem(k)!); } catch { data[k] = localStorage.getItem(k); }
            });
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `tripplet-export-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast('Export downloaded', { duration: 2500 });
        } catch {
            toast.error('Export failed');
        }
    }, []);

    const handleClear = useCallback(() => {
        if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 4000); return; }
        const keys = Object.keys(localStorage).filter((k) => k.startsWith('tripplet_') || k.startsWith('chat_'));
        keys.forEach((k) => localStorage.removeItem(k));
        setConfirmClear(false);
        toast('All chat data cleared', { duration: 3000 });
        setTimeout(() => window.location.reload(), 500);
    }, [confirmClear]);

    return (
        <div className="space-y-5">
            <SectionDivider label="Your Data" />
            <SettingRow label="Storage location" description="All data lives in your browser's localStorage. Nothing is sent to our servers without your action.">
                <span className="text-xs text-muted-foreground/60 bg-muted/40 px-2 py-1 rounded-md border border-border">Local only</span>
            </SettingRow>

            <SectionDivider label="Triplepedia Models" />
            <SettingRow
                label="Background Triplepedia training"
                description="When enabled, this device will continuously import random Wikipedia articles in the background to improve Triplepedia models. You can turn this off anytime."
            >
                <Toggle
                    checked={trainTriplepediaModels}
                    onChange={(v) => set('trainTriplepediaModels', v, setTrainTriplepediaModels)}
                />
            </SettingRow>

            <SectionDivider label="Export" />
            <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Download all your conversations and settings as a JSON file.</p>
                <button
                    onClick={handleExport}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-foreground/80 hover:bg-muted/50 hover:text-foreground transition-all"
                >
                    <FileJson size={13} />
                    Export all data
                </button>
            </div>

            <SectionDivider label="Danger Zone" />
            <div className="space-y-2">
                <p className="text-xs text-muted-foreground">This will permanently delete all local conversations and settings. This cannot be undone.</p>
                <button
                    onClick={handleClear}
                    className={cn(
                        'inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all',
                        confirmClear
                            ? 'border-rose-500/50 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20'
                            : 'border-border text-muted-foreground hover:border-rose-500/40 hover:text-rose-400 hover:bg-rose-500/5'
                    )}
                >
                    <Trash2 size={13} />
                    {confirmClear ? 'Click again to confirm — this is permanent' : 'Clear all data'}
                </button>
            </div>
        </div>
    );
}

const VERSIONS = [
    { id: 'v1', label: 'V1', desc: 'Original chat interface', url: '/v1/chat' },
    { id: 'v2', label: 'V2', desc: 'Updated V1 experience', url: '/v2/chat' },
    { id: 'v3', label: 'V3', desc: 'Hefai — classic UI', url: 'http://localhost:3001' },
    { id: 'current', label: 'Current V3.1', desc: 'Tripplet Sonoma — you are here', url: null },
] as const;

function VersionPicker({ onClose }: { onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-background shadow-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-semibold">Go Back</h3>
                    <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
                        <X size={16} />
                    </button>
                </div>
                <div className="space-y-2">
                    {VERSIONS.map((v) => (
                        <div key={v.id} className={cn(
                            'flex items-center justify-between p-3 rounded-xl border transition-all',
                            v.url === null
                                ? 'border-brand/30 bg-brand/5 cursor-default'
                                : 'border-border hover:border-foreground/20 hover:bg-accent/40 cursor-pointer'
                        )} onClick={() => {
                            if (!v.url) return;
                            if (v.url.startsWith('http')) { window.open(v.url, '_blank'); }
                            else { window.location.href = v.url; }
                            onClose();
                        }}>
                            <div>
                                <p className={cn('text-sm font-semibold', v.url === null && 'text-brand')}>{v.label}</p>
                                <p className="text-xs text-muted-foreground">{v.desc}</p>
                            </div>
                            {v.url !== null && <ChevronRight size={14} className="text-muted-foreground" />}
                            {v.url === null && <span className="text-[10px] font-bold uppercase tracking-wide text-brand bg-brand/10 px-2 py-0.5 rounded-full">Active</span>}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function AboutSection() {
    const [showVersionPicker, setShowVersionPicker] = useState(false);

    return (
        <div className="space-y-5">
            {showVersionPicker && <VersionPicker onClose={() => setShowVersionPicker(false)} />}
            <SectionDivider label="App" />
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Version</span>
                    <button
                        onClick={() => setShowVersionPicker(true)}
                        className="flex items-center gap-1.5 text-xs font-mono text-foreground/70 bg-muted/50 hover:bg-accent px-2 py-0.5 rounded-md border border-border hover:border-foreground/20 transition-all"
                    >
                        v3.1 Sonoma
                        <ChevronRight size={11} />
                    </button>
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">License</span>
                    <span className="text-xs text-muted-foreground">Unlicense (open source)</span>
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Release cadence</span>
                    <span className="text-xs text-muted-foreground">Weekly</span>
                </div>
            </div>

            <SectionDivider label="Models" />
            <div className="space-y-2">
                {[
                    { name: 'Suzhou 3.1', desc: 'Creative and detailed generation' },
                    { name: 'Majuli 3.1', desc: 'Fast and concise responses' },
                    { name: 'Taipei 3.1', desc: 'Advanced reasoning and analysis' },
                ].map((m) => (
                    <div key={m.name} className="flex items-center justify-between py-1">
                        <span className="text-sm font-medium text-foreground">{m.name}</span>
                        <span className="text-xs text-muted-foreground">{m.desc}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Main Modal ─────────────────────────────────────────────────────────────────

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const [mounted, setMounted] = useState(false);
    const [activeSection, setActiveSection] = useState<SectionId>('general');
    const [personaName, setPersonaName] = useState('');
    const [keywords, setKeywords] = useState<string[]>([]);
    const [instructions, setInstructions] = useState('');
    const [keywordInput, setKeywordInput] = useState('');
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => { setMounted(true); }, []);

    // Load from localStorage when modal opens
    useEffect(() => {
        if (!isOpen) return;
        const saved = loadPersonalization();
        setPersonaName(saved.name);
        setKeywords(saved.keywords);
        setInstructions(saved.instructions);
    }, [isOpen]);

    // Close on Escape
    useEffect(() => {
        if (!isOpen) return;
        const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handle);
        return () => window.removeEventListener('keydown', handle);
    }, [isOpen, onClose]);

    const handleNameChange = useCallback((v: string) => {
        setPersonaName(v);
        savePersonalization(v, keywords, instructions);
    }, [keywords, instructions]);

    const handleAddKeyword = useCallback(() => {
        const kw = keywordInput.trim();
        if (!kw || keywords.includes(kw)) return;
        const next = [...keywords, kw];
        setKeywords(next);
        setKeywordInput('');
        savePersonalization(personaName, next, instructions);
    }, [keywordInput, keywords, personaName, instructions]);

    const handleRemoveKeyword = useCallback((kw: string) => {
        const next = keywords.filter((k) => k !== kw);
        setKeywords(next);
        savePersonalization(personaName, next, instructions);
    }, [keywords, personaName, instructions]);

    const handleInstructionsChange = useCallback((v: string) => {
        setInstructions(v);
        savePersonalization(personaName, keywords, v);
    }, [personaName, keywords]);

    const handleSavePreset = useCallback(() => {
        const preset: PersonalizationPreset = { version: '1.0', name: personaName, keywords, instructions };
        const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${personaName.replace(/\s+/g, '-').toLowerCase() || 'my-persona'}.prsn`;
        a.click();
        URL.revokeObjectURL(url);
        toast('Preset saved!', { description: `Downloaded as .prsn file`, duration: 2500 });
    }, [personaName, keywords, instructions]);

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const preset = JSON.parse(ev.target?.result as string) as PersonalizationPreset;
                const name = preset.name || '';
                const kws = Array.isArray(preset.keywords) ? preset.keywords : [];
                const instr = preset.instructions || '';
                setPersonaName(name);
                setKeywords(kws);
                setInstructions(instr);
                savePersonalization(name, kws, instr);
                toast('Preset loaded!', { description: `Applied from ${file.name}`, duration: 2500 });
            } catch {
                toast.error('Invalid file', { description: 'Could not read the .prsn file.', duration: 3000 });
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }, []);

    const modalContent = (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm"
                        onClick={onClose}
                    />

                    {/* Dialog — centered square */}
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 pointer-events-none">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 12 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 12 }}
                            transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] as const }}
                            className="w-[700px] h-[600px] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden pointer-events-auto flex"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Left nav */}
                            <div className="w-[190px] shrink-0 border-r border-border bg-sidebar flex flex-col py-5">
                                <p className="px-4 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-3">Settings</p>
                                <nav className="flex flex-col gap-0.5 px-2">
                                    {SECTIONS.map(({ id, label, icon: Icon }) => (
                                        <button
                                            key={id}
                                            onClick={() => setActiveSection(id)}
                                            className={cn(
                                                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150 text-left w-full',
                                                activeSection === id
                                                    ? 'bg-sidebar-accent text-foreground font-medium'
                                                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
                                            )}
                                        >
                                            <Icon size={14} className="shrink-0" />
                                            {label}
                                        </button>
                                    ))}
                                </nav>
                            </div>

                            {/* Right content */}
                            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                                {/* Header */}
                                <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
                                    <h2 className="text-sm font-semibold text-foreground">
                                        {SECTIONS.find((s) => s.id === activeSection)?.label}
                                    </h2>
                                    <button
                                        onClick={onClose}
                                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                                        aria-label="Close settings"
                                    >
                                        <X size={15} />
                                    </button>
                                </div>

                                {/* Scrollable content */}
                                <div className="flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
                                    {activeSection === 'general' && <GeneralSection />}
                                    {activeSection === 'personalization' && (
                                        <PersonalizationSection
                                            name={personaName}
                                            keywords={keywords}
                                            instructions={instructions}
                                            keywordInput={keywordInput}
                                            onNameChange={handleNameChange}
                                            onKeywordInputChange={setKeywordInput}
                                            onAddKeyword={handleAddKeyword}
                                            onRemoveKeyword={handleRemoveKeyword}
                                            onInstructionsChange={handleInstructionsChange}
                                            onSavePreset={handleSavePreset}
                                            onLoadPresetClick={() => fileInputRef.current?.click()}
                                            fileInputRef={fileInputRef}
                                            onFileChange={handleFileChange}
                                        />
                                    )}
                                    {activeSection === 'appearance' && <AppearanceSection />}
                                    {activeSection === 'shortcuts' && <ShortcutsSection />}
                                    {activeSection === 'privacy' && <PrivacySection />}
                                    {activeSection === 'about' && <AboutSection />}
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );

    if (!mounted) return null;
    return createPortal(modalContent, document.body);
}
