# Product Idea: TrippletSpace — the home for your agents

> Status: PROPOSED · Owner: Alex · Generated 2026-07-07
> An idea, not an implementation. Nothing here has been built.

## 1. The insight — Tripplet already has agents, it just has no *space* for them

Tripplet's agent capability is real but **headless and scattered**. It exists in
the code, not in the product:

- `src/app/api/hyperagent/route.ts` — a genuine tool-calling agent loop
  (`MAX_TOOL_ROUNDS = 8`) with a **sandboxed Linux terminal** (`run_terminal`)
  and `web_search`. This is a full autonomous worker with no UI to name, save, or
  re-run it.
- `src/app/api/agents/route.ts` — multi-AI **collaboration** (`num_agents`, a
  `/agents/collaborate/stream` backend). Several models working one problem.
- `src/lib/hivemind/index.ts` — a **100-agent pool** with a consent model.
- `src/lib/mcp/tools.ts` — Tripplet's backends exposed as **MCP tools** so
  *external* agents (Claude, Cursor, Codex) already act as Tripplet clients.
- `opensonoma-agent/` — a CLI + `relay` + `sonoma-skill` package: agents that run
  **outside** the browser.
- `@anura` — a per-message sandboxed VM.

Every one of these is a one-shot, fire-and-forget invocation. Nothing persists,
nothing is named, nothing is observable, nothing is shareable. **TrippletSpace is
the missing surface that turns these scattered calls into managed, reusable,
observable agents** — a new top-level app alongside Chat, not a feature of `@anura`.

## 2. What TrippletSpace *is*

A dedicated section of the app (`/space`) where a user can **create, configure,
run, watch, and share agents**. Think "a workspace of little employees," each one
a saved configuration over the capabilities that already exist.

An **Agent** in TrippletSpace = a saved bundle of:
- a **name + purpose** ("Morning News Brief", "Refactor Bot", "Lease Reviewer")
- a **base model** (Astro 5 / Taipei 4 / Majuli 4 / Suzhou 4)
- **enabled tools** (terminal, web_search, memory, MCP tools, `@anura` VM)
- a **system prompt / instructions**
- **memory scope** (its own User-Memory namespace so agents don't cross-contaminate)
- a **trigger**: manual, scheduled (cron), on-webhook, or on-mention in chat
- **guardrails**: token budget (reuses the limits engine), tool allow-list,
  approval-required steps.

## 3. The four things you can do in the Space

1. **Build** — a form/gallery to assemble an agent from the toggles above. Start
   from templates ("Researcher", "Coder", "Watcher", "Multi-agent Debate" using
   the existing `/api/agents` collaboration).
2. **Run & Watch** — a live run view streaming the `hyperagent` tool loop: each
   `run_terminal` / `web_search` step, its output, the reasoning between rounds.
   This is the "cockpit" — today that stream exists but nobody can see it.
3. **Schedule / Automate** — attach a trigger so an agent runs without a human.
   "Every morning, research X and write it to my Memory / email me." Runs land in
   a **run history** with logs, cost, and status.
4. **Share / Fork** — publish an agent config as a template others can fork
   (this is where it ties into the `GROWTH_IDEA.md` "fork = signup at peak intent"
   loop — a shared agent is a working demo, and forking it requires an account).

## 4. Why this is a *new app*, not a bolt-on

- **Different mental model.** Chat is synchronous and ephemeral; agents are
  persistent and asynchronous. They deserve separate surfaces — a chat thread
  can't express "this thing ran at 6am and here's its 40-step log."
- **It unifies five half-features into one product story.** hyperagent, /agents,
  hivemind, MCP, and opensonoma-agent stop being disconnected endpoints and
  become "the engines behind TrippletSpace."
- **It's a moat competitors can't cheaply copy.** The sandboxed terminal + VM +
  multi-model collaboration + MCP surface already exist here; wrapping them in a
  management UI is a product most chat clones can't ship because they don't have
  the backends.

## 5. Why it drives growth *and* revenue

- **Growth:** shared/forked agents are self-demonstrating. A public "Lease
  Reviewer" agent is a landing page that *does something*, and using it needs an
  account. Pairs directly with `GROWTH_IDEA.md` (Proof Links) — an agent's run
  output is itself a shareable Proof Link.
- **Revenue:** agents are the natural metered unit. Scheduled/automated runs and
  concurrent agents map cleanly onto Pro/Max tiers in `PRODUCT_PLAN.md` — "free =
  manual runs only; Pro = scheduled agents; Max = N concurrent + longer tool
  budgets." The limits engine (`src/lib/limits/usage.ts`) already gates tokens;
  agents just add a second axis (count + schedule) to sell.
- **Retention:** a scheduled agent that emails you every morning is a *reason to
  keep the account* even on days you don't open the app.

## 6. Rough shape (where it plugs in)

| Piece | Where |
|---|---|
| `Agent` + `AgentRun` models (config, tools, trigger, logs, cost, status) | `prisma/schema.prisma` |
| Space UI: gallery, builder, run cockpit, history | new `src/app/(app)/space/**` |
| Create/list/update agents | new `src/app/api/space/agents/route.ts` |
| Execute an agent (wraps the existing loop) | reuse `src/app/api/hyperagent/route.ts` engine; new `run` endpoint persists steps |
| Multi-agent template | reuse `src/app/api/agents/route.ts` (`/agents/collaborate`) |
| Scheduling | cron trigger → the same run endpoint (external scheduler or backend job) |
| Per-agent memory namespace | extend the `BACKEND_URL` memory calls with an agent id |
| Guardrails / metering | reuse `src/lib/limits/*` + `src/lib/security/rate-limit.ts` |
| External access | agents already reachable via `src/lib/mcp/tools.ts` — expose Space agents as MCP tools too |

## 7. First test (cheap, ~1–2 weeks)

Ship the **run cockpit for the existing `hyperagent`** only: a `/space` page where
a signed-in user types a task, watches the terminal+search tool loop stream live,
and the run is **saved to a history list** they can re-open and re-run. No
scheduling, no builder, no sharing yet.

That single step converts the biggest hidden asset (a working autonomous agent
with a real sandbox) into something a user can *see* — and tells us whether people
want to manage agents before we build the full Space. If re-runs and repeat visits
show up, layer in the builder → scheduling → sharing.

## 8. Out of scope / follow-ups

- Agent marketplace (paid/community templates) — a distribution channel of its own.
- Team spaces (shared agents inside an org) → enterprise tier.
- Agent-to-agent chaining ("Researcher feeds Writer") — powerful but only after
  single agents are solid.
- Reconcile hivemind's 100-agent pool with named user agents (different concepts;
  keep hivemind as an *engine* option, not a user-facing count).
