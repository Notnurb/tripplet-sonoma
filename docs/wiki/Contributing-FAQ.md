# Contributing FAQ

*Full details: [CONTRIBUTING.md](../../CONTRIBUTING.md). This page is the condensed, question-shaped version plus common gotchas.*

**How do I get set up?**
Read [CLAUDE.md](../../CLAUDE.md) first — it's the architecture source of truth. Then:
```bash
cp .env.template .env   # fill in real values
npm install              # generates the Prisma client via postinstall
npm run dev
```

**What has to pass before I open a PR?**
Exactly what CI enforces (`.github/workflows/ci.yml`):
```bash
npm run type-check
npm run lint
npm run check:docs   # doc freshness — referenced repo paths must resolve
npm run test:unit
```

**Does my change need a test?**
If it's security-sensitive or touches data integrity, yes — see [`tests/README.md`](../../tests/README.md)'s "test what can hurt you" philosophy. Keep tests real: actual `NextRequest`s, real Python execution, real HTML fixtures. Mock only at network/process boundaries.

**I added a new env var — now what?**
Document it in `.env.template`. If it's required in production, add it to the `REQUIRED` list in `scripts/check-env.mjs` so the prebuild gate catches a missing value loudly instead of failing mysteriously at runtime.

**Untrusted content (web results, fetched pages, memory) — do I need to do anything special?**
Yes — route it through `sanitizeExternalContent` (`src/lib/security/sanitize.ts`) before it reaches model context.

**Why does chat return 503 sometimes?**
Either no inference key is configured (`GROQ_API_KEY` / `OPENCODE_ZEN_API_KEY`, see [Deployment](./Deployment.md)), or you're hitting `/api/v1/chat/completions` — the developer API surface exists but inference is intentionally disabled there right now.

**My local clone won't accept chat input at all.**
Check `OUTAGE_ACTIVE` in `src/lib/outage.ts` — it's a site-wide kill switch that also gates the `/dev` panel.

**Why are there two auth-looking Prisma models (`Session` and `AuthSession`)?**
`Session` is the live custom-JWT session table. `AuthSession`, `Account`, `Verification` are leftovers from Better Auth, which was fully removed in July 2026 but whose tables are harmless to leave in the schema. Don't read from or write to the Better Auth tables. See [Auth](./Auth.md).

**Is `neon_auth` live?**
No — legacy leftover from a Supabase→Neon migration. Don't build against it.

**`run_bash` results look weird / the model seems to not see command output.**
Expected: `run_bash` executes in the *user's* browser VM, so real stdout is shown to the user but the model itself only gets an acknowledgment — it narrates around output it structurally can't see. `run_python` doesn't have this quirk since it runs server-side and the model gets the real result.

**Can I `curl` from inside the sandboxed Linux VM?**
No — it's busybox with no network inside the guest. Great for shell demos and filesystem work, not for anything needing egress.

**Who reviews security-sensitive PRs?**
A second set of eyes is strongly preferred on anything touching `src/lib/auth`, `src/lib/security`, or the Sonoma route — these are the blast-radius files.

**Commit message convention?**
Imperative mood, one concern per commit. Prefix with the area when it helps (`auth:`, `sonoma:`, `rate-limit:`, `docs:`).
