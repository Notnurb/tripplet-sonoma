// x402 v1 wire types — the `exact` scheme on EVM networks (EIP-3009 USDC
// transfers). Shapes follow the official protocol spec (coinbase/x402,
// x402-specification-v1 + transports-v1/http) exactly, so any standard x402
// client — x402-fetch, x402-axios, the Python httpx hooks, agent payment
// SDKs — can pay us with zero custom code.
//
// This module is CLIENT-SAFE and isomorphic (no Node-only imports): the store
// page uses the same types + header codecs the server enforces. Pure protocol
// logic only — config, catalog, and persistence live in their own modules.

import { z } from 'zod';

export const X402_VERSION = 1;

// HTTP transport headers. Both carry base64-encoded JSON per the spec.
export const PAYMENT_HEADER = 'X-PAYMENT';
export const PAYMENT_RESPONSE_HEADER = 'X-PAYMENT-RESPONSE';

// Hard cap on the X-PAYMENT header we are willing to decode. A legitimate
// exact/evm payload is well under 1 KB; anything bigger is garbage or abuse.
const MAX_PAYMENT_HEADER_CHARS = 8_192;

// Seconds of settlement headroom we require before `validBefore` — if the
// authorization expires sooner than this, on-chain settlement can miss the
// window and strand the payment. Matches the reference implementation.
export const SETTLE_BUFFER_SECONDS = 6;

const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'not a 0x address');
const uintString = z.string().regex(/^\d+$/, 'not an unsigned integer string');
const bytes32Hex = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'not 32 bytes of hex');
// 65-byte ECDSA signatures are the norm; ERC-1271/6492 smart-wallet signatures
// are longer, so only a minimum length is enforced — facilitators do the real
// cryptographic verification.
const signatureHex = z.string().regex(/^0x[0-9a-fA-F]{130,}$/, 'not a signature');

// ─── PaymentRequirements (what a 402 offers) ─────────────────────────────────

export const paymentRequirementsSchema = z.object({
    scheme: z.literal('exact'),
    network: z.string().min(1),
    /** Price in the asset's base units (USDC: 6 decimals), as a decimal string. */
    maxAmountRequired: uintString,
    resource: z.string().min(1),
    description: z.string(),
    mimeType: z.string(),
    payTo: evmAddress,
    maxTimeoutSeconds: z.number().int().positive(),
    asset: evmAddress,
    outputSchema: z.record(z.string(), z.unknown()).optional(),
    /** EIP-712 domain hints for the asset: { name, version }. */
    extra: z.object({ name: z.string(), version: z.string() }).optional(),
});
export type PaymentRequirements = z.infer<typeof paymentRequirementsSchema>;

/** Body of every 402 response (and of payment-failure re-challenges). */
export interface PaymentRequiredBody {
    x402Version: typeof X402_VERSION;
    error: string;
    accepts: PaymentRequirements[];
}

export function paymentRequired(error: string, ...requirements: PaymentRequirements[]): PaymentRequiredBody {
    return { x402Version: X402_VERSION, error, accepts: requirements };
}

// ─── PaymentPayload (what the X-PAYMENT header carries) ──────────────────────

export const exactEvmAuthorizationSchema = z.object({
    from: evmAddress,
    to: evmAddress,
    value: uintString,
    validAfter: uintString,
    validBefore: uintString,
    nonce: bytes32Hex,
});
export type ExactEvmAuthorization = z.infer<typeof exactEvmAuthorizationSchema>;

export const paymentPayloadSchema = z.object({
    x402Version: z.literal(X402_VERSION),
    scheme: z.literal('exact'),
    network: z.string().min(1),
    payload: z.object({
        signature: signatureHex,
        authorization: exactEvmAuthorizationSchema,
    }),
});
export type PaymentPayload = z.infer<typeof paymentPayloadSchema>;

// ─── Facilitator + settlement wire shapes ────────────────────────────────────

export interface FacilitatorVerifyResponse {
    isValid: boolean;
    invalidReason?: string;
    payer?: string;
}

/** Also the payload of the X-PAYMENT-RESPONSE header. */
export interface SettlementResponse {
    success: boolean;
    errorReason?: string;
    transaction?: string;
    network?: string;
    payer?: string;
}

// ─── Header codecs (isomorphic base64 of UTF-8 JSON) ─────────────────────────

function toBase64(text: string): string {
    if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}

function fromBase64(b64: string): string {
    if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('utf8');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

export function encodePaymentHeader(payload: PaymentPayload): string {
    return toBase64(JSON.stringify(payload));
}

export function encodeSettlementHeader(settlement: SettlementResponse): string {
    return toBase64(JSON.stringify(settlement));
}

export type DecodedPayment =
    | { ok: true; payload: PaymentPayload }
    | { ok: false; error: string };

export function decodePaymentHeader(header: string): DecodedPayment {
    if (header.length > MAX_PAYMENT_HEADER_CHARS) {
        return { ok: false, error: `header exceeds ${MAX_PAYMENT_HEADER_CHARS} characters` };
    }
    let json: unknown;
    try {
        json = JSON.parse(fromBase64(header.trim()));
    } catch {
        return { ok: false, error: 'not base64-encoded JSON' };
    }
    const parsed = paymentPayloadSchema.safeParse(json);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const path = issue?.path.join('.') || 'payload';
        return { ok: false, error: `invalid PaymentPayload: ${path}: ${issue?.message ?? 'unparseable'}` };
    }
    return { ok: true, payload: parsed.data };
}

// ─── Local validation (cheap checks before any DB or facilitator work) ───────

/**
 * Validate a decoded payment against the requirements we issued. Pure and
 * deterministic (`nowSec` injected) so it is unit-testable and usable by the
 * client for pre-flight checks. Returns a human/agent-readable rejection
 * reason, or null when the payment matches.
 *
 * The facilitator re-checks all of this plus the signature and balance; these
 * local checks exist to reject cheap garbage before we spend facilitator
 * round-trips (or DB rows) on it.
 */
export function validatePaymentAgainstRequirements(
    payment: PaymentPayload,
    requirements: PaymentRequirements,
    nowSec: number,
): string | null {
    if (payment.scheme !== requirements.scheme) {
        return `scheme mismatch: got '${payment.scheme}', this resource requires '${requirements.scheme}'`;
    }
    if (payment.network !== requirements.network) {
        return `network mismatch: got '${payment.network}', this resource requires '${requirements.network}'`;
    }
    const auth = payment.payload.authorization;
    if (auth.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
        return `authorization.to must be the payTo address ${requirements.payTo}`;
    }
    let value: bigint;
    try {
        value = BigInt(auth.value);
    } catch {
        return 'authorization.value is not a valid integer';
    }
    // The `exact` scheme settles the full signed value, so anything above the
    // price would overcharge the payer — require the exact amount.
    if (value !== BigInt(requirements.maxAmountRequired)) {
        return `authorization.value must be exactly ${requirements.maxAmountRequired} (asset base units)`;
    }
    const validAfter = Number(auth.validAfter);
    const validBefore = Number(auth.validBefore);
    if (!Number.isFinite(validAfter) || !Number.isFinite(validBefore)) {
        return 'authorization validity window is not numeric';
    }
    if (validAfter > nowSec) {
        return `authorization is not valid yet (validAfter=${auth.validAfter}, now=${nowSec})`;
    }
    if (validBefore < nowSec + SETTLE_BUFFER_SECONDS) {
        return `authorization expires too soon to settle (validBefore=${auth.validBefore}, now=${nowSec}); sign with validBefore ≥ now + maxTimeoutSeconds`;
    }
    return null;
}
