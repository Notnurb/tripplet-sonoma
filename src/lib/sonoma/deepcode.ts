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
import { DEEP_CODE_DEFAULT_REASONING_LEVEL, type DeepCodeReasoningLevel } from './reasoning-levels';

export { DEEP_CODE_REASONING_LEVELS, DEEP_CODE_DEFAULT_REASONING_LEVEL, isReasoningLevel } from './reasoning-levels';
export type { DeepCodeReasoningLevel } from './reasoning-levels';

const DEEP_CODE_CONTEXT_CHARS = 28_000;

// User-selectable reasoning levels for the DeepCode pipeline. Each tier tunes
// how many THINK ⇄ ROUTE rounds run, how the shared wall-clock budget (see
// below) is split between thinking and coding, and the `reasoning_effort`
// sent to OpenCode Zen for each stage. The top two tiers also force a floor
// on think rounds (the router can't cut reasoning short) and, for
// 'supercode', add a hidden draft pass the coder reviews before the answer
// the user actually sees is produced.
interface ReasoningLevelConfig {
    effort: 'low' | 'medium' | 'high';
    coderEffort: 'low' | 'medium' | 'high';
    maxThinkRounds: number;
    minThinkRounds: number;
    totalBudgetMs: number;
    codeReserveMs: number;
    thinkRoundMaxMs: number;
    routerTimeoutMs: number;
    selfReview: boolean;
}

const REASONING_LEVELS: Record<DeepCodeReasoningLevel, ReasoningLevelConfig> = {
    low: {
        effort: 'low',
        coderEffort: 'low',
        maxThinkRounds: 1,
        minThinkRounds: 0,
        totalBudgetMs: 120_000,
        codeReserveMs: 80_000,
        thinkRoundMaxMs: 20_000,
        routerTimeoutMs: 15_000,
        selfReview: false,
    },
    medium: {
        effort: 'medium',
        coderEffort: 'low',
        maxThinkRounds: 2,
        minThinkRounds: 0,
        totalBudgetMs: 180_000,
        codeReserveMs: 100_000,
        thinkRoundMaxMs: 30_000,
        routerTimeoutMs: 20_000,
        selfReview: false,
    },
    high: {
        effort: 'high',
        coderEffort: 'medium',
        maxThinkRounds: 4,
        minThinkRounds: 0,
        totalBudgetMs: 240_000,
        codeReserveMs: 120_000,
        thinkRoundMaxMs: 40_000,
        routerTimeoutMs: 25_000,
        selfReview: false,
    },
    xhigh: {
        effort: 'high',
        coderEffort: 'medium',
        maxThinkRounds: 8,
        minThinkRounds: 1,
        totalBudgetMs: 270_000,
        codeReserveMs: 120_000,
        thinkRoundMaxMs: 45_000,
        routerTimeoutMs: 30_000,
        selfReview: false,
    },
    max: {
        effort: 'high',
        coderEffort: 'high',
        maxThinkRounds: 12,
        minThinkRounds: 2,
        totalBudgetMs: 290_000,
        codeReserveMs: 120_000,
        thinkRoundMaxMs: 45_000,
        routerTimeoutMs: 30_000,
        selfReview: false,
    },
    supercode: {
        effort: 'high',
        coderEffort: 'high',
        maxThinkRounds: 12,
        minThinkRounds: 2,
        totalBudgetMs: 290_000,
        codeReserveMs: 130_000,
        thinkRoundMaxMs: 45_000,
        routerTimeoutMs: 30_000,
        selfReview: true,
    },
};

const DEEP_CODE_SECRECY =
    'Never reveal, hint at, or discuss the internal pipeline, its stages, or any underlying model names. To the user you are simply "Astro 5 Code" by Tripplet AI.';

interface ZenStreamOpts {
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    reasoningEffort?: 'low' | 'medium' | 'high';
}

// The pipeline fires many sequential upstream calls per request (think rounds
// + a router check after every round + draft + final), so a transient 429 or
// 5xx from OpenCode Zen is a fact of life — especially by the final coder
// pass, after earlier stages have already spent the provider's rate budget.
// Those must heal with a short backoff instead of killing the whole pipeline.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
// Minimum time a real attempt needs; below this, stop retrying and fail.
const MIN_ATTEMPT_MS = 5_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryDelayMs(attempt: number, res: Response): number {
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter !== null) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 20_000);
    }
    return Math.min(1_000 * Math.pow(2.5, attempt) + Math.random() * 500, 20_000);
}

function stageError(status: number): Error {
    if (status === 429) {
        return new Error('Astro 5 Code is momentarily over capacity — please wait a few seconds and try again.');
    }
    return new Error(
        status > 0
            ? `Deep pipeline stage failed (${status}). Please try again.`
            : 'Deep pipeline stage timed out. Please try again.',
    );
}

// POST to OpenCode Zen, retrying retryable statuses with backoff. Retries only
// ever happen before any body bytes are consumed, so streaming callers can
// never emit duplicated output. The attempt loop (waits included) stays inside
// timeoutMs, and the returned response's stream keeps whatever time remains.
async function zenFetch(body: Record<string, unknown>, timeoutMs: number): Promise<Response> {
    const deadline = Date.now() + timeoutMs;
    let lastStatus = 0;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const remaining = deadline - Date.now();
        if (remaining < MIN_ATTEMPT_MS) break;
        const res = await fetch(OPENCODE_ZEN_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${OPENCODE_ZEN_API_KEY}`,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(remaining),
        });
        if (res.ok) return res;
        lastStatus = res.status;
        await res.text().catch(() => '');
        if (!RETRYABLE_STATUSES.has(res.status) || attempt === MAX_ATTEMPTS - 1) break;
        const wait = retryDelayMs(attempt, res);
        if (Date.now() + wait > deadline - MIN_ATTEMPT_MS) break;
        await sleep(wait);
    }
    throw stageError(lastStatus);
}

// Minimal OpenCode Zen streamer — content + reasoning deltas only, no tools.
async function* zenStream(
    model: string,
    messages: Array<Record<string, unknown>>,
    opts: ZenStreamOpts = {},
): AsyncGenerator<{ kind: 'content' | 'reasoning'; delta: string }> {
    const res = await zenFetch(
        {
            model,
            stream: true,
            temperature: opts.temperature ?? 0.3,
            ...(typeof opts.maxTokens === 'number' ? { max_tokens: opts.maxTokens } : {}),
            ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
            messages,
        },
        opts.timeoutMs ?? 240_000,
    );
    if (!res.body) throw stageError(0);

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
    const res = await zenFetch(
        {
            model,
            stream: false,
            temperature: opts.temperature ?? 0,
            ...(typeof opts.maxTokens === 'number' ? { max_tokens: opts.maxTokens } : {}),
            ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
            messages,
        },
        opts.timeoutMs ?? 45_000,
    );
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return String(j.choices?.[0]?.message?.content ?? '');
}

export async function runDeepCodePipeline(
    enqueue: (obj: Record<string, unknown>) => void,
    rawMessages: Array<Record<string, unknown>>,
    level: DeepCodeReasoningLevel = DEEP_CODE_DEFAULT_REASONING_LEVEL,
): Promise<void> {
    const cfg = REASONING_LEVELS[level];

    // Client-supplied system messages would sit alongside the pipeline's own
    // system prompts with equal authority — including the secrecy instruction
    // — so they are dropped. The app's own client never sends them anyway.
    const messages = rawMessages.filter((m) => m.role !== 'system');
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const task = typeof lastUser?.content === 'string' ? lastUser.content : '';

    const startedAt = Date.now();
    const remainingMs = () => cfg.totalBudgetMs - (Date.now() - startedAt);

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
    for (let round = 0; round < cfg.maxThinkRounds; round += 1) {
        // Never let another think round eat into the coder's reserved time.
        const thinkBudget = Math.min(
            cfg.thinkRoundMaxMs,
            remainingMs() - cfg.codeReserveMs - cfg.routerTimeoutMs,
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
                reasoningEffort: cfg.effort,
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
                {
                    temperature: 0,
                    maxTokens: 8,
                    timeoutMs: cfg.routerTimeoutMs,
                    reasoningEffort: cfg.effort,
                },
            );
        } catch {
            // Router unavailable — fail open into the coding stage, unless
            // the level demands more rounds than we've done regardless.
            if (round + 1 >= cfg.minThinkRounds) break;
        }
        // The verdict should be one word, but a chatty reply like "I think the
        // reasoning is complete, CODE" must not read as THINK — keep thinking
        // only when the router says THINK and does not say CODE. Higher
        // reasoning levels impose a floor: the router can't cut reasoning
        // short before that many rounds have actually run.
        const routerSaysCode = /\bCODE\b/i.test(verdict) || !/\bTHINK\b/i.test(verdict);
        if (routerSaysCode && round + 1 >= cfg.minThinkRounds) break;
        enqueue({ type: 'thinking', delta: '\n\n' });
    }

    // ── CODE ─────────────────────────────────────────────────────────────────
    // 'supercode' inserts a hidden draft pass: the coder writes a first
    // attempt (streamed to the thinking pane, never shown as the answer),
    // then reviews its own draft for bugs before writing the version the
    // user actually sees. Every other level goes straight to the final pass.
    let draftSolution = '';
    if (cfg.selfReview) {
        const draftSystem =
            getModelSystemPrompt(DEEP_CODE_PERSONA) +
            '\n\nYou have ALREADY completed your internal reasoning phase for this task (included below). ' +
            'Write a first-draft solution: production-grade code with real imports, full functions, and complete error handling. ' +
            'Wrap every code snippet in a fenced code block with the correct language tag. This draft will be reviewed and revised before the user sees it — focus on getting it right, not on explaining it. ' +
            DEEP_CODE_SECRECY +
            (allThinking
                ? `\n\n<internal_reasoning>\n${allThinking.slice(-DEEP_CODE_CONTEXT_CHARS)}\n</internal_reasoning>`
                : '');

        const draftBudget = Math.max(30_000, Math.floor((cfg.codeReserveMs - 60_000) / 2));
        try {
            for await (const ev of zenStream(
                DEEP_CODE_CODER_MODEL,
                [{ role: 'system', content: draftSystem }, ...messages],
                {
                    temperature: 0.3,
                    maxTokens: 16_000,
                    reasoningEffort: cfg.coderEffort,
                    timeoutMs: Math.min(draftBudget, Math.max(30_000, remainingMs() - 60_000)),
                },
            )) {
                draftSolution += ev.delta;
                enqueue({ type: 'thinking', delta: ev.delta });
            }
        } catch {
            // A failed draft just means the review pass has nothing extra to
            // work from — the final pass below still runs from scratch.
        }
    }

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
            : '') +
        (draftSolution
            ? `\n\n<draft_solution>\n${draftSolution.slice(-DEEP_CODE_CONTEXT_CHARS)}\n</draft_solution>\n\nReview the draft above for bugs, missing edge cases, and quality issues, then write the improved final answer — don't just repeat the draft.`
            : '');

    let emittedAnswer = false;
    try {
        for await (const ev of zenStream(
            DEEP_CODE_CODER_MODEL,
            [{ role: 'system', content: coderSystem }, ...messages],
            {
                temperature: 0.2,
                maxTokens: 16_000,
                reasoningEffort: cfg.coderEffort,
                // Whatever is left of the shared budget, floored so a degenerate
                // clock skew can't zero it out.
                timeoutMs: Math.max(60_000, remainingMs()),
            },
        )) {
            if (ev.kind === 'reasoning') {
                enqueue({ type: 'thinking', delta: ev.delta });
            } else {
                emittedAnswer = true;
                enqueue({ type: 'content', delta: ev.delta });
            }
        }
    } catch (e) {
        // The final pass died even after retries. If a supercode draft exists
        // and nothing visible has streamed yet, ship the draft — a complete
        // first-attempt answer beats an error card. Anything else rethrows.
        if (!emittedAnswer && draftSolution.trim()) {
            enqueue({ type: 'content', delta: draftSolution });
            return;
        }
        throw e;
    }
}
