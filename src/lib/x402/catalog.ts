// The storefront catalog. CLIENT-SAFE (no env, no DB, no Node imports) — the
// /store page and the server share these definitions.
//
// Two ways to buy, both accountless:
//   1. PER-CALL — POST /api/x402/chat/completions with an X-PAYMENT header;
//      each request pays for itself. Flat price per call, per model persona.
//   2. PREPAID PACKS — buy once at /api/x402/buy/{pack}; the receipt contains
//      a `trpl_x4_...` bearer key holding token credits, metered against
//      actual upstream usage. Cheaper per token and no settle latency per call.
//
// Prices are product decisions — edit freely; they are parsed with exact
// decimal math into USDC base units, never floats. Model ids here are the
// public persona ids (client-safe) — real upstream model names must never
// appear in this file or anywhere the frontend can see.

export const KEY_PREFIX = 'trpl_x4_';

// ─── Per-call inference pricing ──────────────────────────────────────────────

export interface CallableModel {
    /** Public persona id — what agents put in the request `model` field. */
    id: string;
    name: string;
    description: string;
    /** Flat USD price per request when paying with X-PAYMENT. */
    pricePerCallUsd: string;
    /** Hard cap on `max_tokens` for a single per-call request. */
    maxOutputTokens: number;
}

export const CALLABLE_MODELS: CallableModel[] = [
    {
        id: 'astro-5',
        name: 'Astro 5',
        description: 'Flagship — top reasoning and range.',
        pricePerCallUsd: '0.03',
        maxOutputTokens: 4096,
    },
    {
        id: 'taipei4',
        name: 'Taipei 4',
        description: 'Advanced reasoning and analysis.',
        pricePerCallUsd: '0.02',
        maxOutputTokens: 4096,
    },
    {
        id: 'majuli4',
        name: 'Majuli 4',
        description: 'Fast and concise responses.',
        pricePerCallUsd: '0.01',
        maxOutputTokens: 4096,
    },
    {
        id: 'suzhou4',
        name: 'Suzhou 4',
        description: 'Creative and detailed generation.',
        pricePerCallUsd: '0.01',
        maxOutputTokens: 4096,
    },
];

export function getCallableModel(id: string): CallableModel | undefined {
    return CALLABLE_MODELS.find((m) => m.id === id);
}

// ─── Prepaid credit packs ────────────────────────────────────────────────────

export interface CreditPack {
    id: string;
    name: string;
    tagline: string;
    /** Full sentences — surfaces in payment requirements, so agents read this. */
    description: string;
    /** Decimal USD string, e.g. '4.99'. USDC is treated 1:1 with USD. */
    priceUsd: string;
    /** Token credits loaded onto the key (metered on actual usage). */
    credits: number;
    features: string[];
    // UI hints for the store page.
    accent: string;
    icon: 'zap' | 'crown' | 'diamond';
    popular?: boolean;
}

export const CREDIT_PACKS: CreditPack[] = [
    {
        id: 'starter',
        name: 'Starter',
        tagline: 'Try the API for a dollar',
        description:
            'A prepaid Tripplet API key loaded with 750,000 token credits, usable ' +
            'on every model including Astro 5. Credits are metered on actual usage. ' +
            'The key never expires and needs no account.',
        priceUsd: '0.99',
        credits: 750_000,
        features: ['750K token credits', 'All models incl. Astro 5', 'Key delivered in the receipt'],
        accent: '#0ea5e9',
        icon: 'zap',
    },
    {
        id: 'builder',
        name: 'Builder',
        tagline: 'For agents doing real work',
        description:
            'A prepaid Tripplet API key loaded with 5,000,000 token credits, usable ' +
            'on every model including Astro 5. Credits are metered on actual usage. ' +
            'The key never expires and needs no account. Send an existing key in the ' +
            'X-Tripplet-Key header to top it up instead of minting a new one.',
        priceUsd: '4.99',
        credits: 5_000_000,
        features: ['5M token credits', '~25% cheaper per token', 'Top up an existing key', 'No expiry, no account'],
        accent: '#8b5cf6',
        icon: 'crown',
        popular: true,
    },
    {
        id: 'power',
        name: 'Power',
        tagline: 'Bulk credits, best rate',
        description:
            'A prepaid Tripplet API key loaded with 25,000,000 token credits, usable ' +
            'on every model including Astro 5. Credits are metered on actual usage. ' +
            'The key never expires and needs no account. Send an existing key in the ' +
            'X-Tripplet-Key header to top it up instead of minting a new one.',
        priceUsd: '19.99',
        credits: 25_000_000,
        features: ['25M token credits', 'Best per-token rate', 'Top up an existing key', 'No expiry, no account'],
        accent: '#b8860b',
        icon: 'diamond',
    },
];

export function getPack(id: string): CreditPack | undefined {
    return CREDIT_PACKS.find((p) => p.id === id);
}

// ─── Exact USDC decimal math (strings + BigInt only, never floats) ───────────

export const USDC_DECIMALS = 6;

const ATOMIC_PER_WHOLE = BigInt(10) ** BigInt(USDC_DECIMALS);

/** '12.00' → '12000000'. Throws on malformed or >6-decimal input. */
export function usdToUsdcAtomic(usd: string): string {
    const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(usd.trim());
    if (!m) throw new Error(`Malformed USD amount: '${usd}' (want e.g. '12.00', max 6 decimals)`);
    const frac = (m[2] ?? '').padEnd(USDC_DECIMALS, '0');
    return (BigInt(m[1]) * ATOMIC_PER_WHOLE + BigInt(frac)).toString();
}

/** '12000000' → '12.00'; keeps sub-cent digits only when non-zero. */
export function formatUsdcAtomic(atomic: string): string {
    const v = BigInt(atomic);
    const whole = v / ATOMIC_PER_WHOLE;
    const frac6 = (v % ATOMIC_PER_WHOLE).toString().padStart(USDC_DECIMALS, '0');
    const trimmed = frac6.replace(/0+$/, '');
    const shown = trimmed.length <= 2 ? frac6.slice(0, 2) : trimmed;
    return `${whole.toString()}.${shown}`;
}

export function formatCredits(n: number): string {
    if (n >= 1_000_000) {
        const m = n / 1_000_000;
        return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}M`;
    }
    if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
    return String(n);
}
