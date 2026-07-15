// Thin client for an x402 facilitator (POST /verify, POST /settle) plus a
// direct-RPC probe used to resolve ambiguous settlements without trusting
// anyone: EIP-3009's authorizationState() tells us on-chain whether a signed
// authorization was consumed — and since `to` is part of the signed tuple, a
// consumed authorization means the USDC moved to OUR payTo wallet.

import {
    X402_VERSION,
    type FacilitatorVerifyResponse,
    type PaymentPayload,
    type PaymentRequirements,
    type SettlementResponse,
} from './types';
import type { EnabledStoreConfig, X402NetworkInfo } from './config';

// Verification is a signature + balance check; settlement waits for a Base
// block (~2s) plus facilitator overhead, so it gets far more rope.
const VERIFY_TIMEOUT_MS = 15_000;
const SETTLE_TIMEOUT_MS = 60_000;
const RPC_TIMEOUT_MS = 8_000;

/** The facilitator could not be reached or spoke gibberish — infrastructure
 *  failure, NOT a verdict about the payment. Callers must fail closed. */
export class FacilitatorUnreachableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FacilitatorUnreachableError';
    }
}

async function facilitatorPost(
    config: EnabledStoreConfig,
    path: '/verify' | '/settle',
    payment: PaymentPayload,
    requirements: PaymentRequirements,
    timeoutMs: number,
): Promise<unknown> {
    const url = `${config.facilitatorUrl}${path}`;
    let res: Response;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.facilitatorApiKey
                    ? { Authorization: `Bearer ${config.facilitatorApiKey}` }
                    : {}),
            },
            body: JSON.stringify({
                x402Version: X402_VERSION,
                paymentPayload: payment,
                paymentRequirements: requirements,
            }),
            signal: AbortSignal.timeout(timeoutMs),
            cache: 'no-store',
        });
    } catch (e) {
        throw new FacilitatorUnreachableError(
            `facilitator ${path} unreachable: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
    // Facilitators answer 200 for both verdicts; some return 4xx with a verdict
    // body for invalid payments. Try to parse a body either way and let the
    // shape checks below decide — a non-JSON 5xx ends up as unreachable.
    let body: unknown;
    try {
        body = await res.json();
    } catch {
        throw new FacilitatorUnreachableError(
            `facilitator ${path} returned HTTP ${res.status} with a non-JSON body`,
        );
    }
    return body;
}

export async function facilitatorVerify(
    config: EnabledStoreConfig,
    payment: PaymentPayload,
    requirements: PaymentRequirements,
): Promise<FacilitatorVerifyResponse> {
    const body = await facilitatorPost(config, '/verify', payment, requirements, VERIFY_TIMEOUT_MS);
    if (body && typeof body === 'object' && typeof (body as { isValid?: unknown }).isValid === 'boolean') {
        return body as unknown as FacilitatorVerifyResponse;
    }
    throw new FacilitatorUnreachableError('facilitator /verify returned an unrecognized shape');
}

export async function facilitatorSettle(
    config: EnabledStoreConfig,
    payment: PaymentPayload,
    requirements: PaymentRequirements,
): Promise<SettlementResponse> {
    const body = await facilitatorPost(config, '/settle', payment, requirements, SETTLE_TIMEOUT_MS);
    if (body && typeof body === 'object' && typeof (body as { success?: unknown }).success === 'boolean') {
        return body as unknown as SettlementResponse;
    }
    throw new FacilitatorUnreachableError('facilitator /settle returned an unrecognized shape');
}

// ─── On-chain recovery probe ─────────────────────────────────────────────────

// authorizationState(address authorizer, bytes32 nonce) → bool, part of
// EIP-3009 (FiatToken v2). Selector verified against 4byte.directory.
const AUTHORIZATION_STATE_SELECTOR = '0xe94a0102';

/**
 * Ask the chain directly whether an EIP-3009 authorization has been consumed.
 * Used when a /settle call times out: `true` means the transfer to our payTo
 * landed (grant it), `false` means it never settled (safe to retry), and
 * `null` means the RPC could not tell us (stay ambiguous, fail closed).
 */
export async function isAuthorizationConsumed(
    network: X402NetworkInfo,
    from: string,
    nonce: string,
): Promise<boolean | null> {
    try {
        const data =
            AUTHORIZATION_STATE_SELECTOR +
            from.slice(2).toLowerCase().padStart(64, '0') +
            nonce.slice(2).toLowerCase();
        const res = await fetch(network.rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'eth_call',
                params: [{ to: network.usdc.address, data }, 'latest'],
            }),
            signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
            cache: 'no-store',
        });
        const json = (await res.json()) as { result?: unknown };
        if (typeof json.result !== 'string' || !json.result.startsWith('0x') || json.result === '0x') {
            return null;
        }
        return BigInt(json.result) === BigInt(1);
    } catch {
        return null;
    }
}
