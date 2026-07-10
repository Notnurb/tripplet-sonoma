# Security

*Full disclosure policy: [SECURITY.md](../../SECURITY.md). This page summarizes what's actually implemented and where.*

## Controls in place

| Control | Where | Notes |
|---|---|---|
| SSRF hardening | `src/lib/ai/websearch.ts` | Blocks private/loopback/link-local/metadata hosts, including hex/decimal IP-literal encodings; re-validates every redirect hop; byte-caps response bodies |
| Untrusted code isolation | `src/lib/python/run.ts` | `run_python` runs in a memory-capped, `terminate()`-timeout-killed worker thread (Pyodide/WASM) |
| Client-side sandboxing | `src/lib/sandbox/trippletLinux.ts` | `run_bash` executes only in the user's own in-browser v86 VM — never server-side |
| Auth | `src/lib/auth/` | bcrypt (cost 12) + HS256 JWT via `jose`; timing-safe comparisons; HMAC-signed expiring tokens for the `/dev` panel unlock |
| Abuse brakes | `src/lib/security/rate-limit.ts` | Per-user/IP limits with spoof-resistant client addressing (rightmost `x-forwarded-for`); strict budgets on login/register/password-reset/dev-unlock; shared Redis (Upstash/Vercel KV REST) when configured, failing open to per-instance LRU otherwise |
| Prompt-injection posture | `src/lib/security/sanitize.ts` | Web content is stripped of directives/envelope tags and declared untrusted in the system prompt; client-supplied `system` messages are stripped server-side on the Sonoma route |
| CI gates | `.github/workflows/ci.yml` | type-check, lint, unit suite, `npm audit --omit=dev --audit-level=high` on every push |

## Admin-gated server-side execution

Two routes spawn real child processes server-side and are worth knowing about specifically:

- `src/app/api/cloud-env/command/route.ts` — runs user-provided Python workspaces in an isolated per-slug temp directory (`os.tmpdir()/tripplet-cloud-envs/<slug>`). The slug is regex-validated (`^[a-z0-9-]{1,64}$`) before it ever touches a filesystem path, and the route requires a non-guest `userId` from `auth()`.
- `src/app/api/looptrain/start/route.ts` — spawns `python3` with array-form `spawn()` args (no shell string concatenation). Gated behind both `auth()` **and** an `ADMIN_USER_IDS` allowlist read from env — not just "logged in."

Both use `spawn(cmd, argsArray)` rather than a shell string, which avoids the classic shell-injection class of bug even though user input flows into the args.

## Incident history

One real incident (2026): secrets committed to the repo, plus SQL-injection findings. Fully remediated — credentials rotated, SQL parameterized, the prebuild env gate (`scripts/check-env.mjs`) added, regression tests written. The closed report lives at [`docs/security/CRITICAL_SECURITY_AUDIT.md`](../security/CRITICAL_SECURITY_AUDIT.md).

**Treat any credential that ever appeared in git history as permanently burned** — rotating locally isn't enough once something's in history, even after a force-push or history rewrite.

## Known gaps

- `POST /api/auth/forgot-password` has a `// TODO: Send reset email via email service` — the token-generation half of the flow exists but no email actually goes out yet. See the full audit report in `docs/audits/` for current status.

## Reporting

Email **alex3.brunton@gmail.com**. Do not open a public issue for security reports.
