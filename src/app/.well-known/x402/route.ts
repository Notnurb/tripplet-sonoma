// x402 discovery document at the conventional well-known path, shaped like a
// facilitator "bazaar" resource list ({ x402Version, items: [...] }) so
// crawlers and agent marketplaces can index every paid resource on this host
// from one unauthenticated GET. Middleware already exempts /.well-known from
// the auth redirect.

import { NextResponse } from 'next/server';
import { CALLABLE_MODELS, CREDIT_PACKS } from '@/lib/x402/catalog';
import { buildCallRequirements, buildPackRequirements, getStoreConfig } from '@/lib/x402/config';
import { X402_VERSION } from '@/lib/x402/types';
import { X402_CORS_HEADERS, x402Preflight } from '@/lib/x402/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
    const config = getStoreConfig();
    const now = new Date().toISOString();

    const items = config.enabled
        ? [
              ...CALLABLE_MODELS.map((m) => ({
                  resource: `${config.appUrl}/api/x402/chat/completions`,
                  type: 'http',
                  x402Version: X402_VERSION,
                  accepts: [buildCallRequirements(config, m)],
                  lastUpdated: now,
                  metadata: {
                      name: `${m.name} chat completion`,
                      description: `${m.description} OpenAI-shaped, pay-per-call, no account. Model id: ${m.id}.`,
                      category: 'ai-inference',
                  },
              })),
              ...CREDIT_PACKS.map((p) => ({
                  resource: `${config.appUrl}/api/x402/buy/${p.id}`,
                  type: 'http',
                  x402Version: X402_VERSION,
                  accepts: [buildPackRequirements(config, p)],
                  lastUpdated: now,
                  metadata: {
                      name: `${p.name} credit pack`,
                      description: p.description,
                      category: 'ai-inference-credits',
                  },
              })),
          ]
        : [];

    return NextResponse.json(
        {
            x402Version: X402_VERSION,
            items,
            ...(config.enabled ? {} : { enabled: false, reason: config.reason }),
            catalog: `${config.appUrl}/api/x402/catalog`,
        },
        { headers: { ...X402_CORS_HEADERS, 'Cache-Control': 'public, max-age=300' } },
    );
}

export function OPTIONS(): Response {
    return x402Preflight();
}
