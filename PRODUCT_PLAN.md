# Product Plan: Tripplet Plus — Real Subscriptions & Monetization

> Status: PROPOSED · Owner: Alex · Generated 2026-07-06
> This is a plan, not an implementation. Nothing here has been built.

## 1. Context — why this product

Tripplet already behaves like a paid product. It has three plan tiers
(`free` / `pro` / `max`), full per-plan token budgets (hourly / 3h-session /
daily / weekly, plus a separate DeepCode monthly budget), and live enforcement
that gates every `/api/sonoma` request. The one thing missing is the part that
makes it a business: **there is no way to actually pay.**

Concrete gaps found in the code:

- `src/context/SubscriptionContext.tsx` hardcodes every user to `plan: 'max'`,
  `isSubscribed: true`, `credits: 999999`. All mutators are no-ops. So the UI
  believes everyone is a paying Max customer.
- `src/app/(app)/subscribe/checkout/page.tsx` — `handleSubscribe()` is a `// mock`
  with a `setTimeout` redirect. Tiers are priced in fictional "ads per week."
- `prisma/schema.prisma` — `User.plan` is a plain string, `@default("free")`,
  and is **never written by any real flow.**
- No Stripe/PayPal/checkout dependency exists anywhere in the repo.
- Legacy tiers (`go` / `builder` / `plus`) still coexist with `free` / `pro` /
  `max` via `normalizePlan` in `src/lib/limits/plans.ts` — two plan taxonomies.

The outcome we want: a signed-in user can upgrade to Pro or Max in two clicks,
`User.plan` reflects real subscription state, limits tighten/loosen
automatically, and cancellation flows back down to `free`. The existing limits
engine (`src/lib/limits/usage.ts`) stays the single source of truth for what a
plan is allowed to do — billing only decides *which* plan a user is on.

## 2. The product (what the user experiences)

**The upgrade moment lives at the limit wall, not on a pricing page.** Today when
a free user hits their hourly cap, `checkTokenAllowance` blocks them with a dead
end. That block is the highest-intent moment in the whole app. We turn it into
the offer: "You're out of messages for this hour. Pro gives you 10x the budget —
upgrade and keep going." One click → Stripe Checkout → back in the conversation,
now on Pro, limit already lifted.

Three surfaces, one coherent story:

1. **The wall** (`checkTokenAllowance` block state, rendered in `useChat`): an
   inline upgrade CTA instead of a generic "limit reached" error.
2. **The Limits page** (`src/app/(app)/session/page.tsx`, already linked in the
   sidebar): becomes the billing home — current plan, renewal date, Upgrade /
   Manage buttons. It already renders plan + budgets, so this is where a user
   naturally checks "what am I on and what do I get."
3. **The pricing page** (`/subscribe`, `/pricing`): real Pro/Max feature lists
   and working CTAs, "ads per week" copy deleted.

Cancel/manage is Stripe's hosted Customer Portal — no custom billing UI to build
or maintain.

## 3. Data model (`prisma/schema.prisma`)

Add real subscription state plus webhook idempotency. `User.plan` stays the field
the limits engine reads — we just start writing it truthfully.

```prisma
model User {
  // ...existing...
  stripeCustomerId String?       @unique
  subscription     Subscription?
}

model Subscription {
  id                   String   @id @default(cuid())
  userId               String   @unique
  stripeSubscriptionId String   @unique
  stripePriceId        String
  status               String   // active | trialing | past_due | canceled | incomplete
  plan                 String   // 'pro' | 'max' — mirrored onto User.plan
  currentPeriodEnd     DateTime
  cancelAtPeriodEnd    Boolean  @default(false)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  user                 User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model ProcessedWebhookEvent {
  id        String   @id            // Stripe event id — dedupe key
  createdAt DateTime @default(now())
}
```

Then `npx prisma migrate dev --name add_billing`.

## 4. Config & env (`src/lib/env.ts`)

Add to the zod schema (server-only unless noted):
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (client)
- `STRIPE_PRICE_PRO`, `STRIPE_PRICE_MAX` (Stripe price ids)

Install `stripe @stripe/stripe-js`.

New `src/lib/billing/stripe.ts`: a singleton `new Stripe(env.STRIPE_SECRET_KEY)`
plus `PRICE_TO_PLAN` / `PLAN_TO_PRICE` maps keyed on the `LimitPlan` type from
`src/lib/limits/plans.ts`, so billing and limits can never drift apart.

## 5. Server routes (new)

All under `src/app/api/billing/`. Auth via the existing session helper
(`src/lib/auth/session.ts`); the webhook is the only unauthenticated one and is
verified by Stripe signature instead.

- **`checkout/route.ts`** (POST) — find-or-create the Stripe customer (persist
  `stripeCustomerId`), create a Checkout Session (`mode: 'subscription'`, chosen
  price, success/cancel → `/session`), return `{ url }`.
- **`portal/route.ts`** (POST) — create a Billing Portal session for the user's
  `stripeCustomerId`, return `{ url }`. Powers Manage / cancel / update card.
- **`webhook/route.ts`** (POST, `runtime = 'nodejs'`, raw body) — verify with
  `STRIPE_WEBHOOK_SECRET`; dedupe on `ProcessedWebhookEvent`. Handle:
  - `checkout.session.completed`, `customer.subscription.created|updated` →
    upsert `Subscription`; set `User.plan` to the mapped tier when status is
    `active`/`trialing`.
  - `customer.subscription.deleted` or status `past_due`/`canceled` →
    `User.plan = 'free'`.

Exclude the webhook path from any CSRF/auth middleware.

## 6. Replace the mock client state

- **`src/context/SubscriptionContext.tsx`** — stop hardcoding Max. Source `plan`
  from real data: `/api/session/usage` already returns `plan`, so no new endpoint
  is needed. Expose `plan`, `isSubscribed`, and async `openCheckout(plan)` /
  `openPortal()` that call the new routes and redirect to the returned Stripe URL.
- **`src/app/(app)/subscribe/page.tsx` + `checkout/page.tsx`** — replace the mock
  `handleSubscribe` with `openCheckout`. Delete "ads per week" copy; real Pro/Max
  feature lists.
- **`src/components/ui/pricing-section.tsx` / `pricing-card.tsx` /
  `src/app/pricing/page.tsx`** — wire CTAs to `openCheckout`.
- **`src/hooks/useChat.ts`** — when a send is blocked by the limit wall, render
  the inline upgrade CTA (calls `openCheckout`) instead of a plain error.

## 7. Surface subscription state

`src/app/(app)/session/page.tsx` gains a billing section at the top: current plan,
`currentPeriodEnd` renewal date, `cancelAtPeriodEnd` note if pending, and an
Upgrade (checkout) or Manage (portal) button.

## 8. Unify the plan taxonomy

`normalizePlan` already folds `go|builder|plus → pro`; keep that for reading
legacy rows, but only ever **write** `free|pro|max`. Remove legacy tiers from the
subscribe UI so no new signup can land on `go`/`builder`/`plus` again.

## 9. Files touched

| File | Change |
|---|---|
| `prisma/schema.prisma` | +billing fields, `Subscription`, `ProcessedWebhookEvent` |
| `src/lib/env.ts` | +Stripe env vars |
| `src/lib/billing/stripe.ts` | NEW — client + price/plan maps |
| `src/app/api/billing/checkout/route.ts` | NEW |
| `src/app/api/billing/portal/route.ts` | NEW |
| `src/app/api/billing/webhook/route.ts` | NEW |
| `src/context/SubscriptionContext.tsx` | remove hardcoded Max; real state + checkout/portal |
| `src/app/(app)/subscribe/{page,checkout/page}.tsx` | real checkout, drop "ads/week" copy |
| `src/components/ui/pricing-*.tsx`, `src/app/pricing/page.tsx` | wire CTAs |
| `src/app/(app)/session/page.tsx` | billing / manage section |
| `src/hooks/useChat.ts` | upgrade CTA at the limit wall |
| `src/lib/limits/plans.ts` | stop emitting legacy tiers |

## 10. Verification (end to end)

- `stripe listen --forward-to localhost:3000/api/billing/webhook` + test cards.
- Upgrade: free user → Checkout → `checkout.session.completed` → `User.plan = 'pro'`
  → `checkTokenAllowance` immediately reflects `PLAN_LIMITS.pro`.
- Idempotency: replay the same event id → `ProcessedWebhookEvent` blocks
  double-processing.
- Downgrade: cancel in portal → `customer.subscription.deleted` → `plan = 'free'`
  → limits tighten on the next request.
- Limit wall: exhaust the hourly budget on free → CTA renders → checkout → back in
  the conversation on Pro with the budget lifted.

## 11. Out of scope / follow-ups

- Email receipts / dunning. Note: `src/app/api/auth/forgot-password/route.ts:44`
  also has an unshipped email TODO — pick one email provider (Resend/SendGrid)
  and reuse it for both.
- Proration UX, annual pricing, tax/VAT.
- Reconcile the duplicate usage surfaces (`/session`, `/usage`, `/api-dashboard`).
- Confirm the canonical chat pipeline: `useChat` posts to `/api/chat` while
  `/api/sonoma` ("external AI APIs disabled") runs in parallel. Both share the
  limits module, so billing is unaffected either way, but worth resolving.
