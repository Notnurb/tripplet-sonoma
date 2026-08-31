// Inference for Tripplet Computer.
//
// Same proxy shape as /api/v1/chat/completions, but authenticated by install
// signature rather than a developer API key — the desktop app has no key for a
// user to paste. Persona ids go up, real upstream model names stay here.

import { NextRequest, NextResponse } from 'next/server';
import { attestComputer } from '@/lib/computer/attest';
import { resolveBackend } from '@/lib/ai/llm';
import { chatLimiter } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Requests per install per hour. */
const RATE_LIMIT = 400;
const MAX_BODY_BYTES = 1_000_000;
const UPSTREAM_TIMEOUT_MS = 280_000;

/** Desktop persona ids → the ids resolveBackend() knows. */
const PERSONAS: Record<string, string> = {
    'suzhou-4': 'suzhou4',
    'majuli-4': 'majuli4',
    'taipei-4': 'taipei4',
    'astro-5.1': 'astro-5',
};

const PASSTHROUGH = [
    'messages', 'tools', 'tool_choice', 'temperature', 'top_p',
    'max_tokens', 'stop', 'presence_penalty', 'frequency_penalty', 'seed',
] as const;

function error(message: string, status: number, code?: string) {
    return NextResponse.json({ error: { message, type: 'invalid_request_error', code } }, { status });
}

export async function POST(request: NextRequest) {
    // The signature covers the body hash, so it must be read as raw text
    // before anything parses it.
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return error('Request body is too large.', 413);

    const attested = await attestComputer(request, raw);
    if ('response' in attested) return attested.response;
    const { install } = attested;

    try {
        await chatLimiter.check(RATE_LIMIT, `computer:${install.id}`);
    } catch {
        return error('Rate limit exceeded for this install.', 429, 'rate_limit_exceeded');
    }

    let body: Record<string, unknown>;
    try {
        body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return error('Invalid JSON body.', 400);
    }

    const requested = typeof body.model === 'string' ? body.model : '';
    const personaId = PERSONAS[requested];
    if (!personaId) return error(`Unsupported model "${requested}".`, 400, 'model_not_found');

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return error('`messages` must be a non-empty array.', 400);
    }

    const target = resolveBackend(personaId);
    if (!target.apiKey) {
        return error(`Inference is not configured for "${requested}".`, 503, 'backend_unconfigured');
    }

    const stream = body.stream !== false;
    const upstreamBody: Record<string, unknown> = { model: target.model, stream };
    for (const field of PASSTHROUGH) {
        if (body[field] !== undefined) upstreamBody[field] = body[field];
    }
    if (Array.isArray(upstreamBody.tools) && upstreamBody.tools.length === 0) {
        delete upstreamBody.tools;
        delete upstreamBody.tool_choice;
    }

    let upstream: Response;
    try {
        upstream = await fetch(target.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.apiKey}` },
            body: JSON.stringify(upstreamBody),
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
    } catch (err) {
        const timedOut = err instanceof Error && err.name === 'TimeoutError';
        return error(timedOut ? 'The model timed out.' : 'Could not reach the model backend.', timedOut ? 504 : 502);
    }

    if (!upstream.ok || !upstream.body) {
        // Never relay the provider's body — it names the upstream vendor.
        const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : 400;
        return error(
            status === 429 ? 'Rate limited by the model backend.' : `The model backend returned ${upstream.status}.`,
            status,
        );
    }

    if (!stream) {
        const json = (await upstream.json().catch(() => null)) as Record<string, unknown> | null;
        if (!json) return error('The model backend returned a malformed response.', 502);
        return NextResponse.json({ ...json, model: requested });
    }

    return new Response(upstream.body, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
}
