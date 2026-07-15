// Paid, accountless chat completions — the store's flagship agent surface.
// OpenAI-shaped request/response, two ways to pay, zero cookies or sessions:
//
//   1. PER-CALL:  X-PAYMENT header (x402 exact/evm). No key, no state — each
//      request settles its own USDC micro-payment. Without the header the
//      response is a 402 challenge quoting the exact price for the requested
//      model (or every model when the body doesn't name one).
//   2. PREPAID:   Authorization: Bearer trpl_x4_... (bought at /api/x402/buy).
//      Credits are metered on actual upstream usage; an exhausted key gets a
//      402 whose accepts[] are the top-up packs — the protocol loop closes.
//
// When both are present the Bearer key wins: an agent holding credits must
// never be silently charged on-chain as well.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
    LIMITS,
    getRateLimitToken,
    rateLimitResponse,
    x402ChatLimiter,
} from '@/lib/security/rate-limit';
import {
    PAYMENT_HEADER,
    PAYMENT_RESPONSE_HEADER,
    decodePaymentHeader,
    encodeSettlementHeader,
    paymentRequired,
    validatePaymentAgainstRequirements,
    type PaymentRequirements,
} from '@/lib/x402/types';
import {
    buildCallRequirements,
    buildPackRequirements,
    getStoreConfig,
    type EnabledStoreConfig,
} from '@/lib/x402/config';
import {
    CALLABLE_MODELS,
    CREDIT_PACKS,
    KEY_PREFIX,
    getCallableModel,
    type CallableModel,
} from '@/lib/x402/catalog';
import { facilitatorSettle, facilitatorVerify } from '@/lib/x402/facilitator';
import { authenticatePrepaidKey, chargeKey, looksLikeApiKey } from '@/lib/x402/keys';
import {
    InferenceConfigError,
    InferenceUpstreamError,
    runCompletion,
} from '@/lib/x402/inference';
import { X402_CORS_HEADERS, x402Preflight } from '@/lib/x402/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Input ceilings. Per-call requests pay a flat price, so their prompt size is
// capped tighter; prepaid requests meter actual tokens and get more rope.
const PER_CALL_MAX_INPUT_CHARS = 48_000;
const PREPAID_MAX_INPUT_CHARS = 400_000;
const DEFAULT_MAX_TOKENS = 1_024;

const bodySchema = z.object({
    model: z.string().min(1),
    messages: z
        .array(
            z.object({
                role: z.enum(['system', 'user', 'assistant']),
                content: z.string(),
            }),
        )
        .min(1)
        .max(200),
    max_tokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().optional(),
});

function json(status: number, body: unknown, extra?: Record<string, string>): NextResponse {
    return NextResponse.json(body, {
        status,
        headers: { ...X402_CORS_HEADERS, 'Cache-Control': 'no-store', ...extra },
    });
}

/** 402 quoting per-call prices — for the requested model, or all of them. */
function callChallenge(
    config: EnabledStoreConfig,
    error: string,
    model?: CallableModel,
): NextResponse {
    const accepts = model
        ? [buildCallRequirements(config, model)]
        : CALLABLE_MODELS.map((m) => buildCallRequirements(config, m));
    return json(402, paymentRequired(error, ...accepts));
}

/** 402 whose accepts are the top-up packs — sent when credits run dry. */
function topUpChallenge(config: EnabledStoreConfig, error: string): NextResponse {
    const accepts = CREDIT_PACKS.map((p) => buildPackRequirements(config, p));
    return json(402, {
        ...paymentRequired(error, ...accepts),
        hint: `Pay any accepts[] entry at its resource URL with your key in the X-Tripplet-Key header to top up, or retry this request with an X-PAYMENT header to pay per call.`,
    });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
    const config = getStoreConfig();

    try {
        await x402ChatLimiter.check(LIMITS.x402Chat, `x402chat:${getRateLimitToken(req, null)}`);
    } catch {
        return rateLimitResponse();
    }

    // Parse + validate the OpenAI-shaped body.
    const raw = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return json(400, {
            error: `Invalid request body: ${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'unparseable'}`,
            expected: { model: CALLABLE_MODELS.map((m) => m.id), messages: '[{role, content}]', max_tokens: 'optional', temperature: 'optional' },
        });
    }
    const body = parsed.data;

    if (body.stream) {
        return json(400, { error: 'stream: true is not supported on the paid endpoint yet — omit it for a single JSON response.' });
    }

    const model = getCallableModel(body.model);
    if (!model) {
        return json(400, {
            error: `Unknown model '${body.model}'.`,
            models: CALLABLE_MODELS.map((m) => ({ id: m.id, name: m.name, pricePerCallUsd: m.pricePerCallUsd })),
        });
    }

    const maxTokens = Math.min(body.max_tokens ?? DEFAULT_MAX_TOKENS, model.maxOutputTokens);
    const inputChars = body.messages.reduce((n, m) => n + m.content.length, 0);

    const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
    const paymentHeader = req.headers.get(PAYMENT_HEADER);

    // ── Prepaid path ─────────────────────────────────────────────────────────
    if (bearer && looksLikeApiKey(bearer)) {
        if (inputChars > PREPAID_MAX_INPUT_CHARS) {
            return json(400, { error: `Input too large: ${inputChars} chars (prepaid cap ${PREPAID_MAX_INPUT_CHARS}).` });
        }
        const auth = await authenticatePrepaidKey(bearer);
        if (auth.status === 'db-unavailable') {
            return json(503, { error: 'Key storage unavailable. Retry shortly, or pay per call with an X-PAYMENT header.' });
        }
        if (auth.status === 'unknown') {
            return json(401, { error: `Unknown API key. Buy one at ${config.appUrl}/api/x402/catalog, or pay per call with an X-PAYMENT header.` });
        }
        if (auth.status === 'revoked') {
            return json(403, { error: 'This API key has been revoked.' });
        }
        if (auth.status === 'exhausted') {
            if (!config.enabled) {
                return json(402, { error: 'Key exhausted, and the store cannot sell top-ups right now. Try later.' });
            }
            return topUpChallenge(config, `API key ${auth.row.key_prefix} is out of credits (0 of ${Number(auth.row.credits_granted).toLocaleString()} left).`);
        }

        try {
            const result = await runCompletion({
                personaId: model.id,
                messages: body.messages,
                maxTokens,
                temperature: body.temperature,
            });
            const remaining = await chargeKey(auth.row.id, result.usage.totalTokens);
            return json(200, {
                ...completionEnvelope(model.id, result),
                x402: {
                    mode: 'prepaid',
                    keyPrefix: auth.row.key_prefix,
                    creditsCharged: result.usage.totalTokens,
                    creditsRemaining: remaining !== null ? Number(remaining) : null,
                },
            });
        } catch (e) {
            return inferenceError(e);
        }
    }
    if (bearer && !looksLikeApiKey(bearer)) {
        return json(401, { error: `Authorization must be a ${KEY_PREFIX} prepaid key — or drop it and pay per call with an X-PAYMENT header.` });
    }

    // ── Per-call path ────────────────────────────────────────────────────────
    if (!config.enabled) {
        return json(503, { error: `Paid inference unavailable: ${config.reason}`, enabled: false });
    }
    if (inputChars > PER_CALL_MAX_INPUT_CHARS) {
        return json(400, { error: `Input too large: ${inputChars} chars (per-call cap ${PER_CALL_MAX_INPUT_CHARS}; prepaid keys allow ${PREPAID_MAX_INPUT_CHARS}).` });
    }

    const requirements: PaymentRequirements = buildCallRequirements(config, model);

    if (!paymentHeader) {
        return callChallenge(config, `${PAYMENT_HEADER} header is required (or use a prepaid trpl_x4_ key)`, model);
    }
    const decoded = decodePaymentHeader(paymentHeader);
    if (!decoded.ok) {
        return json(400, paymentRequired(`Malformed ${PAYMENT_HEADER} header: ${decoded.error}`, requirements));
    }
    const rejection = validatePaymentAgainstRequirements(decoded.payload, requirements, Math.floor(Date.now() / 1000));
    if (rejection) {
        return json(402, paymentRequired(rejection, requirements));
    }

    // Per-call replay protection is the chain itself: EIP-3009 consumes the
    // nonce at settlement, so the same header can never settle twice. No DB.
    let verify;
    try {
        verify = await facilitatorVerify(config, decoded.payload, requirements);
    } catch {
        return json(503, { error: 'Payment verification is temporarily unavailable. Retry with the same X-PAYMENT header.', retryable: true });
    }
    if (!verify.isValid) {
        return json(402, paymentRequired(`Payment verification failed: ${verify.invalidReason ?? 'invalid payment'}`, requirements));
    }

    let settlement;
    try {
        settlement = await facilitatorSettle(config, decoded.payload, requirements);
    } catch {
        // Unknown outcome on a micro-payment: refuse to serve (would risk free
        // inference), tell the agent to retry — an unsettled authorization
        // stays spendable, a settled one gets rejected by verify next round.
        return json(503, { error: 'Settlement did not complete. Retry with the same X-PAYMENT header; it can settle at most once.', retryable: true });
    }
    if (!settlement.success) {
        return json(402, paymentRequired(`Settlement failed: ${settlement.errorReason ?? 'unknown reason'}`, requirements));
    }

    const settlementHeader = { [PAYMENT_RESPONSE_HEADER]: encodeSettlementHeader(settlement) };
    try {
        const result = await runCompletion({
            personaId: model.id,
            messages: body.messages,
            maxTokens,
            temperature: body.temperature,
        });
        return json(200, {
            ...completionEnvelope(model.id, result),
            x402: {
                mode: 'per-call',
                paidUsd: model.pricePerCallUsd,
                transaction: settlement.transaction ?? null,
                explorerUrl: settlement.transaction ? `${config.network.explorerTx}${settlement.transaction}` : null,
                network: config.network.id,
                testnet: config.network.testnet,
            },
        }, settlementHeader);
    } catch (e) {
        // Payment settled but inference failed — the loss is bounded by one
        // micro-payment. Return the settlement proof with the error so the
        // agent can account for it.
        console.error(`[x402] CRITICAL: per-call payment settled (tx ${settlement.transaction ?? 'unknown'}) but inference failed`);
        const res = inferenceError(e);
        Object.entries(settlementHeader).forEach(([k, v]) => res.headers.set(k, v));
        return res;
    }
}

function completionEnvelope(personaId: string, result: { content: string; finishReason: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }) {
    return {
        id: `chatcmpl-x402-${crypto.randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: personaId,
        choices: [
            {
                index: 0,
                message: { role: 'assistant', content: result.content },
                finish_reason: result.finishReason,
            },
        ],
        usage: {
            prompt_tokens: result.usage.promptTokens,
            completion_tokens: result.usage.completionTokens,
            total_tokens: result.usage.totalTokens,
        },
    };
}

function inferenceError(e: unknown): NextResponse {
    if (e instanceof InferenceConfigError) return json(503, { error: e.message });
    if (e instanceof InferenceUpstreamError) return json(502, { error: e.message });
    console.error('[x402] unexpected inference error:', e instanceof Error ? e.message : e);
    return json(502, { error: 'The model backend failed unexpectedly. Try again shortly.' });
}

/** GET = the machine-readable "how do I pay for this" card (also a 402). */
export function GET(): NextResponse {
    const config = getStoreConfig();
    if (!config.enabled) {
        return json(503, { error: `Paid inference unavailable: ${config.reason}`, enabled: false });
    }
    return callChallenge(config, `POST an OpenAI-style body here with an ${PAYMENT_HEADER} header (per-call) or an Authorization: Bearer ${KEY_PREFIX}... prepaid key. Prices below are per call, by model.`);
}

export function OPTIONS(): Response {
    return x402Preflight();
}
