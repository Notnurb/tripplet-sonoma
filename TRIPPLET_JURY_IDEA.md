# New Product Idea: Tripplet Jury — the answer that argues with itself

> Status: PROPOSED · Owner: Alex · Generated 2026-07-07
> New direction. Not proactive (Mova/Pulse failed — no traction). This is a
> pull product with a sharp wedge: **trust**.

## 1. Why Mova didn't work, and what to learn from it

Proactive push (Mova) had no traction because it asked for a behavior change
(let an app message you) before earning trust. Lesson: don't invent a new habit —
**attach to a moment people already have, and win it decisively.**

The moment: someone asks an AI a question where **being wrong is expensive** — a
medical symptom, a legal clause, a tax move, a "will this code break prod"
question, a big purchase. Today they paste the same question into ChatGPT, Grok,
and Claude *by hand* and eyeball which one to trust. That manual cross-check is
the workflow Tripplet can own.

## 2. The idea — one question, a panel of models, a verdict

Tripplet already has the exact machinery for this and uses none of it this way:
- `src/app/api/agents/route.ts` — **multi-model collaboration** (`num_agents`,
  `/agents/collaborate`). Several models on one problem.
- `MODELS` (Astro 5 / Taipei 4 / Majuli 4 / Suzhou 4) — a **diverse panel**.
- Web search + citations via `BACKEND_URL` `/search/combined`.

**Tripplet Jury** turns a single question into an adversarial panel:

1. The question fans out to **3–4 different models**, each answering
   independently.
2. They **see each other's answers and attack the weak ones** — "Astro claims X,
   but the cited source says the opposite."
3. Tripplet shows the user a **verdict**: where the models *agree* (high
   confidence, green), where they *disagree* (flagged, amber — "the models split
   on dosage; here's why"), and the **citations behind each claim**.
4. A single **confidence score** and a plain-English "here's what's solid and
   here's what to double-check with a human."

The output isn't one glib paragraph. It's **"3 of 4 models agree, here's the one
that dissented and its reason."** That's a fundamentally more trustworthy artifact
than any single-model chat, and no single-model competitor can produce it.

## 3. Why *this* wins where a generic chat clone loses

- **It sells a feeling single-model apps can't:** "I don't have to take one AI's
  word for it." Disagreement made visible is the anti-hallucination pitch.
- **The wedge is a real, painful, high-frequency job:** the manual "ask three
  AIs and compare" ritual that careful people already do. Jury automates it in
  one query.
- **It's defensible:** it needs a multi-model backend + collaboration loop.
  Tripplet has both today; ChatGPT/Claude are single-vendor and structurally
  can't show a cross-vendor jury.
- **It's shareable by nature:** a "verdict card" (3/4 agree, dissent shown,
  confidence 82%) is a screenshot people post — ties into the `GROWTH_IDEA.md`
  Proof-Link loop. Every high-stakes verdict is marketing.

## 4. The surface: a "verdict card," not a chat bubble

A Jury answer renders as a compact card:
- **Consensus line** (what all models agree on) — big, green.
- **Split flags** (where they diverged) — amber, expandable to see each model's
  take side by side.
- **Confidence score** + one-line "verify with a professional" when stakes are high.
- **Citations** inline.
- **"Ask a follow-up"** → normal Tripplet chat, so Jury is a front door into the
  full app.

## 5. Growth + revenue

- **Growth:** verdict cards are inherently quotable and screenshot-friendly;
  "trust" is a sharable emotion. Pair with Proof Links so any verdict mints a
  public page.
- **Revenue:** Jury is obviously premium — running 3–4 models per query costs
  more, so it's a clean upsell. Free = single-model answers + a few Jury queries;
  Pro = daily Jury; Max = larger panels + deeper per-model research. Slots into
  `PRODUCT_PLAN.md` tiers, and the cost story *justifies* the price instead of
  hiding it.
- **Retention:** once someone trusts Jury for the scary questions, that's where
  they bring every scary question. High-stakes = high loyalty.

## 6. Rough shape (where it plugs in)

| Piece | Where |
|---|---|
| Fan-out + adversarial cross-check | reuse `src/app/api/agents/route.ts` (`/agents/collaborate`), extend to a "critique round" |
| Diverse panel selection | `src/lib/ai/models.ts` |
| Citations | existing `BACKEND_URL` `/search/combined` |
| Verdict synthesis (agree/split/confidence) | new `src/app/api/jury/route.ts` — collect answers, compute agreement, synthesize verdict |
| Verdict card UI | new component + a `/jury` entry (or a "Jury" mode toggle in chat) |
| Metering (panel size per plan) | reuse `src/lib/limits/*` |

## 7. First test (cheap, ~1 week)

Add a **"Jury" toggle** to the existing chat input. When on, the question fans out
to 3 models, and the reply renders as a verdict card (consensus / split /
confidence + citations). No new page, no marketplace — one endpoint and one card
component riding on the collaboration route that already exists.

Measure the only thing that matters: **do people turn Jury *on* for their hard
questions, and do they come back and turn it on again?** If yes, build the
dedicated surface and the shareable verdict pages. If not, we spent one endpoint
to learn it — far cheaper than Mova.

## 8. Out of scope / follow-ups

- Domain packs (a "medical" or "legal" Jury with tuned panels + stronger "see a
  professional" rails).
- Human-in-the-loop escalation ("none of the models are confident → route to an
  expert") — a possible marketplace.
- Verdict history so a user can see how the panel's confidence held up over time.
