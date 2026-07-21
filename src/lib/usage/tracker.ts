// Server-side usage metering backed by the AIUsage table (one row per
// admitted chat request). Consumed by /api/chat, /api/sonoma, and /api/usage.
//
// Failure policy matches the rest of the platform (rate limiter, memory,
// search): a broken database must never take chat down, so every helper here
// fails OPEN — check errors admit the request, record errors are logged and
// swallowed. Only /api/usage surfaces DB errors, since its whole job is to
// report real numbers.

import prisma from '@/lib/db/prisma';
import {
    FIVE_HOUR_MS,
    WEEK_MS,
    PLAN_LIMITS,
    estimateTokens,
    usagePercent,
    windowFor,
    describeTimeUntil,
    type PlanId,
} from './policy';

export interface WindowUsage {
    used: number;
    limit: number;
    remaining: number;
    percent: number;
    /** ISO timestamp of the next window boundary. */
    resetsAt: string;
    /** Rough tokens consumed inside this window (display only). */
    tokens: number;
}

export interface UsageSummary {
    plan: PlanId;
    fiveHour: WindowUsage;
    weekly: WindowUsage;
}

/**
 * Which plan a user is on. There is no billing wiring yet, so every account
 * is on the free plan — this function is the single place to teach the
 * metering about real subscriptions when payments exist.
 */
export async function getUserPlan(_userId: string): Promise<PlanId> {
    return 'free';
}

export async function getUsageSummary(userId: string): Promise<UsageSummary> {
    const now = Date.now();
    const five = windowFor(now, FIVE_HOUR_MS);
    const week = windowFor(now, WEEK_MS);
    const plan = await getUserPlan(userId);
    const limits = PLAN_LIMITS[plan];

    const [fiveAgg, weekAgg] = await Promise.all([
        prisma.aIUsage.aggregate({
            where: { userId, timestamp: { gte: five.start } },
            _count: true,
            _sum: { tokensUsed: true },
        }),
        prisma.aIUsage.aggregate({
            where: { userId, timestamp: { gte: week.start } },
            _count: true,
            _sum: { tokensUsed: true },
        }),
    ]);

    const toWindow = (
        agg: { _count: number; _sum: { tokensUsed: number | null } },
        limit: number,
        resetsAt: Date,
    ): WindowUsage => ({
        used: agg._count,
        limit,
        remaining: Math.max(0, limit - agg._count),
        percent: usagePercent(agg._count, limit),
        resetsAt: resetsAt.toISOString(),
        tokens: agg._sum.tokensUsed ?? 0,
    });

    return {
        plan,
        fiveHour: toWindow(fiveAgg, limits.fiveHour, five.resetsAt),
        weekly: toWindow(weekAgg, limits.weekly, week.resetsAt),
    };
}

export type UsageAllowance =
    | { allowed: true }
    | {
          allowed: false;
          scope: '5-hour' | 'weekly';
          resetsAt: string;
          message: string;
      };

export async function checkUsageAllowance(userId: string): Promise<UsageAllowance> {
    let summary: UsageSummary;
    try {
        summary = await getUsageSummary(userId);
    } catch (e) {
        console.error('[usage] allowance check failed — failing open:', e instanceof Error ? e.message : e);
        return { allowed: true };
    }

    const blocked = (scope: '5-hour' | 'weekly', win: WindowUsage): UsageAllowance => ({
        allowed: false,
        scope,
        resetsAt: win.resetsAt,
        message:
            `You've reached your ${scope} limit of ${win.limit} messages on the ` +
            `${summary.plan} plan. It resets in ${describeTimeUntil(new Date(win.resetsAt).getTime() - Date.now())}.`,
    });

    if (summary.fiveHour.used >= summary.fiveHour.limit) return blocked('5-hour', summary.fiveHour);
    if (summary.weekly.used >= summary.weekly.limit) return blocked('weekly', summary.weekly);
    return { allowed: true };
}

/** 429 for a blocked request. `code` lets clients render a limit state, not an error. */
export function usageLimitResponse(block: Exclude<UsageAllowance, { allowed: true }>): Response {
    return new Response(
        JSON.stringify({
            error: block.message,
            code: 'usage_limit',
            scope: block.scope,
            resetsAt: block.resetsAt,
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
}

/**
 * Count this request against the user's budget, at admit time — before the
 * stream starts — so concurrent requests can't slip under the limit check.
 * Returns the row id for finalizeUsage, or null if recording failed (chat
 * proceeds regardless).
 */
export async function recordUsage(params: {
    userId: string;
    model: string;
    conversationId?: string | null;
    promptChars: number;
}): Promise<string | null> {
    try {
        const row = await prisma.aIUsage.create({
            data: {
                userId: params.userId,
                conversationId: params.conversationId ?? null,
                model: params.model,
                tokensUsed: estimateTokens(params.promptChars),
                estimatedCost: 0,
            },
        });
        return row.id;
    } catch (e) {
        console.error('[usage] record failed:', e instanceof Error ? e.message : e);
        return null;
    }
}

/** Top up the row with the response's token estimate once the stream ends. */
export async function finalizeUsage(recordId: string, responseChars: number): Promise<void> {
    if (responseChars <= 0) return;
    try {
        await prisma.aIUsage.update({
            where: { id: recordId },
            data: { tokensUsed: { increment: estimateTokens(responseChars) } },
        });
    } catch (e) {
        console.error('[usage] finalize failed:', e instanceof Error ? e.message : e);
    }
}
