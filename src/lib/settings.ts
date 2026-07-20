// ─── Settings store ─────────────────────────────────────────────────────────
// Simple localStorage-based store with custom events for cross-component sync.

export type SidebarWidth = 'narrow' | 'default' | 'wide';
export type MessageDensity = 'comfortable' | 'compact';
export type CodeTheme = 'dark' | 'light' | 'github' | 'monokai';

import type { AutoSkillSetting } from '@/types';

export interface AppSettings {
    theme: string;
    sidebarWidth: SidebarWidth;
    messageDensity: MessageDensity;
    sendOnEnter: boolean;
    showTimestamps: boolean;
    soundEffects: boolean;
    reduceMotion: boolean;
    codeTheme: CodeTheme;
    autoTitle: boolean;
    trainTriplepediaModels: boolean;
    autoSkills: AutoSkillSetting;
    legacyModels: boolean;
    // Tripplet Sandboxed Linux — lets the assistant boot a real in-browser
    // Linux VM and run bash in it via the run_bash skill. Disable to remove
    // the skill entirely.
    sandboxedLinux: boolean;
    // Memory skill — Tripplet learns durable facts about you from your chats
    // (extracted autonomously in the background) and personalizes answers.
    memorySkill: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
    theme: 'white',
    sidebarWidth: 'default',
    messageDensity: 'comfortable',
    sendOnEnter: true,
    showTimestamps: false,
    soundEffects: false,
    reduceMotion: false,
    codeTheme: 'dark',
    autoTitle: true,
    trainTriplepediaModels: true,
    autoSkills: 'off',
    legacyModels: false,
    sandboxedLinux: true,
    memorySkill: true,
};

const KEY = 'tripplet_app_settings_v2';
export const SETTINGS_EVENT = 'tripplet_settings_changed';

// ─── Light themes ─────────────────────────────────────────────────────────────
const LIGHT_THEMES = new Set(['light', 'arctic', 'rose', 'brown', 'white']);

export function loadSettings(): AppSettings {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS;
    try {
        const stored = localStorage.getItem(KEY);
        return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
    } catch {
        return DEFAULT_SETTINGS;
    }
}

export function saveSettings(settings: AppSettings): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(settings));
        window.dispatchEvent(new Event(SETTINGS_EVENT));
    } catch {}
}

export function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): AppSettings {
    const next = { ...loadSettings(), [key]: value };
    saveSettings(next);
    return next;
}

// ─── Sidebar width map ────────────────────────────────────────────────────────
export const SIDEBAR_WIDTHS: Record<SidebarWidth, number> = {
    narrow: 210,
    default: 260,
    wide: 320,
};

// ─── Apply all settings to the DOM ───────────────────────────────────────────
export function applySettings(settings: AppSettings): void {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;

    // 1. Theme data-attribute (drives all CSS variable overrides)
    html.setAttribute('data-theme', settings.theme);

    // 2. Dark/light class — needed for Tailwind dark: utilities
    if (LIGHT_THEMES.has(settings.theme)) {
        html.classList.remove('dark');
    } else {
        html.classList.add('dark');
    }

    // 3. Sidebar width CSS variable
    html.style.setProperty('--app-sidebar-w', `${SIDEBAR_WIDTHS[settings.sidebarWidth]}px`);

    // 4. Message density data-attribute
    html.setAttribute('data-density', settings.messageDensity);

    // 5. Reduced motion
    if (settings.reduceMotion) {
        html.classList.add('motion-reduce');
    } else {
        html.classList.remove('motion-reduce');
    }
}
