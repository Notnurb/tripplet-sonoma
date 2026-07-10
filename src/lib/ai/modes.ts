/**
 * Mode configuration — defines how each persistent toggle changes AI behavior.
 * No model swap needed: just system prompt, temperature, and token limits.
 */

import { ChatMode } from '@/types';

// ─── Mode Definitions ─────────────────────────────────────────────────────────

export interface ModeConfig {
    id: ChatMode;
    label: string;
    description: string;
    emoji: string;
    temperature: number;
    maxTokens?: number;        // undefined = use model default
    enableWebSearch: boolean;
    shimmerLabels: string[];
}

export const MODE_CONFIGS: Record<ChatMode, ModeConfig> = {
    think: {
        id: 'think',
        label: 'Think',
        description: 'Deeper reasoning. Step-by-step logic. Structured answers.',
        emoji: '🧠',
        temperature: 0.3,
        enableWebSearch: false,
        shimmerLabels: [
            'Reasoning step by step...',
            'Structuring logic...',
            'Analyzing edge cases...',
            'Building structured answer...',
        ],
    },
    'deep-research': {
        id: 'deep-research',
        label: 'Deep Research',
        description: 'Long-form, thorough analysis. Multiple angles.',
        emoji: '🔬',
        temperature: 0.5,
        maxTokens: 8192,
        enableWebSearch: false,
        shimmerLabels: [
            'Researching in depth...',
            'Exploring multiple angles...',
            'Cross-referencing sources...',
            'Synthesizing analysis...',
        ],
    },
    'web-search': {
        id: 'web-search',
        label: 'Web Search',
        description: 'Live info. Current events. Up-to-date facts.',
        emoji: '🌐',
        temperature: 0.7,
        enableWebSearch: true,
        shimmerLabels: [
            'Searching the web...',
            'Fetching live results...',
            'Analyzing sources...',
            'Compiling findings...',
        ],
    },
    study: {
        id: 'study',
        label: 'Study & Learn',
        description: 'Tutor mode. Breaks things down. Helps you understand.',
        emoji: '📚',
        temperature: 0.4,
        enableWebSearch: false,
        shimmerLabels: [
            'Preparing lesson...',
            'Breaking down concepts...',
            'Crafting examples...',
            'Building understanding...',
        ],
    },
    code: {
        id: 'code',
        label: 'Code',
        description: 'Code generation, debugging, and explanations.',
        emoji: '💻',
        temperature: 0.2,
        enableWebSearch: false,
        shimmerLabels: [
            'Writing code...',
            'Debugging logic...',
            'Analyzing structure...',
            'Optimizing solution...',
        ],
    },
    creative: {
        id: 'creative',
        label: 'Creative',
        description: 'Stories, poetry, brainstorming. Unleash imagination.',
        emoji: '✨',
        temperature: 0.9,
        enableWebSearch: false,
        shimmerLabels: [
            'Sparking ideas...',
            'Crafting narrative...',
            'Exploring possibilities...',
            'Weaving words...',
        ],
    },
    summarize: {
        id: 'summarize',
        label: 'Summarize',
        description: 'Condense anything. Get the key points fast.',
        emoji: '📋',
        temperature: 0.3,
        maxTokens: 1024,
        enableWebSearch: false,
        shimmerLabels: [
            'Extracting key points...',
            'Condensing content...',
            'Distilling essentials...',
            'Trimming the fat...',
        ],
    },
    eli5: {
        id: 'eli5',
        label: 'ELI5',
        description: 'Explain Like I\'m 5. Super simple explanations.',
        emoji: '🧒',
        temperature: 0.5,
        enableWebSearch: false,
        shimmerLabels: [
            'Simplifying...',
            'Finding a good analogy...',
            'Making it click...',
            'Dumbing it down (nicely)...',
        ],
    },
    brainstorm: {
        id: 'brainstorm',
        label: 'Brainstorm',
        description: 'Generate tons of ideas. Quantity over perfection.',
        emoji: '💡',
        temperature: 0.85,
        enableWebSearch: false,
        shimmerLabels: [
            'Generating ideas...',
            'Exploring angles...',
            'Thinking laterally...',
            'Mapping possibilities...',
        ],
    },
    roleplay: {
        id: 'roleplay',
        label: 'Roleplay',
        description: 'Become any character. Act, improvise, stay in persona.',
        emoji: '🎭',
        temperature: 0.85,
        enableWebSearch: false,
        shimmerLabels: [
            'Getting into character...',
            'Setting the scene...',
            'Improvising...',
            'Living the role...',
        ],
    },
    debate: {
        id: 'debate',
        label: 'Debate',
        description: 'Argue both sides. Devil\'s advocate. Find the truth.',
        emoji: '⚖️',
        temperature: 0.6,
        enableWebSearch: false,
        shimmerLabels: [
            'Building arguments...',
            'Playing devil\'s advocate...',
            'Weighing evidence...',
            'Considering the other side...',
        ],
    },
    translate: {
        id: 'translate',
        label: 'Translate',
        description: 'Translate between any languages. Natural, not robotic.',
        emoji: '🌍',
        temperature: 0.3,
        enableWebSearch: false,
        shimmerLabels: [
            'Translating...',
            'Finding the right words...',
            'Adapting culturally...',
            'Polishing translation...',
        ],
    },
    'fact-check': {
        id: 'fact-check',
        label: 'Fact Check',
        description: 'Verify claims. Spot BS. Show your sources.',
        emoji: '✅',
        temperature: 0.2,
        enableWebSearch: true,
        shimmerLabels: [
            'Verifying claims...',
            'Cross-referencing...',
            'Checking sources...',
            'Separating fact from fiction...',
        ],
    },
    freestyle: {
        id: 'freestyle',
        label: 'Freestyle',
        description: 'No rules. Max freedom. The AI goes off-leash.',
        emoji: '🚀',
        temperature: 0.95,
        enableWebSearch: false,
        shimmerLabels: [
            'Going off-script...',
            'Breaking the mold...',
            'Unleashing...',
            'Full send...',
        ],
    },
};

// ─── Conflict Rules ───────────────────────────────────────────────────────────

/**
 * Modes that cannot be active simultaneously.
 * Each pair is [A, B] meaning enabling A disables B and vice versa.
 */
export const MODE_CONFLICTS: [ChatMode, ChatMode][] = [
    ['deep-research', 'study'],
    ['deep-research', 'summarize'],  // one expands, one condenses
    ['study', 'eli5'],               // both simplify — pick one
    ['summarize', 'brainstorm'],     // one shrinks, one explodes
    ['roleplay', 'fact-check'],      // can't be in character AND fact-checking
    ['freestyle', 'think'],          // freestyle = no structure, think = max structure
    ['freestyle', 'summarize'],      // freestyle goes long, summarize goes short
    ['translate', 'eli5'],           // translate keeps original register, eli5 simplifies
];

/**
 * Given current active modes and a mode being toggled ON,
 * returns the new set of active modes with conflicts resolved.
 */
export function toggleMode(current: ChatMode[], mode: ChatMode): ChatMode[] {
    // If already active, turn it off
    if (current.includes(mode)) {
        return current.filter((m) => m !== mode);
    }

    // Find modes that conflict with the one being turned on
    const conflicting = MODE_CONFLICTS
        .filter(([a, b]) => a === mode || b === mode)
        .map(([a, b]) => (a === mode ? b : a));

    // Remove conflicting modes, then add the new one
    const cleaned = current.filter((m) => !conflicting.includes(m));
    return [...cleaned, mode];
}

// ─── Resolve combined settings ────────────────────────────────────────────────

export interface ResolvedModeSettings {
    temperature: number;
    maxTokens?: number;
    enableWebSearch: boolean;
}

// ─── Auto-Skill Detection ────────────────────────────────────────────────────

const SKILL_PATTERNS: { pattern: RegExp; mode: ChatMode }[] = [
    { pattern: /\b(write.*code|debug|fix.*bug|function|class|component|api|endpoint|typescript|python|javascript|rust|golang|sql|regex|refactor)\b/i, mode: 'code' },
    { pattern: /\b(story|poem|creative|imagine|fiction|character|narrative|lyrics|song|haiku|limerick|fairy tale)\b/i, mode: 'creative' },
    { pattern: /\b(summarize|summary|tldr|tl;dr|condense|shorten|key points|main points|brief|recap)\b/i, mode: 'summarize' },
    { pattern: /\b(explain.*simply|eli5|simple terms|dumb it down|for a kid|for a beginner|what even is|what the heck)\b/i, mode: 'eli5' },
    { pattern: /\b(brainstorm|ideas? for|come up with|think of|suggest.*ideas?|what could|possibilities|options for|ways to)\b/i, mode: 'brainstorm' },
    { pattern: /\b(pretend|roleplay|act as|you are a|be a|character|persona|impersonate|in character)\b/i, mode: 'roleplay' },
    { pattern: /\b(debate|pros? and cons?|argue|devil.?s advocate|both sides|for and against|counterargument)\b/i, mode: 'debate' },
    { pattern: /\b(translate|translat|in spanish|in french|in german|in japanese|in chinese|in korean|in arabic|in portuguese|in hindi|en espa[nñ]ol|auf deutsch)\b/i, mode: 'translate' },
    { pattern: /\b(fact.?check|is it true|is this true|verify|myth|actually true|real or fake|accurate|debunk)\b/i, mode: 'fact-check' },
    { pattern: /\b(search|latest|current|recent|price|news|today|2024|2025|2026|weather|stock|score)\b/i, mode: 'web-search' },
    { pattern: /\b(step by step|think through|reason|logic|analyze|break.*down|how does.*work)\b/i, mode: 'think' },
    { pattern: /\b(research|in depth|exhaustive|comprehensive|thorough|deep dive|everything about)\b/i, mode: 'deep-research' },
];

/**
 * Detect which skills should be activated based on message content.
 * Returns detected modes with conflicts resolved against any existing active modes.
 */
export function detectSkillsFromMessage(content: string, existingModes: ChatMode[] = []): ChatMode[] {
    if (content.length < 8) return [];
    const detected: ChatMode[] = [];
    for (const { pattern, mode } of SKILL_PATTERNS) {
        if (pattern.test(content) && !existingModes.includes(mode)) {
            detected.push(mode);
        }
    }
    // Merge with existing, respecting conflicts (max 3 auto-detected to avoid noise)
    let merged = [...existingModes];
    for (const mode of detected.slice(0, 3)) {
        merged = toggleMode(merged, mode);
    }
    return merged;
}

/**
 * Merge all active modes into a single temperature / maxTokens / webSearch config.
 * Uses the lowest temperature & highest maxTokens among active modes.
 */
export function resolveSettings(activeModes: ChatMode[]): ResolvedModeSettings {
    if (activeModes.length === 0) {
        return { temperature: 0.7, enableWebSearch: false };
    }

    const configs = activeModes.map((m) => MODE_CONFIGS[m]);

    return {
        temperature: Math.min(...configs.map((c) => c.temperature)),
        maxTokens: configs.reduce<number | undefined>((max, c) => {
            if (!c.maxTokens) return max;
            if (!max) return c.maxTokens;
            return Math.max(max, c.maxTokens);
        }, undefined),
        enableWebSearch: configs.some((c) => c.enableWebSearch),
    };
}
