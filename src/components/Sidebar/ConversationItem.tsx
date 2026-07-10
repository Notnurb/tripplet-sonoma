'use client';

import React, { memo, useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Conversation } from '@/types';
import { HugeiconsIcon } from '@hugeicons/react';
import { Delete02Icon } from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils/format-date';

interface ConversationItemProps {
    conversation: Conversation;
    isActive: boolean;
    index: number;
    onSelect: (conversationId: string) => void;
    onDelete: (conversationId: string) => void;
    onRename: (conversationId: string, newTitle: string) => void;
}

function ConversationItem({
    conversation,
    isActive,
    index,
    onSelect,
    onDelete,
    onRename,
}: ConversationItemProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const handleSelect = useCallback(() => {
        if (!isEditing) onSelect(conversation.id);
    }, [conversation.id, onSelect, isEditing]);

    const handleDelete = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onDelete(conversation.id);
    }, [conversation.id, onDelete]);

    const startEdit = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setDraft(conversation.title || 'New Chat');
        setIsEditing(true);
        setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        }, 30);
    }, [conversation.title]);

    const commitEdit = useCallback(() => {
        setIsEditing(false);
        const trimmed = draft.trim();
        if (trimmed && trimmed !== (conversation.title || 'New Chat')) {
            onRename(conversation.id, trimmed);
        }
    }, [draft, conversation.id, conversation.title, onRename]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') commitEdit();
        if (e.key === 'Escape') setIsEditing(false);
    }, [commitEdit]);

    return (
        <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.15) }}
            whileHover={!isEditing ? { x: 2 } : {}}
            onClick={handleSelect}
            onDoubleClick={startEdit}
            title="Double-click to rename"
            className={cn(
                'group relative flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-200 mb-0.5 select-none',
                isActive
                    ? 'bg-gradient-to-r from-sidebar-accent to-sidebar-accent/80 text-sidebar-foreground shadow-sm'
                    : 'text-sidebar-foreground/55 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground/85 hover:shadow-sm',
            )}
        >
            {/* Active indicator bar */}
            {isActive && (
                <motion.div
                    layoutId="active-bar"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full bg-brand"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
            )}

            {isEditing ? (
                <input
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={handleKeyDown}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 pl-1 bg-transparent text-xs text-sidebar-foreground outline-none border-b border-brand/60 focus:border-brand min-w-0"
                />
            ) : (
                <div className="flex flex-col min-w-0 flex-1 pl-1">
                    <span className="text-xs truncate leading-tight">
                        {conversation.title || 'New Chat'}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50 mt-0.5 leading-none">
                        {formatRelativeTime(conversation.updatedAt)}
                    </span>
                </div>
            )}

            {!isEditing && (
                <motion.button
                    onClick={handleDelete}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.92 }}
                    className={cn(
                        'shrink-0 p-1 rounded-md transition-all duration-200',
                        'opacity-0 group-hover:opacity-100',
                        isActive ? 'opacity-60 hover:opacity-100' : '',
                        'hover:bg-destructive/10 hover:text-destructive',
                    )}
                    aria-label="Delete chat"
                >
                    <HugeiconsIcon icon={Delete02Icon} size={12} />
                </motion.button>
            )}
        </motion.div>
    );
}

function areConversationItemPropsEqual(prev: ConversationItemProps, next: ConversationItemProps) {
    return (
        prev.conversation === next.conversation &&
        prev.isActive === next.isActive &&
        prev.index === next.index &&
        prev.onSelect === next.onSelect &&
        prev.onDelete === next.onDelete &&
        prev.onRename === next.onRename
    );
}

export default memo(ConversationItem, areConversationItemPropsEqual);
