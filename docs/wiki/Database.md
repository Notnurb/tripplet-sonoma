# Database

PostgreSQL, hosted on [Neon](https://neon.tech). Two access paths: Prisma ORM for the app's core tables, and a raw `pg` pool (`src/lib/db/neon.ts`, `query`/`queryOne`) for tables outside the Prisma schema.

## Connections

- `DATABASE_URL` — pooled runtime connection, used by the app at request time.
- `DIRECT_URL` — unpooled, used only by `prisma migrate deploy` during build (`npm run build` runs migrations before `next build`).

## Prisma schema (`prisma/schema.prisma`)

| Model | Purpose |
|---|---|
| `User` | Core account: email, bcrypt `passwordHash`, profile fields. Also holds Better Auth's `emailVerified: Boolean` field (kept as `Boolean`, not `DateTime`, specifically because Better Auth's email-verification flow writes to it — even though Better Auth itself is removed, see [Auth](./Auth.md)). |
| `Conversation` | One per chat thread; soft-deleted via `deletedAt`. |
| `Message` | Chat turns; `attachments` is a `Json` blob, `extendedThink` flags whether extended reasoning was used. |
| `FileUpload` | S3-backed uploads, soft-deleted. |
| `AIUsage` | Per-request token/cost tracking for usage dashboards. |
| `Session` | The app's own JWT-adjacent session table (custom auth) — kept deliberately separate from `AuthSession` below to avoid collisions. |
| `AuthSession`, `Account`, `Verification` | **Legacy Better Auth tables.** Field names/types mirror Better Auth's canonical schema exactly (don't rename without updating the matching `session.fields.*` override that used to live in `better-auth.ts`). Nothing reads or writes them today. |
| `PasswordResetToken` | Forgot-password flow tokens. |
| `UserMemory` | Persistent memory entries; `source` distinguishes `explicit` (user-stated) vs `auto` (inferred). |
| `TelegramBot`, `TelegramMessage` | Per-user Telegram bot bindings and their conversation history; messages cascade-delete when a bot is disconnected. |
| `MessageFeedback` | Thumbs up/down per message, aggregated into lightweight system-prompt preference signals (e.g. "user prefers shorter answers"). One rating per `(userId, messageId)`; re-rating overwrites. `messageId` is a client-generated uuid, not an FK — not every chat bubble makes it into the persisted `Message` table (regenerations, in-flight messages). |

## Non-Prisma tables (`db/schema.sql`)

Run via `npm run setup:db` (`scripts/setup-triplepedia.mjs`). Backs Triplepedia and other raw-SQL-accessed features that don't need Prisma's type safety or migration overhead.

## Migration workflow

1. Edit `prisma/schema.prisma`.
2. `npx prisma migrate dev --name <description>` locally (uses `DIRECT_URL`).
3. Commit the generated migration under `prisma/migrations/`.
4. `npm run build` runs `prisma migrate deploy` before `next build` — this is what actually applies migrations in production (Vercel build step), not a manual step.
5. `scripts/check-migration-drift.mjs` (`npm run check:drift`) catches schema/migration drift before it becomes a prod incident.

The Prisma client itself is generated automatically via the `postinstall` hook — you never need to run `prisma generate` by hand after `npm install`.
