import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped capture for the underlying error behind a Better Auth failure.
 *
 * Better Auth catches internal errors (e.g. a Prisma connection failure) and
 * returns an opaque `500` with an empty body — it does not throw, so a wrapping
 * try/catch never sees the real cause. We run each request inside this store and
 * let the `onAPIError.onError` hook stash the real error here, so the route
 * handler can translate it into a specific, machine-readable error code.
 *
 * AsyncLocalStorage keeps this per-request: concurrent requests each get their
 * own `{ error }` slot and never read each other's cause.
 *
 * Lives in its own module to avoid a circular import between the Better Auth
 * instance (which writes) and the route handler (which reads).
 */
export interface AuthErrorSlot {
    error?: unknown;
}

export const authErrorStore = new AsyncLocalStorage<AuthErrorSlot>();
