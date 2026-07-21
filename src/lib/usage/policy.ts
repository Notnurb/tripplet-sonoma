// Usage-limit policy shared by the server metering (src/lib/usage/tracker.ts)
// and the Settings usage panel. Pure functions only — this module must stay
// importable from client components, so no Prisma/env/server imports.

export type PlanId = 'free' | 'go' | 'builder' | 'plus' | 'max';

export interface PlanLimits {
    /** Messages allowed per 5-hour window. */
    fiveHour: number;
    /** Messages allowed per 7-day window. Always much higher than 5h × replenishment. */
    weekly: number;
}

export const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Message budgets per plan. Everyone resolves to 'free' today (see
// getUserPlan in tracker.ts) — the paid tiers are the ready-made policy for
// when billing lands. Weekly is deliberately NOT 5h-limit × windows-per-week:
// it's a second, looser ceiling that stops sustained round-the-clock draining
// while never bothering a normal heavy user.
export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
    free: { fiveHour: 25, weekly: 250 },
    go: { fiveHour: 100, weekly: 1200 },
    builder: { fiveHour: 250, weekly: 3000 },
    plus: { fiveHour: 500, weekly: 6000 },
    max: { fiveHour: 1000, weekly: 12000 },
};

export interface UsageWindow {
    start: Date;
    resetsAt: Date;
}

/**
 * Fixed, epoch-anchored windows: every user's window boundaries fall at the
 * same UTC instants (…, 10:00, 15:00, 20:00, … for 5h), so "when does it
 * reset" is answerable without storing any per-user window state — the next
 * boundary IS the reset time.
 */
export function windowFor(nowMs: number, sizeMs: number): UsageWindow {
    const startMs = Math.floor(nowMs / sizeMs) * sizeMs;
    return { start: new Date(startMs), resetsAt: new Date(startMs + sizeMs) };
}

export type UsageLevel = 'ok' | 'warn' | 'critical';

/** Bar color band: <50% ok (green), 50–80% warn (yellow), ≥80% critical (red). */
export function usageLevel(percent: number): UsageLevel {
    if (percent >= 80) return 'critical';
    if (percent >= 50) return 'warn';
    return 'ok';
}

/** 0–100 integer percentage of the budget consumed. */
export function usagePercent(used: number, limit: number): number {
    if (limit <= 0) return 100;
    return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

/** Human countdown: "less than a minute", "12m", "2h 5m", "3d 4h". */
export function describeTimeUntil(ms: number): string {
    if (ms < 60_000) return 'less than a minute';
    const totalMinutes = Math.floor(ms / 60_000);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    return `${minutes}m`;
}

/** Rough token estimate from character count (~4 chars/token). */
export function estimateTokens(chars: number): number {
    return Math.max(1, Math.ceil(chars / 4));
}
