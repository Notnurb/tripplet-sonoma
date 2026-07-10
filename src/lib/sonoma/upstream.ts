// Streaming client for the primary (OpenAI-compatible) model backends used by
// the Sonoma tool loop. Parses SSE deltas into content / thinking / tool-call
// events; tool-call argument fragments are accumulated per index and emitted
// once the stream completes.

import { randomUUID } from 'crypto';
import type { BackendTarget } from '@/lib/ai/llm';
import type { SonomaPage } from './prompt';

export interface OpenAIStreamDelta {
    role?: string;
    content?: string | null;
    reasoning_content?: string | null;
    reasoning?: string | null;
    tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
    }>;
}

export interface OpenAIStreamChunk {
    choices?: Array<{
        index?: number;
        delta?: OpenAIStreamDelta;
        finish_reason?: string | null;
    }>;
}

export type UpstreamEvent =
    | { type: 'content'; delta: string }
    | { type: 'thinking'; delta: string }
    | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> };

export async function* streamOnce(
    history: Array<Record<string, unknown>>,
    reason: boolean,
    page: SonomaPage = 'chat',
    target: BackendTarget,
    toolset: readonly unknown[],
): AsyncGenerator<UpstreamEvent> {
    // Code workspace runs cooler (less random) for code correctness.
    const temperature = page === 'code' ? 0.3 : 0.7;
    // Code workspace needs headroom for both the <think> block AND the full
    // answer. Default upstream cap is ~4k tokens which truncates real builds.
    const maxTokens = page === 'code' ? 8192 : undefined;

    const body: Record<string, unknown> = {
        model: target.model,
        stream: true,
        temperature,
        messages: history,
        tools: toolset,
        tool_choice: 'auto',
    };
    if (typeof maxTokens === 'number') body.max_tokens = maxTokens;
    // NOTE: `reasoning_effort` is intentionally NOT sent — the current backends
    // don't support it (it's an OpenAI reasoning-model parameter). Equivalent
    // "think hard" behavior comes from the explicit <think>...</think>
    // chain-of-thought protocol in the system prompt, parsed by the think
    // splitter and streamed as `thinking` events to the UI's thinking pane.
    void reason;

    const res = await fetch(target.url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${target.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(110_000),
    });
    if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        // The upstream detail stays server-side: provider slugs and raw error
        // bodies routinely name real model ids, which must never reach the
        // client (the error message below is streamed into the chat).
        console.error(`[sonoma] ${target.provider} error ${res.status}: ${errText.slice(0, 400)}`);
        throw new Error(`The model backend returned an error (${res.status}). Please try again.`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    type ToolAccum = { id: string; name: string; argText: string };
    const tools = new Map<number, ToolAccum>();

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            let parsed: OpenAIStreamChunk;
            try {
                parsed = JSON.parse(payload);
            } catch {
                continue;
            }
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            const reasoning = delta.reasoning_content ?? delta.reasoning;
            if (typeof reasoning === 'string' && reasoning) {
                yield { type: 'thinking', delta: reasoning };
            }
            if (typeof delta.content === 'string' && delta.content) {
                yield { type: 'content', delta: delta.content };
            }
            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    const acc = tools.get(idx) ?? { id: '', name: '', argText: '' };
                    if (tc.id) acc.id = tc.id;
                    if (tc.function?.name) acc.name = tc.function.name;
                    if (tc.function?.arguments) acc.argText += tc.function.arguments;
                    tools.set(idx, acc);
                }
            }
        }
    }

    for (const acc of tools.values()) {
        if (!acc.name) continue;
        let parsedArgs: Record<string, unknown> = {};
        try {
            parsedArgs = JSON.parse(acc.argText || '{}');
        } catch {
            /* leave empty */
        }
        yield {
            type: 'tool_call',
            id: acc.id || `tc_${randomUUID().slice(0, 8)}`,
            name: acc.name,
            args: parsedArgs,
        };
    }
}
