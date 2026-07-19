import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    // Next.js sets tsconfig jsx: "preserve"; Vitest (rolldown/oxc) must
    // transpile JSX itself for component tests that import .tsx source. This
    // build of Vitest uses the oxc transformer, so only the oxc key is set
    // (setting esbuild too just warns that it's ignored).
    ...({ oxc: { jsx: { runtime: 'automatic' } } } as any),
    resolve: {
        // Mirror the Next.js "@/..." path alias so unit tests import source
        // modules the same way app code does.
        alias: { '@': path.resolve(__dirname, 'src') },
    },
    test: {
        // Unit/integration tests live next to a `.node.test.ts` / `.test.ts`
        // suffix under tests/unit. Playwright specs (tests/*.spec.ts) are run by
        // Playwright, not vitest — exclude them here so the two runners don't
        // fight over the same files.
        include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
        environment: 'node',
        coverage: {
            provider: 'v8',
            reporter: ['text-summary'],
            // Gate only the subtrees the unit suite actually targets — the
            // security/auth/validation/python/prompt core. A global threshold
            // would fail on the (intentionally e2e-covered) UI/route surface;
            // this ratchet stops the *tested* code from silently regressing.
            //
            // What is deliberately NOT gated, and why:
            //  - UI pages/components: covered by Playwright e2e + manual use;
            //    a unit floor here would gate markup, not behavior.
            //  - Non-auth API routes (telegram, connect, cloud-env, triplepedia,
            //    looptrain, mcp transport): thin adapters over external services;
            //    unit tests would mock away everything they do. Spot-audited for
            //    hygiene (e.g. telegram webhook uses timingSafeEqual) instead.
            //  - Experimental pages CLAUDE.md lists as prototypes.
            // When a route graduates from adapter to logic-bearing (like the
            // chat route did), extract the logic into src/lib/** — it then
            // falls inside this gate automatically.
            include: [
                'src/lib/security/**',
                'src/lib/auth/**',
                'src/lib/validation/**',
                'src/lib/python/**',
                'src/lib/sonoma/**',
                'src/lib/chat/**',
                'src/lib/cloud-env/**',
                'src/lib/db/neon.ts',
                'src/hooks/useConversations.ts',
                'src/app/api/auth/**',
                'src/app/api/oauth/token/**',
            ],
            // Floors set just below the current baseline (stmts 73.9 / br 59.5 /
            // fn 68.0 / ln 75.7) so they pass today and ratchet up over time —
            // a regression that drops coverage fails CI.
            thresholds: {
                statements: 70,
                branches: 56,
                functions: 65,
                lines: 72,
            },
        },
    },
});
