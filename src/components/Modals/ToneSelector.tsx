'use client';

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { ToneType } from '@/types';
import { cn } from '@/lib/utils';
import { HugeiconsIcon } from '@hugeicons/react';
import { Tick02Icon } from '@hugeicons/core-free-icons';

interface ToneSelectorProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectedTone: ToneType;
    onSelect: (tone: ToneType) => void;
}

const TONES: { id: ToneType; label: string; description: string }[] = [
    { id: 'formal', label: 'Formal', description: 'Professional and business-oriented.' },
    { id: 'concise', label: 'Concise', description: 'Short and to the point.' },
    { id: 'detailed', label: 'Detailed', description: 'Thorough and comprehensive.' },
    { id: 'minimal', label: 'Minimal', description: 'Ultra-short. Just the essentials.' },
];

export default function ToneSelector({
    open,
    onOpenChange,
    selectedTone,
    onSelect,
}: ToneSelectorProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Select Tone</DialogTitle>
                    <DialogDescription>
                        Choose how Tripplet should respond to you.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    {TONES.map((tone) => (
                        <div
                            key={tone.id}
                            onClick={() => {
                                onSelect(tone.id);
                                onOpenChange(false);
                            }}
                            className={cn(
                                "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors hover:bg-muted",
                                selectedTone === tone.id ? "border-primary bg-primary/5" : "border-border"
                            )}
                        >
                            <div className="flex flex-col">
                                <span className="font-medium text-sm">{tone.label}</span>
                                <span className="text-xs text-muted-foreground">{tone.description}</span>
                            </div>
                            {selectedTone === tone.id && (
                                <HugeiconsIcon icon={Tick02Icon} size={16} className="text-primary" />
                            )}
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}
