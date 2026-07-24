// Live usage numbers for the Settings usage panel: real counts from the
// AIUsage table for the current 5-hour and weekly windows, plus reset times.

import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth/session';
import { resolveBearerUser } from '@/lib/mcp/bearer';
import { getUsageSummary } from '@/lib/usage/tracker';
import { usageLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
    // Browser sessions authenticate by cookie; the Astrocode CLI holds an MCP
    // OAuth access token instead. Same numbers either way — /usage in the CLI
    // must agree with the Settings panel.
    const cookieUser = await auth();
    const userId = cookieUser.userId ?? (await resolveBearerUser(request))?.userId ?? null;
    if (!userId) {
        return new Response(JSON.stringify({ error: 'Sign in to view usage.' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        await usageLimiter.check(LIMITS.usage, getRateLimitToken(request, userId));
    } catch {
        return rateLimitResponse();
    }

    try {
        const summary = await getUsageSummary(userId);
        return new Response(JSON.stringify(summary), {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
    } catch (e) {
        console.error('[usage] summary failed:', e instanceof Error ? e.message : e);
        return new Response(JSON.stringify({ error: 'Could not load usage right now.' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
