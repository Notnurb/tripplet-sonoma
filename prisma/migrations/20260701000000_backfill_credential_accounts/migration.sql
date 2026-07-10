-- Backfill Better Auth credential accounts from the legacy User.passwordHash.
--
-- The legacy JWT auth stores the bcrypt hash on User.passwordHash. Better Auth
-- reads credentials from Account.password (providerId = 'credential',
-- accountId = the user's id). This migration creates that Account row for every
-- existing user who has a password but no credential account yet, copying the
-- bcrypt hash verbatim.
--
-- Safe to run repeatedly: the NOT EXISTS guard makes it idempotent, and it is a
-- no-op for users without a passwordHash (e.g. OAuth-only or brand-new DBs).
--
-- Pairs with the bcrypt hash/verify override in src/lib/auth/better-auth.ts —
-- without that override Better Auth would try to scrypt-verify these bcrypt
-- hashes and every migrated user would be locked out.

INSERT INTO "Account" (
    "id",
    "userId",
    "accountId",
    "providerId",
    "password",
    "createdAt",
    "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    u."id",
    u."id",
    'credential',
    u."passwordHash",
    now(),
    now()
FROM "User" u
WHERE u."passwordHash" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM "Account" a
      WHERE a."userId" = u."id"
        AND a."providerId" = 'credential'
  );
