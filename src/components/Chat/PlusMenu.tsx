'use client';

import React, { memo, useCallback, useRef } from 'react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    PlusSignIcon,
    ImageUploadIcon,
    FileUploadIcon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';

interface PlusMenuProps {
    onUploadFile: (file: File) => void;
    onScreenshot: () => void;
}

function PlusMenu({ onUploadFile, onScreenshot }: PlusMenuProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileClick = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onUploadFile(file);
            e.target.value = '';
        }
    }, [onUploadFile]);

    return (
        <>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.txt,.md,.csv,.json"
                className="hidden"
                onChange={handleFileChange}
            />
            <DropdownMenu>
                <DropdownMenuTrigger
                    className={cn(
                        "inline-flex items-center justify-center rounded-full text-sm font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                        "h-9 w-9 shrink-0 hover:bg-accent text-muted-foreground"
                    )}
                >
                    <HugeiconsIcon icon={PlusSignIcon} size={18} />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="start"
                    side="top"
                    className="w-56 p-1.5"
                >
                    <button
                        onClick={(e) => { e.preventDefault(); handleFileClick(); }}
                        className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left hover:bg-accent/80 cursor-pointer transition-all duration-150 outline-none"
                    >
                        <HugeiconsIcon icon={FileUploadIcon} size={18} className="text-muted-foreground" />
                        <span className="text-sm text-foreground">Upload File</span>
                    </button>
                    <button
                        onClick={(e) => { e.preventDefault(); onScreenshot(); }}
                        className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left hover:bg-accent/80 cursor-pointer transition-all duration-150 outline-none"
                    >
                        <HugeiconsIcon icon={ImageUploadIcon} size={18} className="text-muted-foreground" />
                        <span className="text-sm text-foreground">Upload Image</span>
                    </button>
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    );
}

function arePlusMenuPropsEqual(prev: PlusMenuProps, next: PlusMenuProps) {
    return (
        prev.onUploadFile === next.onUploadFile &&
        prev.onScreenshot === next.onScreenshot
    );
}

export default memo(PlusMenu, arePlusMenuPropsEqual);
