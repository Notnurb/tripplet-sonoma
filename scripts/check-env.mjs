#!/usr/bin/env node
/**
 * Fail-fast production environment gate.
 *
 * Runs in `prebuild` — BEFORE `prisma migrate deploy && next build` — so a
 * missing secret aborts the whole build with a clear, specific message instead
 * of:
 *   - crashing mid-`next build` during page-data collection (which Vercel can
 *     report confusingly and which historically let a stale deploy keep
 *     serving), or
 *   - building green and only exploding on the first real request in prod.
 *
 * This is intentionally a standalone script (not `src/lib/env.ts`) so it runs
 * before any Next.js/Prisma code loads and can `process.exit(1)` cleanly. A
 * non-zero exit here fails the Vercel build command → the broken deploy is
 * never promoted.
 *
 * Only enforced when NODE_ENV === 'production'. Dev/test builds skip the gate.
 *
 * Env resolution mirrors Next.js: values already in process.env (how Vercel
 * injects them) win; a local `.env` file is loaded as a fallback so a normal
 * local `npm run build` still works. Set SKIP_ENV_FILE=1 to ignore `.env`
 * (used to verify the gate itself).
 */

import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';

const isProduction = process.env.NODE_ENV === 'production';

if (!isProduction) {
    console.log('[check-env] NODE_ENV != production — skipping strict env gate.');
    process.exit(0);
}

// Load .env as a fallback (does not override already-set process.env values),
// unless explicitly skipped for testing the gate.
if (process.env.SKIP_ENV_FILE !== '1') {
    const envPath = path.join(process.cwd(), '.env');
    if (existsSync(envPath)) loadDotenv({ path: envPath });
}

const has = (name) => {
    const v = process.env[name];
    return typeof v === 'string' && v.trim().length > 0;
};

/**
 * Each entry is either a single required var, or a { oneOf } group where at
 * least one of the listed vars must be present.
 */
const REQUIRED = [
    { name: 'JWT_SECRET', why: 'signs the legacy auth_token session cookie' },
    { name: 'DATABASE_URL', why: 'pooled Postgres connection used at runtime' },
    { name: 'DIRECT_URL', why: 'unpooled Postgres connection used by `prisma migrate deploy`' },
    { name: 'NEXT_PUBLIC_APP_URL', why: 'canonical app URL for OAuth/MCP issuer + absolute links' },
    {
        oneOf: ['GROQ_API_KEY', 'OPENCODE_ZEN_API_KEY'],
        why: 'at least one inference backend key, or every chat request 503s in production',
    },
];

const missing = [];
for (const req of REQUIRED) {
    if (req.oneOf) {
        if (!req.oneOf.some(has)) {
            missing.push({ label: req.oneOf.join(' (or) '), why: req.why });
        }
    } else if (!has(req.name)) {
        missing.push({ label: req.name, why: req.why });
    }
}

if (missing.length > 0) {
    const lines = missing.map((m) => `  ✗ ${m.label} — ${m.why}`).join('\n');
    console.error(
        '\n❌ [check-env] Refusing to build for production: required environment ' +
            `variable(s) missing:\n\n${lines}\n\n` +
            'Set these in the Vercel project (Settings → Environment Variables) ' +
            'for the Production environment, then redeploy. This gate exists so a ' +
            'missing secret fails the build loudly instead of silently breaking ' +
            'auth in production.\n',
    );
    process.exit(1);
}

console.log('[check-env] ✓ All required production environment variables are present.');
process.exit(0);
