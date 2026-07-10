# Security Policy

## Reporting a vulnerability

Email **alex3.brunton@gmail.com** with the details. Please do not open a public
issue for security reports. You'll get an acknowledgment within a few days;
fixes ship as fast as severity demands.

## Scope

The deployed Tripplet app and this repository: the Next.js app (`src/`), the
optional Python backend (`services/backend`), and the OpenSonoma agent
(`services/opensonoma-agent`).

## What's already in place

- **SSRF hardening** on all model-driven outbound fetches: private/loopback/
  link-local/metadata hosts blocked (including hex/decimal IP-literal
  encodings), every redirect hop re-validated, response bodies byte-capped
  (`src/lib/ai/websearch.ts`).
- **Untrusted code isolation**: `run_python` executes in a memory-capped,
  timeout-killed worker thread (Pyodide/WASM); `run_bash` executes only in the
  user's own in-browser VM — never on the server.
- **Auth**: bcrypt (cost 12) + HS256 JWT cookies via `jose`; timing-safe
  comparisons and HMAC-signed expiring tokens for the dev panel, which is
  additionally gated behind outage mode and requires `DEV_PANEL_PASSWORD` in
  production.
- **Abuse brakes**: per-user/IP rate limits with spoof-resistant client
  addressing (rightmost `x-forwarded-for`), strict brute-force budgets on
  login/register/password-reset/dev-unlock. Counters automatically use a
  shared Redis store (Upstash / Vercel KV REST env vars) for global,
  cold-start-proof limits, failing open to per-instance LRU when absent.
- **Prompt-injection posture**: web content is declared untrusted in the
  system prompt; client-supplied `system` messages are stripped server-side.
- **CI gates**: type-check, lint, the unit suite (`tests/unit/`), and
  `npm audit --omit=dev --audit-level=high` on every push.

## Known incomplete flows

- **Password reset does not send email.** `/api/auth/forgot-password` validates
  input and generates a token, but wiring it to an email provider is a `// TODO`
  — no reset email is delivered yet. Add Resend/SendGrid/etc. before relying on
  the flow. (Tokens are not exposed in the response, so this is a missing
  feature, not a leak.)

## Incident history

One real incident (2026): secrets committed to the repo plus SQL-injection
findings. Fully remediated — credentials rotated, SQL parameterized, prebuild
env gate added, regression tests written. The closed report lives at
`docs/security/CRITICAL_SECURITY_AUDIT.md`; treat any credential that ever
appeared in git history as permanently burned.
