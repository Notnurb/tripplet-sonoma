# New Product Idea: Tripplet Conjure — chat that builds you disposable software on the spot

> Status: PROPOSED · Owner: Alex · Generated 2026-07-07
> A genuinely unusual idea. Not chat, not multi-model, not proactive. Software
> that is born for one person, for one moment, then disappears.

## 1. The unique bet

Every AI answers questions with **text**. But a huge share of questions are
really "I need a tiny tool for the next five minutes" — a mortgage-vs-rent
calculator tuned to *my* numbers, a countdown for *this* recipe, a splitter for
*this* dinner bill, a diff viewer for *these two* JSON blobs, a widget to sort
*my* pasted list. Today people either get a wall of text, or they go hunt for a
generic online tool and bend it to their case.

**Tripplet Conjure makes the answer *be* the tool.** When your question is better
served by software than prose, Tripplet doesn't describe it — it **generates a
tiny, interactive, single-purpose app right in the conversation**, running live,
shaped to your exact numbers, and then lets it evaporate. Ephemeral, bespoke
software, conjured per intent.

Nobody ships this. ChatGPT/Claude return code you have to run yourself. Tripplet
already has the two hard pieces — a **sandboxed VM (`@anura`)** and **app
generation (`src/lib/ai/epsilon.ts`)** — and has never pointed them at "make me a
throwaway micro-tool inline."

## 2. What it feels like

> **You:** "should I take the 0% APR for 60 months or the $2000 cash back on a
> $34k car, I can get 6.5% at my credit union"
>
> **Tripplet:** *(instead of a paragraph)* spawns a live little calculator inline
> with your numbers pre-filled — sliders for loan term and rate, a real-time
> "0% APR wins by $1,240" verdict — that you can *drag* to test scenarios. Below
> it: one line of plain-English explanation. The tool is yours for this moment;
> close the chat and it's gone (or "Keep this" to save it).

The key move: **the interface is generated to fit the answer**, not the other way
around. A bill-split question conjures a bill-splitter. A schedule question
conjures a timeline. A "which of these" question conjures a comparison grid you
can edit.

## 3. Why this is defensibly different

- **It's not "generate an app" (Epsilon today).** Epsilon is a deliberate,
  heavyweight "build me a project" mode. Conjure is **automatic and disposable** —
  the model *decides* a question deserves a tool and spawns it inline, in the flow
  of a normal chat, with zero project ceremony.
- **It needs a sandbox to run untrusted generated UI safely.** `@anura` is exactly
  that. A text-only competitor can hand you code; it can't hand you a *running,
  interactive, safe* widget inside the answer.
- **It's memory-aware.** User Memory can pre-fill the tool ("your usual credit
  union rate is 6.5%") so the conjured tool already knows you — a personalization
  no generic web tool can match.

## 4. Why it can actually get traction (where Mova couldn't)

- **It's demand-driven, not push.** It only appears when *you* ask — no new habit
  to adopt, it just makes the existing chat dramatically more useful.
- **The "wow" is immediate and visual.** The first time an answer turns into a
  draggable calculator, it's a screenshot moment. That's organic distribution —
  and it plugs into the `GROWTH_IDEA.md` Proof-Link loop: a conjured tool is a
  *usable* shared page (fork it → account required at peak intent).
- **It's inherently repeatable.** People have "I need a quick tool" moments
  constantly, so the surface fires often, not once.

## 5. Growth + revenue

- **Growth:** shared conjured tools are the best possible ad — a working thing,
  not a screenshot of text. "Made this in one sentence" is a viral format.
- **Revenue:** free = a few conjures/day, ephemeral only; Pro = save & reuse your
  conjured tools ("Kept tools" become a personal toolbox); Max = richer tools,
  data upload, longer sandbox runtime. Maps onto `PRODUCT_PLAN.md` tiers, and
  "keep the tool you love" is a natural, non-annoying paywall.
- **Retention:** a saved toolbox of *your* bespoke tools is a switching cost. You
  don't leave the app that holds the calculators you built.

## 6. Rough shape (where it plugs in)

| Piece | Where |
|---|---|
| Decide "this answer wants a tool" | new intent classifier in the chat pipeline (`src/app/api/chat/route.ts` / system-prompt) |
| Generate the micro-app | reuse the Epsilon generator (`src/lib/ai/epsilon.ts`), constrained to a single self-contained widget |
| Run it safely, inline | reuse the `@anura` sandbox iframe, embedded in the message stream instead of full-screen |
| Pre-fill from the user | existing `BACKEND_URL` User Memory |
| Save / "Keep this" → toolbox | new `ConjuredTool` model in `prisma/schema.prisma` + `src/app/(app)/tools/**` |
| Metering (conjures/day, save = paid) | reuse `src/lib/limits/*` |

## 7. First test (cheap, ~1–2 weeks)

Pick **one** high-frequency category — **calculators** (money, unit, date math).
When the chat classifier detects a calc-shaped question, generate a single
self-contained interactive widget and render it inline in the message via the
`@anura` sandbox. No saving, no toolbox, no other categories.

Measure: how often people *interact* with the conjured widget (drag/edit) vs. just
read, and whether they come back and trigger it again. If a draggable calculator
inline beats a paragraph, expand categories and add "Keep this" → toolbox. If not,
we spent one classifier + one Epsilon constraint to find out.

## 8. Out of scope / follow-ups

- Tool categories beyond calculators (converters, comparison grids, timelines,
  data cleaners, form fillers).
- A public gallery of conjured tools (community distribution + SEO).
- Let a saved tool accept live data / re-run on new inputs — the bridge from
  "disposable" to "personal micro-app," and the on-ramp to TrippletSpace agents.
