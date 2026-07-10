# Contributing

Thanks for working on Tripplet. This is a small, fast-moving project; these
rules keep it coherent.

## Before you start

1. Read **[CLAUDE.md](./CLAUDE.md)** — it's the architecture source of truth
   (data flow, auth model, modes/tones, key files, and the UI rules you must
   not break).
2. Copy the env template and fill it in:
   ```bash
   cp .env.template .env
   ```
3. Install and run:
   ```bash
   npm install          # generates the Prisma client via postinstall
   npm run dev
   ```

## The definition of done

Every change must pass what CI enforces (`.github/workflows/ci.yml`) before it
merges. Run it locally:

```bash
npm run type-check   # tsc --noEmit — no type errors
npm run lint         # ESLint — clean
npm run check:docs   # doc freshness — referenced repo paths must resolve
npm run test:unit    # Vitest — all green
```

- **New security-sensitive or data-integrity logic ships with a test.** See
  [`tests/README.md`](./tests/README.md) for what belongs in `tests/unit/` and
  the "test what can hurt you" philosophy. Keep tests real (actual
  `NextRequest`s, real Python execution, HTML fixtures) — mock only at network
  and process boundaries.
- **Never commit secrets.** `.env` is gitignored; use `.env.template` to
  document new variables. If a new var is required in production, add it to the
  `REQUIRED` list in `scripts/check-env.mjs` so the prebuild gate catches a
  missing value loudly.
- **Keep docs honest.** If you move or rename a file that the living docs
  (README, CLAUDE.md, `docs/wiki`, `docs/opensonoma`, `docs/dev`,
  `docs/security`) reference by path, update the reference —
  `npm run check:docs` fails CI when a
  backtick-wrapped repo path no longer resolves. (Dated snapshots under
  `docs/planning` and `docs/audits` are intentionally exempt.)
- **External/untrusted content** (web results, fetched pages, user memory) must
  pass through `sanitizeExternalContent` (`src/lib/security/sanitize.ts`) before
  it reaches model context.
- **Match the surrounding style.** No new formatting churn in files you're not
  otherwise touching.

## Review

Open a PR against `main`. CI must be green. A second set of eyes on anything
touching `src/lib/auth`, `src/lib/security`, or the Sonoma route is strongly
preferred — these are the blast-radius files.

## Commit messages

Imperative mood, one concern per commit. Reference the area you touched
(`auth:`, `sonoma:`, `rate-limit:`, `docs:`) when it helps.
