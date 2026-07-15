// Upstream bridge for the paid inference endpoint. Resolves a public persona
// id to its OpenAI-compatible backend via src/lib/ai/llm.ts and runs ONE
// non-streaming completion.
//
// SANITIZATION CONTRACT: real upstream model names, URLs, and error bodies
// must never reach the caller — responses and errors carry only the public
// persona id. (Same rule the sonoma pipeline follows; see llm.ts header.)

import { envVarFor, resolveBackend } from '@/lib/ai/llm';

export interface CompletionRequest {
    personaId: string;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    maxTokens: number;
    temperature?: number;
}

export interface CompletionResult {
    content: string;
    finishReason: string;
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/** Thrown when the deployment has no key for the persona's provider. */
export class InferenceConfigError extends Error {
    constructor(personaId: string, envVar: string) {
        super(`Model '${personaId}' is not available on this deployment (missing ${envVar}).`);
        this.name = 'InferenceConfigError';
    }
}

/** Thrown on upstream failures — message is already caller-safe. */
export class InferenceUpstreamError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InferenceUpstreamError';
    }
}

const UPSTREAM_TIMEOUT_MS = 120_000;

// ~4 chars/token — the same estimator the rest of the platform uses; only a
// fallback for upstreams that omit usage.
function estimateTokens(text: string): number {
    return text ? Math.ceil(text.length / 4) : 0;
}

export async function runCompletion(req: CompletionRequest): Promise<CompletionResult> {
    const backend = resolveBackend(req.personaId);
    if (!backend.apiKey) {
        throw new InferenceConfigError(req.personaId, envVarFor(backend.provider));
    }

    let res: Response;
    try {
        res = await fetch(backend.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${backend.apiKey}`,
            },
            body: JSON.stringify({
                model: backend.model,
                messages: req.messages,
                max_tokens: req.maxTokens,
                ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
                stream: false,
            }),
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
            cache: 'no-store',
        });
    } catch (e) {
        console.error(`[x402] upstream fetch failed for persona ${req.personaId}:`, e instanceof Error ? e.message : e);
        throw new InferenceUpstreamError('The model backend did not respond. Try again shortly.');
    }

    if (!res.ok) {
        // Upstream error bodies can name real models — log them, never return them.
        const detail = await res.text().catch(() => '');
        console.error(`[x402] upstream HTTP ${res.status} for persona ${req.personaId}: ${detail.slice(0, 300)}`);
        throw new InferenceUpstreamError(`The model backend rejected the request (HTTP ${res.status}). Try again shortly.`);
    }

    let json: {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    try {
        json = (await res.json()) as typeof json;
    } catch {
        throw new InferenceUpstreamError('The model backend returned an unreadable response.');
    }

    const choice = json.choices?.[0];
    const content = choice?.message?.content ?? '';
    const promptTokens =
        json.usage?.prompt_tokens ?? estimateTokens(req.messages.map((m) => m.content).join('\n'));
    const completionTokens = json.usage?.completion_tokens ?? estimateTokens(content);

    return {
        content,
        finishReason: choice?.finish_reason ?? 'stop',
        usage: {
            promptTokens,
            completionTokens,
            totalTokens: json.usage?.total_tokens ?? promptTokens + completionTokens,
        },
    };
}
