import { cookies } from 'next/headers';
import { verifyToken } from './jwt';
import { sessionsInvalidatedAt } from './session-store';

/**
 * Server-side auth helper used by ~38 API routes.
 *
 * Resolves the user from the `auth_token` JWT cookie (HS256, signed with
 * JWT_SECRET — see ./jwt.ts). Returns { userId, email } for an authenticated
 * user, or { userId: null } for a guest. Never throws — any failure degrades
 * to guest.
 */
export async function auth(): Promise<{ userId: string | null; email?: string }> {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value;
        if (token) {
            const payload = await verifyToken(token);
            // Reject tokens issued before the user's last logout/password-reset
            // — a signature-valid, non-expired JWT is not enough on its own.
            const cutoff = await sessionsInvalidatedAt(payload.userId);
            const issuedAtMs = Number(payload.iat) * 1000;
            if (cutoff > 0 && issuedAtMs < cutoff) {
                return { userId: null };
            }
            return { userId: payload.userId, email: payload.email };
        }
    } catch {
        // Invalid/expired token — treat as guest.
    }
    return { userId: null };
}
