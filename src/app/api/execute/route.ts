// Real Python execution endpoint. Previously this asked an LLM to *pretend*
// to be an interpreter; it now runs actual CPython via Pyodide in a
// timeout-guarded worker thread (src/lib/python/run.ts).

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import { parseBody, executeSchema } from '@/lib/validation';
import { runPython } from '@/lib/python/run';
import { chatLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
        }

        const token = getRateLimitToken(req, userId);
        try {
            await chatLimiter.check(LIMITS.chat, token);
        } catch {
            return rateLimitResponse();
        }

        const { data, error: validationError } = await parseBody(req, executeSchema);
        if (validationError) return validationError;
        const { code, stdin } = data;

        const result = await runPython(code, stdin);
        return NextResponse.json({ output: result.output, exitCode: result.exitCode, timedOut: result.timedOut ?? false });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Execution failed';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
