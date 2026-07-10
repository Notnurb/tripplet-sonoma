# Tripplet Sonoma — Wiki

Tripplet is an independent, multi-modal AI platform built on Next.js 15 + React 19 + TypeScript: streaming chat across four in-house model personas, an agentic tool loop (web search, real Python, a browser-side Linux VM), persistent cross-conversation memory, and an AI-fact-checked knowledge base — all behind one first-party login.

This wiki goes deeper than the [README](../../README.md) and [CLAUDE.md](../../CLAUDE.md). Start with Architecture, then branch into whichever subsystem you're touching.

## Pages

- [Architecture](./Architecture.md) — layers, request flow, trust boundaries
- [Auth](./Auth.md) — JWT auth, guest mode, the removed Better Auth system, `neon_auth`
- [Models and Personas](./Models-and-Personas.md) — the four personas, `resolveBackend()`, modes/tones, DeepCode
- [Database](./Database.md) — Prisma schema, Neon, `db/schema.sql`, migrations
- [External Backend](./External-Backend.md) — `BACKEND_URL`, memory/search endpoints, graceful degradation
- [Deployment](./Deployment.md) — Vercel build, env vars, CI
- [Security](./Security.md) — what's in place, incident history, threat model
- [API Routes](./API-Routes.md) — all `src/app/api/*` routes grouped by purpose
- [Contributing FAQ](./Contributing-FAQ.md) — setup, gotchas, "why does X work this way"

## Other docs worth knowing about

| Doc | Covers |
|---|---|
| [`CLAUDE.md`](../../CLAUDE.md) / [`AGENTS.md`](../../AGENTS.md) | Agent-facing architecture source of truth |
| [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) | Sonoma request-flow diagram and module map |
| [`SECURITY.md`](../../SECURITY.md) | Vulnerability disclosure policy |
| [`CHANGELOG.md`](../../CHANGELOG.md) | What changed and when |
| [`docs/audits/`](../audits) | Point-in-time security/engineering review reports |
