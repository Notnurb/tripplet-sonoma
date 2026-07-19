'use client';

import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Cloud, Check, X, ChevronRight,
    Loader2, HardDrive, FileText,
    Scale, Zap, Sparkles, Server,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    CloudEnvironment, CloudEnvLicense, StorageTier,
    useCloudEnvironments,
} from '@/hooks/useCloudEnvironments';

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_OPTIONS: { mb: StorageTier; label: string; files: string; desc: string; slow?: boolean; popular?: boolean }[] = [
    { mb: 25,  label: '25 MB',  files: '~50 code files',              desc: 'Quick experiments' },
    { mb: 50,  label: '50 MB',  files: '~100 code files',             desc: 'Small projects' },
    { mb: 100, label: '100 MB', files: '~200 code files + assets',    desc: 'Real projects', slow: true, popular: true },
    { mb: 500, label: '500 MB', files: '~1,000 files, images, data',  desc: 'Full-scale apps', slow: true },
];

const LICENSES: { value: CloudEnvLicense; label: string; desc: string }[] = [
    { value: 'unlicense',   label: 'The Unlicense',               desc: 'No restrictions — completely public domain' },
    { value: 'mit',         label: 'MIT License',                 desc: 'Simple and permissive. Most popular.' },
    { value: 'bsd-2-clause',label: 'BSD 2-Clause',                desc: 'Like MIT but different attribution style' },
    { value: 'zlib',        label: 'Zlib License',                desc: 'Simple, no advertising clause' },
    { value: 'lgpl',        label: 'GNU LGPL',                    desc: 'Copyleft but allows proprietary linking' },
    { value: 'mpl-2.0',    label: 'Mozilla Public License 2.0',  desc: 'File-level copyleft, weak viral' },
    { value: 'apache-2.0', label: 'Apache 2.0',                   desc: 'Permissive + patent rights included' },
];

const STEPS = ['Storage', 'Configure', 'Creating', 'Done'];

function slugify(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

// ─── Step 1: Storage ──────────────────────────────────────────────────────────

function StorageStep({ selected, onSelect }: { selected: StorageTier | null; onSelect: (mb: StorageTier) => void }) {
    return (
        <div className="flex flex-col gap-4">
            <div className="text-center">
                <h2 className="text-xl font-bold text-foreground">How much storage?</h2>
                <p className="text-sm text-muted-foreground mt-1">Pick the right size for your project. You can always create more environments.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
                {STORAGE_OPTIONS.map((opt) => (
                    <button
                        key={opt.mb}
                        onClick={() => onSelect(opt.mb)}
                        className={cn(
                            'relative flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all duration-200 group',
                            selected === opt.mb
                                ? 'border-foreground bg-foreground/5 ring-2 ring-foreground/20'
                                : 'border-border hover:border-foreground/30 hover:bg-accent/50',
                            opt.popular && selected !== opt.mb && 'border-foreground/25',
                        )}
                    >
                        {opt.popular && (
                            <span className="absolute top-2.5 right-2.5 text-[9px] font-bold uppercase tracking-wide bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded-full border border-emerald-500/20">
                                Most chosen
                            </span>
                        )}
                        <div className={cn(
                            'flex items-center justify-center w-9 h-9 rounded-xl transition-colors',
                            selected === opt.mb ? 'bg-foreground text-background' : 'bg-foreground/8 text-foreground group-hover:bg-foreground/12',
                        )}>
                            <HardDrive className="h-4 w-4" />
                        </div>
                        <div>
                            <p className="font-bold text-foreground text-lg leading-none">{opt.label}</p>
                            <p className="text-[10px] text-muted-foreground/70 mt-0.5">{opt.desc}</p>
                            <p className="text-xs text-muted-foreground mt-1">{opt.files}</p>
                        </div>
                        <span className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wider">Free</span>
                        {selected === opt.mb && (
                            <div className="absolute top-2.5 left-2.5">
                                <div className="flex items-center justify-center w-5 h-5 rounded-full bg-foreground">
                                    <Check className="h-3 w-3 text-background" />
                                </div>
                            </div>
                        )}
                    </button>
                ))}
            </div>
            {selected && (selected === 100 || selected === 500) && (
                <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-start gap-2.5 rounded-xl bg-muted/50 border border-border/60 px-3.5 py-3 text-sm"
                >
                    <p className="text-muted-foreground">
                        Larger workspaces need a moment to spin up — typically <span className="font-medium text-foreground/80">3–8 seconds</span>. Once running, performance is identical.
                    </p>
                </motion.div>
            )}
        </div>
    );
}

// ─── Step 2: Configure ────────────────────────────────────────────────────────

interface ConfigState {
    name: string;
    slug: string;
    slugManual: boolean;
    description: string;
    photoUrl: string;
    photoPreview: string | null;
    hasReadme: boolean;
    license: CloudEnvLicense;
}

function ConfigStep({ config, onChange }: { config: ConfigState; onChange: (patch: Partial<ConfigState>) => void }) {
    const photoInputRef = useRef<HTMLInputElement>(null);

    const handleNameChange = (name: string) => {
        onChange({ name, ...(!config.slugManual ? { slug: slugify(name) } : {}) });
    };

    const handleSlugChange = (slug: string) => {
        onChange({ slug: slugify(slug), slugManual: true });
    };

    const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        onChange({ photoUrl: url, photoPreview: url });
    };

    return (
        <div className="flex flex-col gap-5">
            <div className="text-center">
                <h2 className="text-xl font-bold text-foreground">Configure your environment</h2>
                <p className="text-sm text-muted-foreground mt-1">Give it a name and make it yours.</p>
            </div>

            {/* Name + slug */}
            <div className="flex flex-col gap-3">
                <div>
                    <label className="text-xs font-semibold text-foreground/70 uppercase tracking-wider mb-1.5 block">Name *</label>
                    <input
                        value={config.name}
                        onChange={(e) => handleNameChange(e.target.value)}
                        placeholder="My Awesome Project"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground/50 text-sm outline-none focus:border-foreground/40 transition-colors"
                    />
                </div>
                <div>
                    <label className="text-xs font-semibold text-foreground/70 uppercase tracking-wider mb-1.5 block">Slug *</label>
                    <div className="flex items-center rounded-xl border border-border bg-background overflow-hidden focus-within:border-foreground/40 transition-colors">
                        <span className="pl-3.5 text-sm text-muted-foreground/60 select-none">/c/</span>
                        <input
                            value={config.slug}
                            onChange={(e) => handleSlugChange(e.target.value)}
                            placeholder="my-awesome-project"
                            className="flex-1 px-2 py-2.5 bg-transparent text-foreground text-sm outline-none"
                        />
                    </div>
                    <p className="text-[11px] text-muted-foreground/50 mt-1">Your environment will be at <span className="font-mono text-foreground/60">/c/{config.slug || 'slug'}</span></p>
                </div>
            </div>

            {/* Photo */}
            <div>
                <label className="text-xs font-semibold text-foreground/70 uppercase tracking-wider mb-1.5 block">Icon <span className="font-normal normal-case text-muted-foreground/50">(optional)</span></label>
                <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => photoInputRef.current?.click()}
                        className="flex items-center justify-center w-16 h-16 rounded-2xl border-2 border-dashed border-border hover:border-foreground/30 transition-colors group relative overflow-hidden"
                    >
                        {config.photoPreview ? (
                             
                            <img src={config.photoPreview} alt="env icon" className="w-full h-full object-cover" />
                        ) : (
                            <Cloud className="h-7 w-7 text-muted-foreground/40 group-hover:text-muted-foreground/60 transition-colors" />
                        )}
                    </button>
                    <div>
                        <button
                            onClick={() => photoInputRef.current?.click()}
                            className="text-sm text-foreground/70 hover:text-foreground underline underline-offset-2 transition-colors"
                        >
                            {config.photoPreview ? 'Change photo' : 'Upload photo'}
                        </button>
                        <p className="text-[11px] text-muted-foreground/40 mt-0.5">PNG, JPG, GIF up to 2MB. Default is a cloud icon.</p>
                    </div>
                </div>
            </div>

            {/* README + License row */}
            <div className="grid grid-cols-2 gap-3">
                {/* README toggle */}
                <div
                    className={cn(
                        'flex items-center gap-3 rounded-xl border p-3.5 cursor-pointer transition-all',
                        config.hasReadme ? 'border-foreground/30 bg-foreground/5' : 'border-border hover:border-foreground/20',
                    )}
                    onClick={() => onChange({ hasReadme: !config.hasReadme })}
                >
                    <div className={cn(
                        'flex items-center justify-center w-8 h-8 rounded-lg transition-colors shrink-0',
                        config.hasReadme ? 'bg-foreground text-background' : 'bg-foreground/8 text-foreground',
                    )}>
                        <FileText className="h-4 w-4" />
                    </div>
                    <div>
                        <p className="text-sm font-medium">README</p>
                        <p className="text-[11px] text-muted-foreground/60">Add a README.md</p>
                    </div>
                    <div className={cn(
                        'ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all',
                        config.hasReadme ? 'border-foreground bg-foreground' : 'border-muted-foreground/30',
                    )}>
                        {config.hasReadme && <Check className="h-3 w-3 text-background" />}
                    </div>
                </div>

                {/* License selector */}
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                        <Scale className="h-3.5 w-3.5 text-muted-foreground/60" />
                        <label className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">License</label>
                    </div>
                    <select
                        value={config.license}
                        onChange={(e) => onChange({ license: e.target.value as CloudEnvLicense })}
                        className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:border-foreground/40 transition-colors"
                    >
                        {LICENSES.map((l) => (
                            <option key={l.value} value={l.value}>{l.label}</option>
                        ))}
                    </select>
                    <p className="text-[10px] text-muted-foreground/40">
                        {LICENSES.find(l => l.value === config.license)?.desc}
                    </p>
                </div>
            </div>
        </div>
    );
}

// ─── Step 3: Creating ─────────────────────────────────────────────────────────

const CREATION_STEPS = [
    { label: 'Reserving your slug', icon: Zap },
    { label: 'Initializing storage bucket', icon: HardDrive },
    { label: 'Setting up server', icon: Server },
    { label: 'Applying license & README', icon: FileText },
    { label: 'Going live', icon: Sparkles },
];

function CreatingStep() {
    const [step, setStep] = useState(0);

    useState(() => {
        let i = 0;
        const id = setInterval(() => {
            i++;
            setStep(i);
            if (i >= CREATION_STEPS.length) clearInterval(id);
        }, 480);
    });

    return (
        <div className="flex flex-col items-center gap-6 py-4">
            <div className="relative flex items-center justify-center w-20 h-20">
                <motion.div
                    className="absolute inset-0 rounded-full border-2 border-foreground/10 border-t-foreground/60"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                />
                <Cloud className="h-8 w-8 text-foreground/60" />
            </div>
            <div className="flex flex-col gap-2 w-full max-w-xs">
                {CREATION_STEPS.map((s, i) => {
                    const Icon = s.icon;
                    const done = i < step;
                    const active = i === step;
                    return (
                        <motion.div
                            key={s.label}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.08 }}
                            className={cn(
                                'flex items-center gap-2.5 text-sm transition-all duration-400',
                                done && 'text-muted-foreground/40 line-through',
                                active && 'text-foreground',
                                !done && !active && 'text-foreground/25',
                            )}
                        >
                            {done ? (
                                <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                            ) : active ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                            ) : (
                                <Icon className="h-3.5 w-3.5 shrink-0 opacity-30" />
                            )}
                            {s.label}
                        </motion.div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Step 4: Done ─────────────────────────────────────────────────────────────

function DoneStep({ env, onOpen }: { env: CloudEnvironment; onOpen: () => void }) {
    const [copied, setCopied] = useState(false);
    const url = `/c/${env.slug}`;
    const handleCopy = () => {
        navigator.clipboard.writeText(window.location.origin + url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="flex flex-col items-center gap-5 py-4 text-center">
            <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                className="flex items-center justify-center w-20 h-20 rounded-3xl bg-emerald-500/10 border border-emerald-500/20"
            >
                {env.photoUrl ? (
                     
                    <img src={env.photoUrl} alt={env.name} className="w-16 h-16 rounded-2xl object-cover" />
                ) : (
                    <Cloud className="h-9 w-9 text-emerald-500" />
                )}
            </motion.div>
            <div>
                <p className="text-xl font-bold text-foreground">{env.name} is live!</p>
                <p className="text-sm text-muted-foreground mt-1">Your cloud environment is ready. You can find it in the sidebar.</p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 w-full max-w-xs">
                <span className="flex-1 text-sm font-mono text-foreground/70 truncate">{url}</span>
                <button onClick={handleCopy} className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0">
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : 'Copy'}
                </button>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-xs">
                <button
                    onClick={onOpen}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-foreground text-background font-semibold text-sm hover:opacity-85 transition-opacity"
                >
                    <Server className="h-4 w-4" />
                    Open Environment
                </button>
                <p className="text-[11px] text-muted-foreground/50">
                    Also accessible from the sidebar under &ldquo;Cloud Environments&rdquo;
                </p>
            </div>
        </div>
    );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

interface WizardProps {
    onClose: () => void;
    onCreated?: (env: CloudEnvironment) => void;
}

export default function CloudEnvWizard({ onClose, onCreated }: WizardProps) {
    const { create } = useCloudEnvironments();
    const [step, setStep] = useState(0);
    const [storage, setStorage] = useState<StorageTier | null>(100);
    const [config, setConfig] = useState<ConfigState>({
        name: '',
        slug: '',
        slugManual: false,
        description: '',
        photoUrl: '',
        photoPreview: null,
        hasReadme: true,
        license: 'mit',
    });
    const [createdEnv, setCreatedEnv] = useState<CloudEnvironment | null>(null);

    const patchConfig = useCallback((patch: Partial<ConfigState>) => {
        setConfig(prev => ({ ...prev, ...patch }));
    }, []);

    const canNext = () => {
        if (step === 0) return storage !== null;
        if (step === 1) return config.name.trim().length > 0 && config.slug.trim().length > 0;
        return true;
    };

    const handleNext = async () => {
        if (step === 0 && storage) { setStep(1); return; }
        if (step === 1) {
            setStep(2);
            // Simulate creation delay then actually create
            await new Promise(r => setTimeout(r, 2600));
            const env = create({
                name: config.name.trim(),
                slug: config.slug.trim(),
                storageLimitMb: storage!,
                photoUrl: config.photoUrl || undefined,
                hasReadme: config.hasReadme,
                license: config.license,
            });
            setCreatedEnv(env);
            setStep(3);
            onCreated?.(env);
        }
    };

    const handleOpenEnv = () => {
        if (createdEnv) {
            window.location.href = `/c/${createdEnv.slug}`;
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={step < 2 ? onClose : undefined}
            />

            {/* Modal */}
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                className="relative bg-background border border-border rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
                    <div className="flex items-center gap-2.5">
                        <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-foreground/8">
                            <Cloud className="h-4 w-4 text-foreground/70" />
                        </div>
                        <span className="font-semibold text-sm text-foreground">New Cloud Environment</span>
                    </div>
                    {/* Step pills */}
                    <div className="flex items-center gap-1.5">
                        {STEPS.slice(0, 2).map((s, i) => (
                            <div
                                key={s}
                                className={cn(
                                    'h-1.5 rounded-full transition-all duration-300',
                                    i === step ? 'w-6 bg-foreground' : i < step ? 'w-3 bg-foreground/40' : 'w-3 bg-foreground/15',
                                )}
                            />
                        ))}
                    </div>
                    {step < 2 && (
                        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>

                {/* Body */}
                <div className="px-6 py-5 max-h-[calc(90vh-200px)] overflow-y-auto">
                    <AnimatePresence mode="wait">
                        {step === 0 && (
                            <motion.div key="storage" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                                <StorageStep selected={storage} onSelect={setStorage} />
                            </motion.div>
                        )}
                        {step === 1 && (
                            <motion.div key="config" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                                <ConfigStep config={config} onChange={patchConfig} />
                            </motion.div>
                        )}
                        {step === 2 && (
                            <motion.div key="creating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                                <CreatingStep />
                            </motion.div>
                        )}
                        {step === 3 && createdEnv && (
                            <motion.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                                <DoneStep env={createdEnv} onOpen={handleOpenEnv} />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Footer */}
                {step < 2 && (
                    <div className="px-6 pb-5 pt-2 flex items-center justify-between border-t border-border">
                        {step > 0 ? (
                            <button onClick={() => setStep(s => s - 1)} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                                ← Back
                            </button>
                        ) : (
                            <div />
                        )}
                        <button
                            onClick={handleNext}
                            disabled={!canNext()}
                            className={cn(
                                'flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all',
                                canNext()
                                    ? 'bg-foreground text-background hover:opacity-85'
                                    : 'bg-foreground/10 text-foreground/30 cursor-not-allowed',
                            )}
                        >
                            {step === 1 ? 'Create Environment' : 'Next'}
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                )}
            </motion.div>
        </div>
    );
}
