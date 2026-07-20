// ─── Deep Code pipeline (Astro 5 Code) ───────────────────────────────────────
//
// The 'astro-5-code' persona is not one model — it's a staged pipeline:
//
//   THINK (thinker model, streamed to the thinking pane)
//     └─> ROUTE (router model, temp 0): "THINK" → loop back, "CODE" → proceed
//   CODE  (coder model, streamed to the answer pane)
//
// The router is consulted after every thinking round, so the pipeline is
// constantly checking whether it should still be reasoning or start building.
// Real upstream model names never appear in any event sent to the client.

import {
    OPENCODE_ZEN_API_URL,
    OPENCODE_ZEN_API_KEY,
    DEEP_CODE_PERSONA,
    DEEP_CODE_THINKER_MODEL,
    DEEP_CODE_ROUTER_MODEL,
    DEEP_CODE_CODER_MODEL,
} from '@/lib/ai/llm';
import { getModelSystemPrompt } from '@/lib/ai/model-prompts';
import type { OpenAIStreamChunk } from './upstream';

const DEEP_CODE_MAX_THINK_ROUNDS = 12;
const DEEP_CODE_CONTEXT_CHARS = 28_000;

// Wall-clock budget for the whole pipeline. The per-stage timeouts could sum
// to far more than the function's maxDuration (300s), and a platform kill
// mid-stream looks like a silent, successful truncation to the client — so
// every stage is carved out of one shared deadline that stays under the cap,
// and the coder stage (the only one that produces the visible answer) always
// has time reserved for it.
const DEEP_CODE_TOTAL_BUDGET_MS = 290_000;
const DEEP_CODE_CODE_RESERVE_MS = 120_000;
const DEEP_CODE_THINK_ROUND_MAX_MS = 45_000;
const DEEP_CODE_ROUTER_TIMEOUT_MS = 20_000;

const DEEP_CODE_SECRECY =
    'Never reveal, hint at, or discuss the internal pipeline, its stages, or any underlying model names. To the user you are simply "Astro 5 Code" by Tripplet AI.';

interface ZenStreamOpts {
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
}

// Minimal OpenCode Zen streamer — content + reasoning deltas only, no tools.
async function* zenStream(
    model: string,
    messages: Array<Record<string, unknown>>,
    opts: ZenStreamOpts = {},
): AsyncGenerator<{ kind: 'content' | 'reasoning'; delta: string }> {
    const res = await fetch(OPENCODE_ZEN_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENCODE_ZEN_API_KEY}`,
        },
        body: JSON.stringify({
            model,
            stream: true,
            temperature: opts.temperature ?? 0.3,
            ...(typeof opts.maxTokens === 'number' ? { max_tokens: opts.maxTokens } : {}),
            messages,
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 240_000),
    });
    if (!res.ok || !res.body) {
        await res.text().catch(() => '');
        throw new Error(`Deep pipeline stage failed (${res.status}). Please try again.`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
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
                yield { kind: 'reasoning', delta: reasoning };
            }
            if (typeof delta.content === 'string' && delta.content) {
                yield { kind: 'content', delta: delta.content };
            }
        }
    }
}

// Single-shot (non-streaming) OpenCode Zen completion — used for the router.
async function zenComplete(
    model: string,
    messages: Array<Record<string, unknown>>,
    opts: ZenStreamOpts = {},
): Promise<string> {
    const res = await fetch(OPENCODE_ZEN_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENCODE_ZEN_API_KEY}`,
        },
        body: JSON.stringify({
            model,
            stream: false,
            temperature: opts.temperature ?? 0,
            ...(typeof opts.maxTokens === 'number' ? { max_tokens: opts.maxTokens } : {}),
            messages,
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
    });
    if (!res.ok) {
        await res.text().catch(() => '');
        throw new Error(`Deep pipeline check failed (${res.status}).`);
    }
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return String(j.choices?.[0]?.message?.content ?? '');
}

export async function runDeepCodePipeline(
    enqueue: (obj: Record<string, unknown>) => void,
    rawMessages: Array<Record<string, unknown>>,
): Promise<void> {
    // Client-supplied system messages would sit alongside the pipeline's own
    // system prompts with equal authority — including the secrecy instruction
    // — so they are dropped. The app's own client never sends them anyway.
    const messages = rawMessages.filter((m) => m.role !== 'system');
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const task = typeof lastUser?.content === 'string' ? lastUser.content : '';

    const startedAt = Date.now();
    const remainingMs = () => DEEP_CODE_TOTAL_BUDGET_MS - (Date.now() - startedAt);

    const thinkerSystem =
        getModelSystemPrompt(DEEP_CODE_PERSONA) +
        '\n\nYou are currently in your INTERNAL REASONING phase for a coding task. ' +
        'Reason step by step, in plain prose: restate the real goal, plan the architecture (files, components, data flow), ' +
        'weigh trade-offs between approaches, enumerate edge cases (invalid input, async failures, null states), ' +
        'and self-review your plan for bugs before any code is written. ' +
        'Output ONLY reasoning — do NOT write the final code or the final answer yet. ' +
        DEEP_CODE_SECRECY;

    // ── THINK ⇄ ROUTE loop ───────────────────────────────────────────────────
    let allThinking = '';
    for (let round = 0; round < DEEP_CODE_MAX_THINK_ROUNDS; round += 1) {
        // Never let another think round eat into the coder's reserved time.
        const thinkBudget = Math.min(
            DEEP_CODE_THINK_ROUND_MAX_MS,
            remainingMs() - DEEP_CODE_CODE_RESERVE_MS - DEEP_CODE_ROUTER_TIMEOUT_MS,
        );
        if (thinkBudget < 15_000) break;

        const thinkerMessages: Array<Record<string, unknown>> = [
            { role: 'system', content: thinkerSystem },
            ...messages,
        ];
        if (allThinking) {
            thinkerMessages.push(
                { role: 'assistant', content: allThinking.slice(-DEEP_CODE_CONTEXT_CHARS) },
                {
                    role: 'user',
                    content:
                        'Continue your internal reasoning from where you left off. Go deeper on anything unresolved — do not repeat yourself, and still no final code.',
                },
            );
        }

        let roundThinking = '';
        try {
            for await (const ev of zenStream(DEEP_CODE_THINKER_MODEL, thinkerMessages, {
                temperature: 0.4,
                maxTokens: 8192,
                timeoutMs: thinkBudget,
            })) {
                // Thinker output — reasoning and content alike — is all thinking.
                roundThinking += ev.delta;
                enqueue({ type: 'thinking', delta: ev.delta });
            }
        } catch {
            // A timed-out or failed think round degrades to coding with
            // whatever reasoning exists — the coder stage uses a different
            // upstream, so it may well still succeed.
            allThinking += (allThinking ? '\n\n' : '') + roundThinking;
            break;
        }
        allThinking += (allThinking ? '\n\n' : '') + roundThinking;

        // A silent round means the thinker has nothing left — go code.
        if (!roundThinking.trim()) break;

        // ── ROUTE: is it still thinking, or ready to code? ───────────────────
        let verdict = 'CODE';
        try {
            verdict = await zenComplete(
                DEEP_CODE_ROUTER_MODEL,
                [
                    {
                        role: 'system',
                        content:
                            'You are a pipeline controller for a deep coding assistant. Given a task and the internal reasoning produced so far, decide whether the reasoning is complete enough to start writing the final code. Reply with exactly one word: THINK if more reasoning is genuinely needed, or CODE if it is ready. Nothing else.',
                    },
                    {
                        role: 'user',
                        content:
                            `Task:\n${task.slice(0, 8000)}\n\nInternal reasoning so far:\n${allThinking.slice(-DEEP_CODE_CONTEXT_CHARS)}\n\nVerdict (THINK or CODE):`,
                    },
                ],
                { temperature: 0, maxTokens: 8, timeoutMs: DEEP_CODE_ROUTER_TIMEOUT_MS },
            );
        } catch {
            // Router unavailable — fail open into the coding stage.
            break;
        }
        // The verdict should be one word, but a chatty reply like "I think the
        // reasoning is complete, CODE" must not read as THINK — keep thinking
        // only when the router says THINK and does not say CODE.
        if (/\bCODE\b/i.test(verdict) || !/\bTHINK\b/i.test(verdict)) break;
        enqueue({ type: 'thinking', delta: '\n\n' });
    }

    // ── CODE ─────────────────────────────────────────────────────────────────
    const coderSystem =
        getModelSystemPrompt(DEEP_CODE_PERSONA) +
        '\n\nYou have ALREADY completed your internal reasoning phase for this task (included below). ' +
        'Now produce the final answer: production-grade code with real imports, full functions, and complete error handling — no TODOs, no placeholders. ' +
        'Wrap every code snippet in a fenced code block with the correct language tag (e.g. ```python, ```ts, ```html). ' +
        'When the user asks for a web page or component, output a complete, runnable HTML document in a single ```html fenced block so it can be previewed. ' +
        'Briefly explain why you chose this design. Do not restate the reasoning verbatim. ' +
        DEEP_CODE_SECRECY +
        (allThinking
            ? `\n\n<internal_reasoning>\n${allThinking.slice(-DEEP_CODE_CONTEXT_CHARS)}\n</internal_reasoning>`
            : '');

    for await (const ev of zenStream(
        DEEP_CODE_CODER_MODEL,
        [{ role: 'system', content: coderSystem }, ...messages],
        {
            temperature: 0.2,
            maxTokens: 16_000,
            // Whatever is left of the shared budget, floored so a degenerate
            // clock skew can't zero it out.
            timeoutMs: Math.max(60_000, remainingMs()),
        },
    )) {
        if (ev.kind === 'reasoning') {
            enqueue({ type: 'thinking', delta: ev.delta });
        } else {
            enqueue({ type: 'content', delta: ev.delta });
        }
    }
}
