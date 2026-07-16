# Issues — found 2026-07-11, all resolved in this pass

16 issues total, split into four equal groups of 4. Groups 1–3 are technical.
Group 4 is the separate section for **psychological / non-technical** issues —
things that don't crash anything but make people *feel* the app is buggy,
unfair, or untrustworthy, and quietly drive them away.

Every issue below was fixed in the same pass that wrote this file; each entry
names the file(s) changed.

---

## Group 1 — Security (technical)

1. **SSRF + DNS-rebinding hole in the Triplepedia URL extractor.**
   `src/app/api/triplepedia/extract/route.ts` fetched an arbitrary
   user-supplied URL with a plain `fetch(..., redirect: 'follow')` guarded
   only by hostname *string* checks — the exact class of hole already fixed
   in the web-search path (`review.md`, Round 4): a public-looking domain
   resolving to `10.x.x.x`, or a redirect hop to an internal host, reached
   internal infrastructure from an authenticated request.
   **Fixed:** `assertFetchableUrl()` (resolver-level, per-hop) is now exported
   from `src/lib/ai/websearch.ts` and the extractor follows redirects
   manually, re-validating every hop.

2. **Anyone could mass-publish Triplepedia articles without an account.**
   `POST /api/triplepedia/articles` was unauthenticated, accepted up to 500
   articles per request, defaulted them straight to `status='published'`, and
   had no field-length caps — a wide-open vandalism/spam vector for the public
   knowledge base (spam content is also a top reason users write a platform
   off). **Fixed:** unauthenticated submissions are forced to `pending`
   (human review before they're public); only signed-in users can publish
   directly; title/slug/summary/category get length caps; batch size capped
   at 100.

3. **Changing your password did not log out stolen sessions.**
   Password *reset* revokes all previously-issued tokens
   (`src/lib/auth/session-store.ts`), but password *change*
   (`/api/user/password`) didn't — the main reason a user changes a password
   ("I think someone has my account") left the attacker's 7-day token fully
   valid. **Fixed:** the route now calls `invalidateSessionsNow()` and
   re-issues a fresh cookie so the user's own session survives.

4. **Changing your email left a stale-identity token live everywhere.**
   `/api/user/email` updated the DB but the JWT still carried the old email,
   and old sessions were never revoked. **Fixed:** same treatment — revoke
   all prior tokens, re-issue a fresh token carrying the new email.

## Group 2 — Correctness & data integrity (technical)

1. **Password-change route bypassed the shared password policy.**
   It re-implemented its own checks (min 8 / max 256), skipping the
   NIST-style common-password blocklist and the 128-char cap in
   `passwordSchema` — so `password1` was rejected at registration but accepted
   as a *new* password later. **Fixed:** `/api/user/password` now validates
   with the shared `passwordSchema`.

2. **`/api/health` leaked raw database error strings to anonymous callers.**
   On DB failure it returned `error.message` verbatim, which can include
   hostnames/connection details. **Fixed:** generic client-facing detail;
   full error stays in server logs.

3. **Triplepedia reaction counts were infinitely inflatable by one client.**
   The reaction endpoint only had the generic 200/hr search limiter, keyed per
   IP overall — one person could pump a single article's "🤯" count forever,
   making the community numbers meaningless (fake-looking numbers also erode
   trust — see Group 4). **Fixed:** the limiter key is now scoped per
   IP *per article* with a tight budget.

4. **View counts had the same inflation hole.** Same fix, same per-article
   scoped limiter key (`/api/triplepedia/view`).

## Group 3 — Robustness & consistency (technical)

1. **Guest-limit rejection was not machine-readable.** `/api/chat` returned a
   bare `{ error }` string at the 15-message wall, so the client couldn't
   distinguish "you hit the free limit" from a real failure and render an
   account-creation path instead of an error state. **Fixed:** the response
   now carries `code: 'guest_limit'` (plus the friendlier copy — Group 4.1).

2. **Uploads shared the search rate-limit bucket.**
   `/api/triplepedia/upload` reused `searchLimiter` with the same token, so a
   heavy search session silently blocked image uploads (and vice versa) —
   cross-feature interference that presents as "uploads randomly fail".
   **Fixed:** dedicated `uploadLimiter` + `LIMITS.upload`.

3. **Batch article insert did up to 500 sequential DB round-trips** in one
   request — slow-loris-adjacent load on the pool from a single caller.
   **Fixed:** batch capped at 100 per request (with Group 1.2's
   pending-by-default, abuse is contained at both layers).

4. **Two public Triplepedia GETs had no rate limit at all.**
   `/api/triplepedia/article` and `/api/triplepedia/random` were the only
   routes in the family with no limiter (each runs 1–2 DB queries per hit).
   **Fixed:** both now use the standard search limiter.

## Group 4 — Psychological / non-technical (separate section)

These are the "nothing is technically broken, but people leave" issues.

1. **The guest wall felt like a bait-and-switch.** After 15 messages a guest
   got a curt *"Guest message limit reached. Create a free account to
   continue."* — mid-conversation, transactional, and with no reassurance
   their conversation survives. That moment is the single highest-stakes
   conversion point in the app. **Fixed:** copy now leads with what they get
   ("You've used all 15 free messages — create a free account (takes a few
   seconds) to keep going right where you left off.") and ships with
   `code: 'guest_limit'` so the UI can present sign-up instead of an error.

2. **Rate-limit copy scolded the user.** *"Too many requests. Please slow
   down."* reads as blame and gives no recovery path — users experience it as
   "the app is broken and rude about it". **Fixed:** rewritten to a neutral,
   time-bounded message ("You're moving faster than we can keep up — give it
   a minute and try again."), keeping the `Retry-After` header.

3. **Internal jargon surfaced to end users.** Public Triplepedia endpoints
   answered *"Database not configured"* — infrastructure vocabulary that
   reads as "this product is held together with tape". **Fixed:** the
   user-facing copy on those routes is now a friendly, temporary-sounding
   message; the operator-facing detail stays in server logs.

4. **Registration dead-ended people who already had an account.**
   *"User already exists"* is a wall: it names the failure and offers no next
   step, so a returning user who forgot they'd registered bounces instead of
   signing in. **Fixed:** the message now routes them forward — "An account
   with this email already exists — try signing in instead."
