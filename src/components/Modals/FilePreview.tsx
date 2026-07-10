'use client';

import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, File01Icon, Image01Icon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Attachment } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';

interface FilePreviewProps {
    files: Attachment[];
    onRemove: (id: string) => void;
}

export default function FilePreview({ files, onRemove }: FilePreviewProps) {
    if (files.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
            <AnimatePresence>
                {files.map((file) => (
                    <motion.div
                        key={file.id}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="flex items-center gap-2 bg-muted/50 border border-border/50 rounded-md px-2 py-1.5 text-xs max-w-[200px]"
                    >
                        {file.type === 'image' ? (
                            <HugeiconsIcon icon={Image01Icon} size={14} className="text-muted-foreground" />
                        ) : (
                            <HugeiconsIcon icon={File01Icon} size={14} className="text-orange-500" />
                        )}
                        <span className="truncate flex-1">{file.name}</span>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-4 w-4 rounded-full hover:bg-background/80"
                            onClick={() => onRemove(file.id)}
                        >
                            <HugeiconsIcon icon={Cancel01Icon} size={12} />
                            <span className="sr-only">Remove</span>
                        </Button>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}
