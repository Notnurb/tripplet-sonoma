'use client';

import { getCategoryMeta } from '@/lib/triplepedia/constants';

interface CategoryBadgeProps {
    category: string | null | undefined;
    size?: 'sm' | 'md';
}

export default function CategoryBadge({ category, size = 'sm' }: CategoryBadgeProps) {
    const meta = getCategoryMeta(category);
    if (!meta) return null;

    const sizeClasses = size === 'sm'
        ? 'px-2 py-0.5 text-[11px]'
        : 'px-3 py-1 text-xs';

    return (
        <span
            className={`inline-flex items-center gap-1 rounded-full border font-medium leading-none ${sizeClasses} ${meta.color}`}
        >
            <span>{meta.emoji}</span>
            <span>{meta.label}</span>
        </span>
    );
}
