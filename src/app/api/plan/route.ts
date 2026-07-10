import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import { parseBody, planSchema } from '@/lib/validation';
import { searchLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

export async function POST(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
        }

        const token = getRateLimitToken(req, userId);
        try {
            await searchLimiter.check(LIMITS.search, token);
        } catch {
            return rateLimitResponse();
        }

        const { error: validationError } = await parseBody(req, planSchema);
        if (validationError) return validationError;

        throw new Error('External AI APIs have been disabled.');
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Plan generation failed';
        // Return a fallback so the UI doesn't break
        return NextResponse.json({
            intro: "Sure! Let me start building that for you...",
            tasks: [],
            error: message,
        });
    }
}
