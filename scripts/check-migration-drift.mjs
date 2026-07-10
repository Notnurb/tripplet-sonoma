#!/usr/bin/env node
/**
 * Schema-drift guard.
 *
 * Compares the LIVE database (via DIRECT_URL — the unpooled connection, same as
 * migrations use) against `prisma/schema.prisma` and fails if they differ.
 *
 * Catches the exact class of confusion that cost us an investigation last time:
 * the DB and the repo silently disagreeing (a hand-applied change, a migration
 * that never ran, a model edited without a migration). A non-empty diff here is
 * a hard stop.
 *
 * Run in CI / pre-deploy:  npm run check:drift
 *
 * NOTE: intentionally NOT wired into `prebuild` by default — it needs live DB
 * access and a transient Neon hiccup should not block an unrelated deploy. Wire
 * it into a CI job (or prebuild) once you're comfortable with that trade-off.
 */

import { spawnSync } from 'node:child_process';
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';

if (process.env.SKIP_ENV_FILE !== '1') {
    const envPath = path.join(process.cwd(), '.env');
    if (existsSync(envPath)) loadDotenv({ path: envPath });
}

const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!directUrl) {
    console.error('[check:drift] DIRECT_URL (or DATABASE_URL) is not set — cannot compare against the live DB.');
    process.exit(1);
}

console.log('[check:drift] Diffing live DB (DIRECT_URL) against prisma/schema.prisma …');

const result = spawnSync(
    'npx',
    [
        'prisma',
        'migrate',
        'diff',
        '--from-url',
        directUrl,
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--script',
    ],
    { encoding: 'utf8' },
);

if (result.status !== 0) {
    console.error('[check:drift] prisma migrate diff failed to run:');
    console.error(result.stderr || result.stdout);
    process.exit(1);
}

const script = (result.stdout || '').trim();

// An empty diff prints a single comment line meaning "no changes".
const noChanges =
    script.length === 0 ||
    /No difference detected|empty migration|--\s*This is an empty migration/i.test(script);

if (noChanges) {
    console.log('[check:drift] ✓ No drift — live DB matches prisma/schema.prisma.');
    process.exit(0);
}

console.error(
    '\n❌ [check:drift] SCHEMA DRIFT DETECTED. The live database does not match ' +
        'prisma/schema.prisma. The SQL below would be required to bring the DB in ' +
        'line with the repo — investigate before deploying (a missing migration, a ' +
        'hand-applied change, or an un-migrated model edit):\n',
);
console.error(script);
process.exit(1);
