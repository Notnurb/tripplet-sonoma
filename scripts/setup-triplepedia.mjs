#!/usr/bin/env node
/**
 * Applies db/schema.sql (the non-Prisma tables) to the Neon database.
 * Run with: npm run setup:db   (reads DATABASE_URL from .env / .env.local)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Lightweight .env loader (DATABASE_URL only).
for (const file of ['.env.local', '.env']) {
    const p = join(root, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !(m[1] in process.env)) {
            process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error('Missing DATABASE_URL. Set it in .env to your Neon connection string.');
    process.exit(1);
}

const schema = readFileSync(join(root, 'db', 'schema.sql'), 'utf8');

const client = new pg.Client({
    connectionString,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
});

try {
    await client.connect();
    await client.query(schema);
    console.log('✅ Applied db/schema.sql to Neon.');
    console.log('Reminder: run `npx prisma migrate deploy` to create the Prisma-managed tables.');
} catch (err) {
    console.error('❌ Failed to apply schema:', err.message);
    process.exit(1);
} finally {
    await client.end();
}
