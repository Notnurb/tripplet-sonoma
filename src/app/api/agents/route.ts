import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import { backendFetch } from '@/lib/backend';
import { chatLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';

// POST /api/agents — proxy to Python backend for multi-AI collaboration
export async function POST(request: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
    const limitToken = getRateLimitToken(request, userId);
    try {
        await chatLimiter.check(LIMITS.chat, limitToken);
    } catch {
        return rateLimitResponse();
    }
    try {
        const body = await request.json();
        const { query, num_agents, conversation_history, stream = false } = body;
        if (typeof query !== 'string' || !query.trim()) {
            return NextResponse.json({ error: 'query is required' }, { status: 400 });
        }
        if (query.length > 8000) {
            return NextResponse.json({ error: 'query too long' }, { status: 400 });
        }

        const endpoint = stream ? '/agents/collaborate/stream' : '/agents/collaborate';

        const resp = await backendFetch(endpoint, {
            method: 'POST',
            body: JSON.stringify({ query, num_agents, conversation_history }),
            signal: AbortSignal.timeout(120_000),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Backend error' }));
            return NextResponse.json(err, { status: resp.status });
        }

        // If streaming, proxy the SSE stream
        if (stream && resp.body) {
            return new Response(resp.body, {
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                },
            });
        }

        const data = await resp.json();
        return NextResponse.json(data);
    } catch (error: unknown) {
        console.error('Agents proxy error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Agent service unavailable' },
            { status: 502 }
        );
    }
}

// GET /api/agents — get agent roster
export async function GET() {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
    try {
        const resp = await backendFetch('/agents/roster');
        if (!resp.ok) {
            return NextResponse.json({ error: 'Backend error' }, { status: resp.status });
        }
        const data = await resp.json();
        return NextResponse.json(data);
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Agent service unavailable';
        return NextResponse.json({ error: msg }, { status: 502 });
    }
}
