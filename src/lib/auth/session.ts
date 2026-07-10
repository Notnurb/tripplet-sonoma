import { cookies } from 'next/headers';
import { verifyToken } from './jwt';

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
            return { userId: payload.userId, email: payload.email };
        }
    } catch {
        // Invalid/expired token — treat as guest.
    }
    return { userId: null };
}
