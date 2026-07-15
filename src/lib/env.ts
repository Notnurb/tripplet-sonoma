import { z } from 'zod';

/**
 * Server-side environment variable schema.
 * Validated once at import time — fails fast on missing required vars.
 */
const serverSchema = z.object({
    // ─── Neon (PostgreSQL) ───────────────────────────────────────────────────
    // DATABASE_URL is the pooled connection string used at runtime by both Prisma
    // and the raw `pg` query layer. DIRECT_URL is the unpooled string used for
    // migrations.
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url().optional(),

    // ─── JWT ─────────────────────────────────────────────────────────────────
    // HS256 tokens are only as strong as this secret's entropy. A short/weak
    // value is offline-brute-forceable from one captured auth_token, after
    // which the attacker can forge a cookie for ANY userId — full account
    // takeover. 32 bytes matches the `openssl rand -base64 48` the setup docs
    // recommend; anything shorter is rejected at boot rather than silently
    // accepted (min(1) previously let any non-empty string through).
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters — generate one with `openssl rand -base64 48`'),

    // ─── Optional ────────────────────────────────────────────────────────────
    BACKEND_URL: z.string().url().optional().default('http://localhost:8000'),
    BACKEND_API_KEY: z.string().min(1).optional(),
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    GROQ_API_KEY: z.string().min(1).optional(),
    GROQ_API_BASE_URL: z.string().url().optional(),

    // ─── OpenCode Zen (Astro 5 flagship gateway) ─────────────────────────────
    OPENCODE_ZEN_API_KEY: z.string().min(1).optional(),
    OPENCODE_ZEN_API_BASE_URL: z.string().url().optional(),
    OPENCODE_ZEN_MODEL: z.string().min(1).optional(),

    ADMIN_USER_IDS: z.string().optional().default(''),

    // ─── x402 Store ──────────────────────────────────────────────────────────
    // All optional: with nothing set the storefront renders "not configured"
    // and the paid endpoints answer 503. X402_PAY_TO is the merchant wallet
    // that receives USDC. See docs/dev/x402-store.md.
    X402_PAY_TO: z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x-prefixed EVM address')
        .optional(),
    X402_NETWORK: z.enum(['base', 'base-sepolia']).optional(),
    X402_FACILITATOR_URL: z.string().url().optional(),
    X402_FACILITATOR_API_KEY: z.string().min(1).optional(),

    // ─── Node ────────────────────────────────────────────────────────────────
    NODE_ENV: z.enum(['development', 'production', 'test']).optional().default('development'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

function validateEnv(): ServerEnv {
    const result = serverSchema.safeParse(process.env);
    if (result.success) return result.data;

    const missing = result.error.issues
        .map(i => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n');
    console.error(`\n❌ Invalid environment variables:\n${missing}\n`);

    // Production keeps the hard fail-fast boot gate.
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Missing or invalid environment variables. See above.');
    }

    // Dev: don't throw at import time. This module sits in the import chain of
    // most API routes, so a throw here turns ONE missing var into an opaque
    // HTML 500 on every route — including routes that never read that var
    // (e.g. /api/sonoma streams chat fine without DATABASE_URL). Drop the
    // invalid keys and continue; whatever actually reads a missing var fails
    // at its point of use with a targeted error instead.
    const badKeys = new Set(result.error.issues.map((i) => String(i.path[0])));
    const cleaned = Object.fromEntries(
        Object.entries(process.env).filter(([k]) => !badKeys.has(k)),
    );
    const relaxed = serverSchema
        .extend({
            DATABASE_URL: serverSchema.shape.DATABASE_URL.optional(),
            JWT_SECRET: serverSchema.shape.JWT_SECRET.optional(),
        })
        .safeParse(cleaned);
    if (relaxed.success) return relaxed.data as ServerEnv;

    // Even the relaxed parse failed — nothing sane to run with.
    throw new Error('Missing or invalid environment variables. See above.');
}

export const env = validateEnv();
