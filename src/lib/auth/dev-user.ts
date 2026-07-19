// SERVER-ONLY: makes the dev-mode "Tripplet Dev" account (src/lib/dev-mode.ts)
// a real database row so foreign keys behave like any regular account —
// conversations, messages, uploads and AIUsage all attach to it.
//
// Never throws: auth() promises to degrade rather than fail, so a missing or
// unreachable database just means chat history won't persist (same as any
// account when the DB is down). Without DATABASE_URL there is nothing to
// upsert — identity lookups are short-circuited in user-store.ts instead.

import prisma from '@/lib/db/prisma';
import { DEV_USER } from '@/lib/dev-mode';

const RETRY_INTERVAL_MS = 30_000;

let ensured = false;
let lastAttempt = 0;
let warned = false;

export async function ensureDevUser(): Promise<void> {
    if (ensured || !process.env.DATABASE_URL) return;
    const now = Date.now();
    if (now - lastAttempt < RETRY_INTERVAL_MS) return;
    lastAttempt = now;
    try {
        await prisma.user.upsert({
            where: { id: DEV_USER.id },
            update: {},
            create: {
                id: DEV_USER.id,
                email: DEV_USER.email,
                name: DEV_USER.name,
                passwordHash: null,
            },
        });
        ensured = true;
    } catch (error) {
        if (!warned) {
            warned = true;
            console.warn(
                '[dev-mode] Could not upsert the Tripplet Dev user row; chat persistence may fail until the database is reachable.',
                error,
            );
        }
    }
}
