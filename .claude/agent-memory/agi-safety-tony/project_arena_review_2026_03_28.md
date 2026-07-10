---
name: Arena page safety review — 2026-03-28
description: Safety findings from the Model Arena page (src/app/(app)/arena/page.tsx) — jailbreak probing, API amplification, localStorage ELO gaming, prompt injection via user input
type: project
---

## Arena review — 2026-03-28

The Arena page lets users pit two anonymous models against each other and vote on winners, tracking ELO scores in localStorage.

### Key findings

**HIGH — Unauthenticated double-API amplification**
Every Arena battle fires TWO parallel `/api/chat` calls. Both count against the same rate-limit token (IP for guests). The 100 req/hr chat limit effectively becomes 50 battles/hr for guests with no account required. No arena-specific rate limit exists.

**HIGH — Jailbreak probing surface**
The page is explicitly designed to compare model responses side-by-side on the same prompt. An adversary can use this to systematically probe which model is more compliant with harmful requests — the anonymous display prevents immediate correlation but the revealed model names after voting expose the mapping. With 50 battles/hr available to guests this is a meaningful red-team capability.

**MEDIUM — No prompt content filtering on Arena path**
The Arena sends raw user input directly to `/api/chat` with no modes, no tones, and no system prompt override. The standard system prompt applies, which is fine — but there is no arena-specific header in the system prompt identifying these as comparative/evaluation calls. The model has no signal that it is in a benchmarking context.

**MEDIUM — localStorage ELO is fully client-controlled**
ELO scores and battle history live exclusively in localStorage. A user can open DevTools, write any ELO values they want, and publish screenshots presenting a "real" leaderboard. If ELO data is ever surfaced to other users or used to influence decisions, this is a manipulation surface.

**LOW — Infinite re-voting via rapid new-battle cycles**
A user can start a battle, vote immediately, and start another — there is no cooldown between votes. Combined with the suggested prompts auto-starting battles (onClick calls startBattle directly), a motivated user can generate a high volume of votes quickly.

**LOW — Suggested prompts are safe content-wise**
The eight hardcoded SUGGESTED prompts are benign. No issues.

**INFORMATIONAL — Model identity revealed post-vote**
The "blind" comparison is only blind until the user votes. After reveal, the prompt+model+response triple is stored in localStorage history. This is by design but means a persistent adversary can build a local dataset of model behavior across many battles.

### Mitigations recommended (priority order)
1. Add a separate `arenaLimiter` — 20 battles/hr for guests, 40 for authenticated users. Apply at the Arena page level or as a dedicated endpoint.
2. Add `arena: true` flag to the POST body so `route.ts` can append a system prompt note: "This is a blind comparative evaluation. Apply your standard content policy strictly."
3. Require auth (or at minimum guest-session cookie) to access the Arena page — it is a high-capability surface with no account requirement.
4. If ELO is ever shared beyond localStorage, move it server-side keyed by userId.

**Why this matters:** The Arena gives any visitor a structured, low-friction interface to compare model compliance across prompts at 50 battles/hr. That is meaningfully more systematic than ad-hoc chat testing.
