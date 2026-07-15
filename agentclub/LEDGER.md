# SWARM LEDGER — maintained by [15] GOD

Single source of truth for risks, assignments, and file claims.
Comms happen in `communicaiton.md`; state lives HERE. Do not duplicate state into the comms thread.

## Risk Register (ranked)

| # | Risk | Status | Owner |
|---|------|--------|-------|
| R1 | Auth cutover mid-flight — AuthPage still calls legacy JWT routes; two identity systems live | OPEN — spec in progress by [15] | [15] → implementer TBD |
| R2 | Billing durability — `recordTokenUsage` fire-and-forget (`void`, route.ts:835); write can die at serverless teardown on ANY path incl. normal `done` | CONFIRMED by [12], pre-cleared for fix | [12] impl, [9] co-impl, [8] verify |
| R3 | Client abort mid-stream — no `cancel()` on ReadableStream; billed by accident via catch; upstream fetch never aborted (wasted compute) | CONFIRMED by [9]; same fix unit as R2 | [12]+[9], [8] verify |
| R4 | Migration `20260704000000_usage_limits` — file matches schema (static check by [8]); DB-APPLIED STATE UNCONFIRMED | BLOCKED — needs operator Neon creds (`npx prisma migrate status`) | OPERATOR |
| R5 | Token limits fail OPEN throughout `src/lib/limits` | ACCEPTED short-term by design; revisit at scale | [15] watching |
| R6 | Guest cookie first-request branch coverage in middleware | Under verification in [15] sweep | [8] after sweep |
| R7 | Dead pipelines (image/video/vision throw; two conflicting plan systems) | DEFERRED until R1–R3 close | safe-delete unit, later |

## Task Assignments

| ID | Task | Assignee | Verifier | Status | Files claimed |
|----|------|----------|----------|--------|---------------|
| T1 | Billing-durability + abort-hardening PR: add `cancel()` handler (settle + AbortController → upstream), make settlement durable (`await` or `waitUntil()`/`after()` before `controller.close()`) | [12] + [9] | [8] (test plan already staged) | ASSIGNED — GO | `src/app/api/sonoma/route.ts` |
| T2 | `prisma migrate status` / `migrate diff` against real Neon | OPERATOR (creds) | [7] reads output | BLOCKED ON OPERATOR | — |
| T3 | Auth cutover completion spec (minimal ordered change-set, no user lockout) | [15] | [1] Bill signs off | IN PROGRESS ([15] sweep) | — (spec only) |
| T4 | Guest-cookie branch verification (incognito click-through, Set-Cookie on first `/api/sonoma` response) | [8] | — | QUEUED behind [15] sweep result | — |

## File Claims (avoid concurrent-edit collisions)

Claim a file here BEFORE editing it. One claimant per file. Release when your unit ships.

| File | Claimed by | Task |
|------|-----------|------|
| `src/app/api/sonoma/route.ts` | [12] (with [9]) | T1 |
| `agentclub/LEDGER.md` | [15] | ledger upkeep |

## Decisions Escalated to Operator / [1]

1. **Abort-billing policy**: after T1, chars generated post-abort will stop accruing (upstream aborted). Chars generated BEFORE abort — bill or forgive? Current behavior bills them. [15] recommendation: bill pre-abort chars (work was done); document it.
2. **Neon creds** for T2.
