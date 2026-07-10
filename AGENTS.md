# AGENTS.md

**Single source of truth: [CLAUDE.md](./CLAUDE.md).** Read it in full before
working in this repository — commands, architecture, auth, database, UI rules,
and codewords all live there and are kept current.

This file used to carry its own copy of that guidance; it drifted badly
(describing Clerk auth and model names that no longer exist), so the duplicate
was removed rather than maintained twice. If you are an AI coding agent of any
flavor (Codex, Claude Code, or otherwise): follow CLAUDE.md exactly as written.

Quick orientation:

```bash
npm run dev          # Next.js dev server (Turbopack)
npm run type-check   # tsc --noEmit
npm run lint         # ESLint
npm run test:unit    # Vitest (tests/unit/)
```

Key entry points: `src/app/api/sonoma/route.ts` (agentic chat endpoint, thin —
logic in `src/lib/sonoma/*`), `src/lib/auth/` (first-party JWT auth),
`src/lib/security/` (rate limiting), `tests/unit/` (the test suite CI runs).
