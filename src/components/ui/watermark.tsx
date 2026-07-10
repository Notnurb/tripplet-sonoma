'use client';

import { cn } from '@/lib/utils';

interface WatermarkProps {
    className?: string;
}

// Text content for watermark
export const WATERMARK_TEXT = "Tripplet";

export function Watermark({ className }: WatermarkProps) {
    return (
        <div
            className={cn(
                "absolute top-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none select-none opacity-30",
                className
            )}
        >
            <span className="text-[10px] font-medium text-white/80 font-mono tracking-wider drop-shadow-sm">
                {WATERMARK_TEXT}
            </span>
        </div>
    );
}
