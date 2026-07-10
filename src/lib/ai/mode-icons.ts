'use client';

import {
    Brain01Icon,
    MicroscopeIcon,
    Globe02Icon,
    BookOpen01Icon,
    CodeIcon,
    SparklesIcon,
    TextAlignLeft01Icon,
    Happy01Icon,
    Idea01Icon,
    MaskTheater01Icon,
    JusticeScale01Icon,
    LanguageCircleIcon,
    CheckmarkBadge01Icon,
    Rocket01Icon,
    Briefcase01Icon,
    FlashIcon,
    NoteEditIcon,
    BulletIcon,
} from '@hugeicons/core-free-icons';
import type { ChatMode, ToneType } from '@/types';

// ─── Skill Icons ─────────────────────────────────────────────────────────────

export const MODE_ICONS: Record<ChatMode, any> = {
    'think': Brain01Icon,
    'deep-research': MicroscopeIcon,
    'web-search': Globe02Icon,
    'study': BookOpen01Icon,
    'code': CodeIcon,
    'creative': SparklesIcon,
    'summarize': TextAlignLeft01Icon,
    'eli5': Happy01Icon,
    'brainstorm': Idea01Icon,
    'roleplay': MaskTheater01Icon,
    'debate': JusticeScale01Icon,
    'translate': LanguageCircleIcon,
    'fact-check': CheckmarkBadge01Icon,
    'freestyle': Rocket01Icon,
};

// ─── Skill Display Order ─────────────────────────────────────────────────────

export const MODE_ORDER: ChatMode[] = [
    'think', 'deep-research', 'web-search', 'code',
    'creative', 'brainstorm', 'roleplay', 'debate',
    'translate', 'fact-check', 'summarize', 'eli5',
    'study', 'freestyle',
];

// ─── Tone Options ────────────────────────────────────────────────────────────

export const TONE_OPTIONS: { id: ToneType; label: string; icon: any }[] = [
    { id: 'formal', label: 'Formal', icon: Briefcase01Icon },
    { id: 'concise', label: 'Concise', icon: FlashIcon },
    { id: 'detailed', label: 'Detailed', icon: NoteEditIcon },
    { id: 'minimal', label: 'Minimal', icon: BulletIcon },
];
