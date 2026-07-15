// Machine-readable storefront catalog — the primary discovery surface for
// agents (and the data source for the /store page). One GET returns
// everything a payment-capable client needs to go from zero to a completed
// purchase or paid inference call: models with per-call prices, credit packs,
// full PaymentRequirements per resource, and a copy-paste flow description.

import { NextResponse } from 'next/server';
import {
    CALLABLE_MODELS,
    CREDIT_PACKS,
    KEY_PREFIX,
    usdToUsdcAtomic,
} from '@/lib/x402/catalog';
import {
    buildCallRequirements,
    buildPackRequirements,
    getStoreConfig,
} from '@/lib/x402/config';
import { TOPUP_KEY_HEADER } from '@/lib/x402/payments';
import { PAYMENT_HEADER, X402_VERSION } from '@/lib/x402/types';
import { X402_CORS_HEADERS, x402Preflight } from '@/lib/x402/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
    const config = getStoreConfig();
    const { network, appUrl } = config;
    const chatEndpoint = `${appUrl}/api/x402/chat/completions`;

    return NextResponse.json(
        {
            x402Version: X402_VERSION,
            store: 'Tripplet Store',
            enabled: config.enabled,
            ...(config.enabled ? {} : { reason: config.reason }),
            noAccountRequired: true,
            network: {
                id: network.id,
                chainId: network.chainId,
                label: network.label,
                testnet: network.testnet,
                rpcUrl: network.rpcUrl,
                explorerTx: network.explorerTx,
                usdc: network.usdc,
                ...(network.faucet ? { faucet: network.faucet } : {}),
            },
            inference: {
                endpoint: chatEndpoint,
                shape: 'OpenAI chat.completions (non-streaming)',
                payPerCall: {
                    how: `POST with an ${PAYMENT_HEADER} header — each request settles its own USDC micro-payment. No key, no account.`,
                    models: CALLABLE_MODELS.map((m) => ({
                        id: m.id,
                        name: m.name,
                        description: m.description,
                        pricePerCallUsd: m.pricePerCallUsd,
                        priceAtomic: usdToUsdcAtomic(m.pricePerCallUsd),
                        maxOutputTokens: m.maxOutputTokens,
                        ...(config.enabled ? { accepts: [buildCallRequirements(config, m)] } : {}),
                    })),
                },
                prepaid: {
                    how: `Buy a pack below; the receipt's grant.apiKey is a ${KEY_PREFIX} bearer key. Use it as "Authorization: Bearer <key>" — credits meter actual token usage, no settle latency per call.`,
                    balance: `GET ${appUrl}/api/x402/key with the bearer key`,
                    topUp: `Pay any pack with your existing key in the ${TOPUP_KEY_HEADER} header`,
                    exhausted: 'An empty key gets HTTP 402 whose accepts[] are the packs below — pay one and retry.',
                },
            },
            packs: CREDIT_PACKS.map((p) => ({
                id: p.id,
                name: p.name,
                tagline: p.tagline,
                description: p.description,
                priceUsd: p.priceUsd,
                priceAtomic: usdToUsdcAtomic(p.priceUsd),
                credits: p.credits,
                features: p.features,
                accent: p.accent,
                icon: p.icon,
                popular: p.popular ?? false,
                endpoint: `${appUrl}/api/x402/buy/${p.id}`,
                ...(config.enabled ? { accepts: [buildPackRequirements(config, p)] } : {}),
            })),
            agent: {
                protocol: `x402 v${X402_VERSION} · scheme 'exact' · ${network.usdc.symbol} on ${network.id} · gasless for the payer`,
                flow: [
                    `GET/POST any resource above with no ${PAYMENT_HEADER} header → HTTP 402 + { accepts: [PaymentRequirements] }`,
                    'Sign an EIP-3009 TransferWithAuthorization for exactly maxAmountRequired (the facilitator pays gas)',
                    `Retry with ${PAYMENT_HEADER}: base64(PaymentPayload) → 200 + receipt + X-PAYMENT-RESPONSE header`,
                    'Pack receipts contain grant.apiKey; replaying the same payment re-returns the same receipt and key (idempotent)',
                ],
                compatibleClients: ['x402-fetch', 'x402-axios', 'x402 httpx hooks', 'any spec-compliant x402 v1 client'],
                discovery: `${appUrl}/.well-known/x402`,
            },
        },
        {
            headers: {
                ...X402_CORS_HEADERS,
                'Cache-Control': 'public, max-age=60',
            },
        },
    );
}

export function OPTIONS(): Response {
    return x402Preflight();
}
