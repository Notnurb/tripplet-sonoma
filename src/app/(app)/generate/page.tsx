'use client';

import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Image01Icon } from '@hugeicons/core-free-icons';

export default function GeneratePage() {
    return (
        <div className="flex flex-col h-full">
            {/* ── Header ─────────────────────────────────────────────────────── */}
            <div className="border-b border-border/80 bg-background/80 backdrop-blur">
                <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
                    <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-brand/30 via-brand/10 to-transparent flex items-center justify-center border border-brand/20">
                        <HugeiconsIcon icon={Image01Icon} size={22} className="text-brand" />
                    </div>
                    <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Generative Studio</p>
                        <h1 className="text-lg font-semibold tracking-tight">Generate</h1>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 flex items-center justify-center">
                <div className="text-center max-w-sm animate-in fade-in duration-500">
                    <div className="w-16 h-16 bg-muted/50 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                        <HugeiconsIcon icon={Image01Icon} size={32} className="text-muted-foreground/50" />
                    </div>
                    <h2 className="text-xl font-semibold mb-2 tracking-tight">No generation modes available</h2>
                    <p className="text-muted-foreground text-sm">Generation tools for this studio are currently unavailable.</p>
                </div>
            </div>
        </div>
    );
}
