-- UserMemory is written via raw SQL (src/lib/db/user-memory.ts), which
-- bypasses Prisma's client-side @updatedAt fill. Without a database-level
-- default, every raw INSERT that omits "updatedAt" fails the NOT NULL
-- constraint — which broke memory add/import in production.
--
-- Pairs with @default(now()) on UserMemory.updatedAt in schema.prisma.
-- Safe to run repeatedly: SET DEFAULT is idempotent.
ALTER TABLE "UserMemory" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
