'use client';

import { memo } from 'react';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { HugeiconsIcon } from '@hugeicons/react';
import { MagicWand01Icon, Tick01Icon } from '@hugeicons/core-free-icons';
import { ChatMode, ToneType, AutoSkillSetting } from '@/types';
import { MODE_CONFIGS } from '@/lib/ai/modes';
import { MODE_ICONS, MODE_ORDER, TONE_OPTIONS } from '@/lib/ai/mode-icons';
import { cn } from '@/lib/utils';

interface SkillsPanelProps {
    activeModes: ChatMode[];
    activeTone: ToneType | null;
    onToggleMode: (mode: ChatMode) => void;
    onSetTone: (tone: ToneType | null) => void;
    autoSkillSetting: AutoSkillSetting;
    onAutoSkillSettingChange: (s: AutoSkillSetting) => void;
}

const AUTO_OPTIONS: { id: AutoSkillSetting; label: string }[] = [
    { id: 'off', label: 'Off' },
    { id: 'ask', label: 'Ask' },
    { id: 'auto', label: 'Auto' },
];

function SkillsPanel({
    activeModes,
    activeTone,
    onToggleMode,
    onSetTone,
    autoSkillSetting,
    onAutoSkillSettingChange,
}: SkillsPanelProps) {
    const activeCount = activeModes.length + (activeTone ? 1 : 0);

    return (
        <Popover>
            <PopoverTrigger
                className={cn(
                    'inline-flex items-center justify-center rounded-full text-sm font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    'h-9 shrink-0 gap-1.5 px-3',
                    activeCount > 0
                        ? 'bg-brand/15 text-brand hover:bg-brand/25'
                        : 'hover:bg-accent text-muted-foreground'
                )}
            >
                <HugeiconsIcon icon={MagicWand01Icon} size={16} />
                <span className="text-xs font-semibold">Skills</span>
                {activeCount > 0 && (
                    <span className="ml-0.5 min-w-[18px] h-[18px] rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center">
                        {activeCount}
                    </span>
                )}
            </PopoverTrigger>
            <PopoverContent
                align="start"
                side="top"
                className="w-[360px] sm:w-[420px] p-0 max-h-[75vh] overflow-y-auto scrollbar-thin"
            >
                {/* Header */}
                <div className="px-4 pt-3.5 pb-2 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-foreground">Skills</h3>
                    {activeCount > 0 && (
                        <span className="text-[10px] text-muted-foreground font-medium">
                            {activeCount} active
                        </span>
                    )}
                </div>

                {/* Skills grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 px-3 pb-3">
                    {MODE_ORDER.map((modeId) => {
                        const config = MODE_CONFIGS[modeId];
                        const icon = MODE_ICONS[modeId];
                        const isActive = activeModes.includes(modeId);

                        return (
                            <button
                                key={modeId}
                                onClick={() => onToggleMode(modeId)}
                                className={cn(
                                    'relative flex flex-col items-start gap-1 rounded-xl px-3 py-2.5 text-left transition-all duration-150',
                                    'hover:bg-accent/80 cursor-pointer outline-none border',
                                    isActive
                                        ? 'border-brand/40 bg-brand/8'
                                        : 'border-transparent hover:border-border'
                                )}
                            >
                                <div className="flex items-center gap-2 w-full">
                                    <HugeiconsIcon
                                        icon={icon}
                                        size={16}
                                        className={cn(
                                            'shrink-0',
                                            isActive ? 'text-brand' : 'text-muted-foreground'
                                        )}
                                    />
                                    <span className={cn(
                                        'text-xs font-semibold truncate',
                                        isActive ? 'text-brand' : 'text-foreground'
                                    )}>
                                        {config.label}
                                    </span>
                                    {isActive && (
                                        <HugeiconsIcon
                                            icon={Tick01Icon}
                                            size={10}
                                            className="text-brand ml-auto shrink-0"
                                        />
                                    )}
                                </div>
                                <p className="text-[10px] leading-tight text-muted-foreground line-clamp-2">
                                    {config.description}
                                </p>
                            </button>
                        );
                    })}
                </div>

                {/* Divider */}
                <div className="h-px bg-border mx-3" />

                {/* Tone chips */}
                <div className="px-4 py-3">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tone</span>
                    <div className="flex items-center gap-1.5 mt-2">
                        {TONE_OPTIONS.map((opt) => {
                            const isActive = activeTone === opt.id;
                            return (
                                <button
                                    key={opt.id}
                                    onClick={() => onSetTone(isActive ? null : opt.id)}
                                    className={cn(
                                        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150',
                                        'cursor-pointer outline-none border',
                                        isActive
                                            ? 'border-brand/40 bg-brand/10 text-brand'
                                            : 'border-border hover:bg-accent text-muted-foreground hover:text-foreground'
                                    )}
                                >
                                    <HugeiconsIcon icon={opt.icon} size={12} />
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Divider */}
                <div className="h-px bg-border mx-3" />

                {/* Auto-Skills */}
                <div className="px-4 py-3 pb-3.5">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">AI Auto-Skills</span>
                    </div>
                    <div className="flex items-center rounded-lg border border-border overflow-hidden">
                        {AUTO_OPTIONS.map((opt) => (
                            <button
                                key={opt.id}
                                onClick={() => onAutoSkillSettingChange(opt.id)}
                                className={cn(
                                    'flex-1 py-1.5 text-xs font-semibold text-center transition-all duration-150 outline-none',
                                    autoSkillSetting === opt.id
                                        ? 'bg-brand text-white'
                                        : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent/60'
                                )}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1.5">
                        {autoSkillSetting === 'off' && 'You pick skills manually.'}
                        {autoSkillSetting === 'ask' && 'AI suggests skills — you confirm.'}
                        {autoSkillSetting === 'auto' && 'AI picks skills automatically.'}
                    </p>
                </div>
            </PopoverContent>
        </Popover>
    );
}

function areSkillsPanelPropsEqual(prev: SkillsPanelProps, next: SkillsPanelProps) {
    return (
        prev.activeModes === next.activeModes &&
        prev.activeTone === next.activeTone &&
        prev.onToggleMode === next.onToggleMode &&
        prev.onSetTone === next.onSetTone &&
        prev.autoSkillSetting === next.autoSkillSetting &&
        prev.onAutoSkillSettingChange === next.onAutoSkillSettingChange
    );
}

export default memo(SkillsPanel, areSkillsPanelPropsEqual);
