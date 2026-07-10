// ─── Triplepedia v0.2 constants ─────────────────────────────────────────────

// ─── Categories ─────────────────────────────────────────────────────────────

export const TRIPLEPEDIA_CATEGORIES = [
    { id: 'science',    label: 'Science',    emoji: '\u{1F52C}', color: 'bg-blue-500/15 text-blue-400 border-blue-500/20' },
    { id: 'technology', label: 'Technology', emoji: '\u{1F4BB}', color: 'bg-purple-500/15 text-purple-400 border-purple-500/20' },
    { id: 'history',    label: 'History',    emoji: '\u{1F4DC}', color: 'bg-amber-500/15 text-amber-400 border-amber-500/20' },
    { id: 'geography',  label: 'Geography',  emoji: '\u{1F30D}', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
    { id: 'arts',       label: 'Arts',       emoji: '\u{1F3A8}', color: 'bg-pink-500/15 text-pink-400 border-pink-500/20' },
    { id: 'sports',     label: 'Sports',     emoji: '\u26BD',    color: 'bg-orange-500/15 text-orange-400 border-orange-500/20' },
    { id: 'nature',     label: 'Nature',     emoji: '\u{1F33F}', color: 'bg-green-500/15 text-green-400 border-green-500/20' },
    { id: 'space',      label: 'Space',      emoji: '\u{1F680}', color: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20' },
    { id: 'people',     label: 'People',     emoji: '\u{1F464}', color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20' },
    { id: 'culture',    label: 'Culture',    emoji: '\u{1F3AD}', color: 'bg-rose-500/15 text-rose-400 border-rose-500/20' },
] as const;

export type TriplepediaCategory = (typeof TRIPLEPEDIA_CATEGORIES)[number]['id'];

export function getCategoryMeta(id: string | null | undefined) {
    return TRIPLEPEDIA_CATEGORIES.find((c) => c.id === id) ?? null;
}

// ─── Reactions ──────────────────────────────────────────────────────────────

export const REACTIONS = [
    { id: 'mind_blown', emoji: '\u{1F92F}', label: 'Mind Blown' },
    { id: 'til',        emoji: '\u{1F4A1}', label: 'TIL' },
    { id: 'want_more',  emoji: '\u{1F924}', label: 'Want More' },
    { id: 'funny',      emoji: '\u{1F602}', label: 'Funny' },
] as const;

export type ReactionType = (typeof REACTIONS)[number]['id'];

// ─── Streak milestones ──────────────────────────────────────────────────────

export const STREAK_MILESTONES = [
    { days: 3,   title: 'Curious Cat' },
    { days: 7,   title: 'Wiki Wizard' },
    { days: 14,  title: 'Fact Fanatic' },
    { days: 30,  title: 'Knowledge Goblin' },
    { days: 60,  title: 'Encyclopedia Brain' },
    { days: 100, title: 'Brain Overlord' },
    { days: 365, title: 'Triplepedia Legend' },
] as const;

export function getStreakTitle(days: number): string {
    let title = 'Newbie';
    for (const m of STREAK_MILESTONES) {
        if (days >= m.days) title = m.title;
    }
    return title;
}

export function getNextMilestone(days: number) {
    return STREAK_MILESTONES.find((m) => m.days > days) ?? null;
}

// ─── Reading time ───────────────────────────────────────────────────────────

interface SectionLike {
    content?: string;
    subheadings?: Array<{ content: string }>;
}

export function estimateReadingTime(sections: SectionLike[]): number {
    let wordCount = 0;
    for (const s of sections) {
        if (s.content) wordCount += s.content.split(/\s+/).length;
        for (const sub of s.subheadings ?? []) {
            wordCount += sub.content.split(/\s+/).length;
        }
    }
    return Math.max(1, Math.ceil(wordCount / 200));
}
