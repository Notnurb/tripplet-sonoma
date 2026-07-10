import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * Regression test for the failure mode that already happened once: a production
 * build going out with a required auth env var missing, breaking sign-in
 * silently. The prebuild gate (scripts/check-env.mjs) must fail LOUDLY — a
 * non-zero exit — rather than pass silently.
 */

const script = path.join(process.cwd(), 'scripts', 'check-env.mjs');

// Baseline: every required var present. SKIP_ENV_FILE=1 so the test controls
// the whole environment and doesn't pick up the developer's real .env.
const FULL_PROD_ENV = {
    NODE_ENV: 'production',
    SKIP_ENV_FILE: '1',
    PATH: process.env.PATH ?? '',
    JWT_SECRET: 'x',
    DATABASE_URL: 'postgres://a',
    DIRECT_URL: 'postgres://a',
    NEXT_PUBLIC_APP_URL: 'https://example.lol',
    GROQ_API_KEY: 'gsk_x', // satisfies the inference-key oneOf group
};

function runGate(env: Record<string, string>) {
    return spawnSync('node', [script], { env: env as NodeJS.ProcessEnv, encoding: 'utf8' });
}

describe('check-env production gate', () => {
    it('passes when all required vars are present', () => {
        const res = runGate(FULL_PROD_ENV);
        expect(res.status).toBe(0);
        expect(res.stdout).toContain('All required production environment variables are present');
    });

    it.each([
        'JWT_SECRET',
        'DATABASE_URL',
        'DIRECT_URL',
        'NEXT_PUBLIC_APP_URL',
    ])('fails loudly (exit 1) when %s is missing in production', (missingVar) => {
        const env = { ...FULL_PROD_ENV };
        delete (env as Record<string, string>)[missingVar];
        const res = runGate(env);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain(missingVar);
        expect(res.stderr).toContain('Refusing to build for production');
    });

    it('fails when NEITHER inference key is set in production', () => {
        const env = { ...FULL_PROD_ENV };
        delete (env as Record<string, string>).GROQ_API_KEY;
        const res = runGate(env);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('GROQ_API_KEY');
    });

    it('passes with only OPENCODE_ZEN_API_KEY set (GROQ absent)', () => {
        const env = { ...FULL_PROD_ENV };
        delete (env as Record<string, string>).GROQ_API_KEY;
        (env as Record<string, string>).OPENCODE_ZEN_API_KEY = 'zen_x';
        const res = runGate(env);
        expect(res.status).toBe(0);
    });

    it('is a no-op in development (never blocks a dev build)', () => {
        const res = runGate({ NODE_ENV: 'development', SKIP_ENV_FILE: '1', PATH: process.env.PATH ?? '' });
        expect(res.status).toBe(0);
        expect(res.stdout).toContain('skipping strict env gate');
    });
});
