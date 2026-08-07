import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { memo, useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';
import { MODELS, Model } from '@/lib/ai/models';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import { LockIcon } from 'lucide-react';
import { motion } from 'framer-motion';

const MODEL_META: Record<string, { bestFor: string; speed: number; depth: number }> = {
    'taipei4':    { bestFor: 'Hard problems, deep research', speed: 2, depth: 5 },
    'majuli4':  { bestFor: 'Quick answers, fast Q&A',      speed: 5, depth: 3 },
    'suzhou4':  { bestFor: 'Stories, brainstorming, creative', speed: 4, depth: 4 },
};

function ModelBar({ value, max = 5, color }: { value: number; max?: number; color: string }) {
    return (
        <div className="flex items-center gap-px">
            {Array.from({ length: max }).map((_, i) => (
                <div
                    key={i}
                    className={cn('h-1 w-2 rounded-sm transition-colors', i < value ? color : 'bg-muted-foreground/15')}
                />
            ))}
        </div>
    );
}

interface ModelSelectorProps {
    selectedModelId: string;
    extendedThinking: boolean;
    onSelectModel: (modelId: string) => void;
    onToggleExtended?: () => void;
    models?: Model[];
    menuTitle?: string;
    showExtendedToggle?: boolean;
    multiAgent?: boolean;
    onToggleMultiAgent?: () => void;
}

function ModelSelector({
    selectedModelId,
    extendedThinking,
    onSelectModel,
    onToggleExtended,
    models,
    menuTitle,
    showExtendedToggle = true,
    multiAgent,
    onToggleMultiAgent,
}: ModelSelectorProps) {
    const { user, isLoading } = useAuth();
    const isSignedIn = !!user;
    const isLoaded = !isLoading;
    const [isOpen, setIsOpen] = useState(false);
    const options = useMemo(() => models ?? MODELS, [models]);
    const selectedModel = useMemo(
        () => options.find((model) => model.id === selectedModelId) || options[0],
        [options, selectedModelId]
    );
    const dropdownTitle = menuTitle ?? 'Model';

    const isTaipei = selectedModel.id === 'taipei4';
    const triggerLabel = extendedThinking
        ? `${selectedModel.name} · Expanded`
        : selectedModel.name;

    return (
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
            <DropdownMenuTrigger className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200',
                'border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                'cursor-pointer hover:scale-[1.02] active:scale-[0.98]',
                isOpen
                    ? 'bg-muted/60 border-border/60 text-foreground'
                    : 'text-muted-foreground border-transparent hover:bg-muted/50 hover:border-border/40 hover:text-foreground'
            )}>
                <motion.div
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-1.5 w-full"
                >
                    <span className={cn("text-foreground", extendedThinking && "font-semibold")}>
                        {triggerLabel}
                    </span>
                    {multiAgent && <span className="text-violet-400 font-normal">Multi</span>}
                    <motion.div
                        animate={isOpen ? { rotate: 180 } : { rotate: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        <HugeiconsIcon icon={ArrowDown01Icon} size={12} className="opacity-50" />
                    </motion.div>
                </motion.div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[260px] p-1.5">
                <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{dropdownTitle}</div>
                {options.map((model) => {
                    const isTaipei = model.id === 'taipei4';
                    const isLocked = isTaipei && isLoaded && !isSignedIn;
                    const meta = MODEL_META[model.id];
                    const isSelected = selectedModelId === model.id;

                    return (
                        <motion.div
                            key={model.id}
                            initial={{ opacity: 0, x: -4 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.2, delay: options.indexOf(model) * 0.05 }}
                        >
                            <DropdownMenuItem
                                disabled={isLocked}
                                onClick={() => !isLocked && onSelectModel(model.id)}
                                className={cn(
                                    "flex items-center justify-between cursor-pointer rounded-lg px-2 py-1.5 transition-all duration-200",
                                    isSelected && "bg-muted/70",
                                    !isSelected && !isLocked && "hover:bg-muted/50",
                                    isLocked && "opacity-60 cursor-default"
                                )}
                            >
                            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-sm font-medium">{model.name}</span>
                                    {isLocked && <LockIcon className="w-3 h-3 text-muted-foreground shrink-0" />}
                                </div>
                                {isLocked ? (
                                    <span className="text-[10px] text-muted-foreground">
                                        <Link href="/register" className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                                            Free account
                                        </Link> unlocks this
                                    </span>
                                ) : (
                                    <div className="flex items-center gap-2.5">
                                        <span className="text-[10px] text-muted-foreground truncate">{meta?.bestFor ?? model.description}</span>
                                    </div>
                                )}
                                {meta && !isLocked && (
                                    <div className="flex items-center gap-3 mt-0.5">
                                        <div className="flex items-center gap-1">
                                            <span className="text-[9px] text-muted-foreground/50 w-6">Spd</span>
                                            <ModelBar value={meta.speed} color="bg-emerald-500/60" />
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <span className="text-[9px] text-muted-foreground/50 w-6">Dep</span>
                                            <ModelBar value={meta.depth} color="bg-violet-500/60" />
                                        </div>
                                    </div>
                                )}
                            </div>
                            {isSelected && (
                                <motion.div
                                    initial={{ scale: 0.8 }}
                                    animate={{ scale: 1 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    <HugeiconsIcon icon={Tick02Icon} size={14} className="text-foreground shrink-0 ml-2" />
                                </motion.div>
                            )}
                        </DropdownMenuItem>
                    </motion.div>
                );
                })}
                {showExtendedToggle && onToggleExtended && (
                    <>
                        <DropdownMenuSeparator className="my-1" />
                        <motion.div
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.99 }}
                            className="flex items-center justify-between px-2 py-1.5 select-none cursor-pointer hover:bg-muted/50 rounded-lg transition-colors"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onToggleExtended();
                            }}
                        >
                            <div>
                                <span className="text-xs font-medium">Expand thought process</span>
                                <p className="text-[9px] text-muted-foreground">
                                    {isTaipei
                                        ? 'Unlimited reasoning. Taipei thinks longer on harder asks.'
                                        : 'Deeper reasoning, slower responses.'}
                                </p>
                            </div>
                            <motion.div
                                className={cn(
                                    "w-8 h-[18px] rounded-full relative shrink-0",
                                    extendedThinking ? "bg-foreground" : "bg-muted-foreground/30"
                                )}
                                animate={{
                                    backgroundColor: extendedThinking ? 'var(--color-foreground)' : 'var(--color-muted-foreground/0.3)',
                                }}
                                transition={{ duration: 0.2 }}
                            >
                                <motion.div
                                    className="absolute top-[2px] left-[2px] w-[14px] h-[14px] bg-white rounded-full shadow-sm"
                                    animate={{
                                        x: extendedThinking ? 14 : 0,
                                    }}
                                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                                />
                            </motion.div>
                        </motion.div>
                        {onToggleMultiAgent !== undefined && (
                            <motion.div
                                whileHover={{ scale: 1.01 }}
                                whileTap={{ scale: 0.99 }}
                                className="flex items-center justify-between px-2 py-1.5 select-none cursor-pointer hover:bg-muted/50 rounded-lg transition-colors"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onToggleMultiAgent();
                                }}
                            >
                                <div>
                                    <span className="text-xs font-medium">Multi-Agent</span>
                                    <p className="text-[9px] text-muted-foreground">3 agents answer at once</p>
                                </div>
                                <motion.div
                                    className={cn(
                                        "w-8 h-[18px] rounded-full relative shrink-0",
                                        multiAgent ? "bg-violet-500" : "bg-muted-foreground/30"
                                    )}
                                    animate={{
                                        backgroundColor: multiAgent ? 'rgb(168 85 247)' : 'var(--color-muted-foreground/0.3)',
                                    }}
                                    transition={{ duration: 0.2 }}
                                >
                                    <motion.div
                                        className="absolute top-[2px] left-[2px] w-[14px] h-[14px] bg-white rounded-full shadow-sm"
                                        animate={{
                                            x: multiAgent ? 14 : 0,
                                        }}
                                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                                    />
                                </motion.div>
                            </motion.div>
                        )}
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function areModelSelectorPropsEqual(prev: ModelSelectorProps, next: ModelSelectorProps) {
    return (
        prev.selectedModelId === next.selectedModelId &&
        prev.extendedThinking === next.extendedThinking &&
        prev.onSelectModel === next.onSelectModel &&
        prev.onToggleExtended === next.onToggleExtended &&
        prev.menuTitle === next.menuTitle &&
        prev.models === next.models &&
        prev.showExtendedToggle === next.showExtendedToggle &&
        prev.multiAgent === next.multiAgent &&
        prev.onToggleMultiAgent === next.onToggleMultiAgent
    );
}

export default memo(ModelSelector, areModelSelectorPropsEqual);
