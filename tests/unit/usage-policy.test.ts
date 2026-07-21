import { describe, it, expect } from 'vitest';
import {
    FIVE_HOUR_MS,
    WEEK_MS,
    PLAN_LIMITS,
    windowFor,
    usageLevel,
    usagePercent,
    describeTimeUntil,
    estimateTokens,
    type PlanId,
} from '@/lib/usage/policy';

describe('PLAN_LIMITS integrity', () => {
    it('every plan has positive limits and weekly is much higher than 5-hour', () => {
        for (const [plan, limits] of Object.entries(PLAN_LIMITS)) {
            expect(limits.fiveHour, `${plan} fiveHour`).toBeGreaterThan(0);
            expect(limits.weekly, `${plan} weekly`).toBeGreaterThan(limits.fiveHour * 2);
        }
    });

    it('free is the lowest tier', () => {
        const others: PlanId[] = ['go', 'builder', 'plus', 'max'];
        for (const plan of others) {
            expect(PLAN_LIMITS[plan].fiveHour).toBeGreaterThan(PLAN_LIMITS.free.fiveHour);
            expect(PLAN_LIMITS[plan].weekly).toBeGreaterThan(PLAN_LIMITS.free.weekly);
        }
    });
});

describe('windowFor', () => {
    it('produces epoch-aligned windows of exactly the requested size', () => {
        const now = Date.UTC(2026, 6, 20, 13, 37, 42);
        for (const size of [FIVE_HOUR_MS, WEEK_MS]) {
            const win = windowFor(now, size);
            expect(win.start.getTime() % size).toBe(0);
            expect(win.resetsAt.getTime() - win.start.getTime()).toBe(size);
            expect(win.start.getTime()).toBeLessThanOrEqual(now);
            expect(win.resetsAt.getTime()).toBeGreaterThan(now);
        }
    });

    it('a timestamp exactly on a boundary starts a fresh window', () => {
        const boundary = FIVE_HOUR_MS * 100_000;
        const win = windowFor(boundary, FIVE_HOUR_MS);
        expect(win.start.getTime()).toBe(boundary);
        expect(win.resetsAt.getTime()).toBe(boundary + FIVE_HOUR_MS);
    });

    it('two timestamps inside the same window agree on the reset time', () => {
        const now = Date.UTC(2026, 6, 20, 13, 0, 0);
        const a = windowFor(now, FIVE_HOUR_MS);
        const b = windowFor(now + 60_000, FIVE_HOUR_MS);
        expect(a.resetsAt.getTime()).toBe(b.resetsAt.getTime());
    });
});

describe('usageLevel color bands', () => {
    it('is ok below 50%, warn at 50–79%, critical at 80%+', () => {
        expect(usageLevel(0)).toBe('ok');
        expect(usageLevel(49)).toBe('ok');
        expect(usageLevel(50)).toBe('warn');
        expect(usageLevel(79)).toBe('warn');
        expect(usageLevel(80)).toBe('critical');
        expect(usageLevel(100)).toBe('critical');
    });
});

describe('usagePercent', () => {
    it('clamps to 0–100 and rounds', () => {
        expect(usagePercent(0, 25)).toBe(0);
        expect(usagePercent(12, 25)).toBe(48);
        expect(usagePercent(25, 25)).toBe(100);
        expect(usagePercent(30, 25)).toBe(100);
        expect(usagePercent(1, 0)).toBe(100);
    });
});

describe('describeTimeUntil', () => {
    it('formats minutes, hours, and days', () => {
        expect(describeTimeUntil(30_000)).toBe('less than a minute');
        expect(describeTimeUntil(12 * 60_000)).toBe('12m');
        expect(describeTimeUntil(2 * 3_600_000 + 5 * 60_000)).toBe('2h 5m');
        expect(describeTimeUntil(3 * 3_600_000)).toBe('3h');
        expect(describeTimeUntil(3 * 86_400_000 + 4 * 3_600_000)).toBe('3d 4h');
        expect(describeTimeUntil(2 * 86_400_000)).toBe('2d');
    });
});

describe('estimateTokens', () => {
    it('estimates ~4 chars per token and never returns zero', () => {
        expect(estimateTokens(0)).toBe(1);
        expect(estimateTokens(4)).toBe(1);
        expect(estimateTokens(400)).toBe(100);
        expect(estimateTokens(401)).toBe(101);
    });
});
