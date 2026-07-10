# ADR 0001 — The two system-prompt builders stay separate

**Status:** Accepted (July 2026)

## Context

The app has two chat paths with their own system-prompt construction:

- `src/lib/ai/system-prompt.ts` — the legacy `/api/chat` builder. Composes
  modes (think / deep-research / web-search / study), tones, planning and
  file-output instructions, and loads persona identities from `sprompts/*.md`.
- `src/lib/sonoma/prompt.ts` — the Sonoma (`/api/sonoma`) builder. Composes the
  agentic tool-loop contract (web_search / fetch_url / run_python /
  mermaid_diagram usage rules), per-workspace addenda, and full persona
  identities from `src/lib/ai/model-prompts.ts`.

A code review flagged the duplication risk: a change made in one builder can
silently miss the other.

## Decision

Keep the builders separate. Share only the **safety-critical overlap** through
`src/lib/security/prompt-guardrails.ts` (the untrusted-external-content
guardrail sentence and the `wrapUntrusted()` nonce-boundary wrapper), which both
paths import and a unit test pins.

## Rationale

- The overlap that *must* never drift is safety language — that is now a single
  constant with a test. The rest of the two prompts describe **genuinely
  different products**: a modes/tones conversation vs. an agentic tool loop.
- A merged builder would be a config-driven superset with branches for every
  divergence — more code than the two builders combined, and a change for one
  path would require re-reasoning the other's branch on every edit.
- `/api/chat` is the legacy path. If it is ever retired, the "duplication"
  disappears by deletion, which is cheaper than un-merging a unified builder.

## Consequences

- Non-safety prompt improvements (e.g. formatting guidance) must be applied to
  each path deliberately. This is accepted: the paths intentionally read
  differently to their models.
- Any new *safety* wording must go into `prompt-guardrails.ts`, not inline into
  either builder. Reviewers should reject inline safety language in the
  builders.

## Revisit trigger

Revisit this decision when either happens, so the trade-off has an expiry
condition instead of being open-ended:

- `/api/chat` is scheduled for retirement (delete `system-prompt.ts` with it —
  do not merge first), or
- a third prompt-building path appears. Two parallel builders are manageable;
  three means the shared-core extraction pays for itself.
