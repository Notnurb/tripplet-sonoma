// SERVER-ONLY access control for the /dev panel — a stopgap chat surface only
// reachable while OUTAGE_ACTIVE is true (see src/lib/outage.ts).
//
// Never import this from a 'use client' component: it must not end up in the
// browser bundle. The flow is:
//   1. The client POSTs the typed password to /api/dev/unlock.
//   2. On a match, that route sets an HttpOnly cookie holding a signed,
//      expiring token (created here).
//   3. /api/sonoma verifies that cookie before honoring the Groq key override.
//
// The password comes from the DEV_PANEL_PASSWORD env var. In production it is
// REQUIRED: if unset, the panel simply cannot be unlocked (checkDevPassword
// always fails) — no secret ever lives in the repo for deployed environments.
// Outside production a fixed dev-only fallback keeps `npm run dev` working
// with zero setup; it has no value in prod.
//
// ⚠️ Deploy note: set DEV_PANEL_PASSWORD in Vercel before relying on /dev.

import { createHmac, timingSafeEqual } from 'crypto';

const DEV_ONLY_FALLBACK = 'tripplet-dev-panel-local-only';

export const DEV_UNLOCK_COOKIE = 'dev_unlock';
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function getPassword(): string | null {
    const fromEnv = process.env.DEV_PANEL_PASSWORD;
    if (fromEnv) return fromEnv;
    return process.env.NODE_ENV === 'production' ? null : DEV_ONLY_FALLBACK;
}

function sign(expiry: string, password: string): string {
    // Keyed by the password itself plus JWT_SECRET when available, so rotating
    // either one invalidates all outstanding tokens.
    return createHmac('sha256', password + (process.env.JWT_SECRET ?? ''))
        .update(expiry)
        .digest('hex');
}

function safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    // timingSafeEqual throws on length mismatch; compare lengths first. This
    // leaks only the length, which is acceptable.
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function checkDevPassword(attempt: string): boolean {
    const password = getPassword();
    if (!password) return false; // prod without DEV_PANEL_PASSWORD: panel disabled
    return safeEqual(attempt, password);
}

export function createDevToken(): string {
    const password = getPassword();
    if (!password) throw new Error('DEV_PANEL_PASSWORD is not configured');
    const expiry = String(Date.now() + TOKEN_TTL_MS);
    return `${expiry}.${sign(expiry, password)}`;
}

export function verifyDevToken(token: string | undefined | null): boolean {
    const password = getPassword();
    if (!password || !token) return false;
    const dot = token.indexOf('.');
    if (dot === -1) return false;
    const expiry = token.slice(0, dot);
    const mac = token.slice(dot + 1);
    if (!/^\d+$/.test(expiry) || Number(expiry) < Date.now()) return false;
    return safeEqual(mac, sign(expiry, password));
}
