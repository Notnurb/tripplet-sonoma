// ─── Hivemind agent pool ─────────────────────────────────────────────────────

export interface HivemindAgent {
    id: number;
    label: string;
}

export const AGENT_COUNT = 100;

export const HIVEMIND_AGENTS: HivemindAgent[] = Array.from({ length: AGENT_COUNT }, (_, i) => ({
    id: i + 1,
    label: `Agent #${i + 1}`,
}));

export function getRandomAgent(): HivemindAgent {
    return HIVEMIND_AGENTS[Math.floor(Math.random() * HIVEMIND_AGENTS.length)];
}

// ─── Consent storage ─────────────────────────────────────────────────────────

export const HIVEMIND_CONSENT_KEY = 'hivemind_consented';

export function hasHivemindConsent(): boolean {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(HIVEMIND_CONSENT_KEY) === 'true';
}

export function setHivemindConsent(): void {
    localStorage.setItem(HIVEMIND_CONSENT_KEY, 'true');
}
