import { NextRequest, NextResponse } from "next/server";
import { findAuthUserById } from "@/lib/auth/user-store";
import { verifyToken } from "@/lib/auth/jwt";
import { logAuthFailure } from "@/lib/auth/log";
import { DEV_USER, isDevModeActive } from "@/lib/dev-mode";

export const dynamic = 'force-dynamic';

interface SessionUser {
    id: string;
    name: string | null;
    email: string;
    bio: string | null;
    image: string | null;
}

function ok(user: SessionUser) {
    return NextResponse.json({ user });
}

/**
 * Resolves the current user from the `auth_token` JWT cookie — used by
 * client-side session hydration (AuthContext).
 */
export async function GET(req: NextRequest) {
    try {
        const token = req.cookies.get("auth_token")?.value;
        if (token) {
            try {
                const payload = await verifyToken(token);
                const user = await findAuthUserById(payload.userId);
                if (user) {
                    return ok({
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        bio: user.bio ?? null,
                        image: user.image ?? null,
                    });
                }
            } catch {
                // Invalid/expired token — treat as signed-out.
            }
        }

        // Dev-mode login bypass (dev server only): with no real session, the
        // client hydrates as the Tripplet Dev account instead of signed-out.
        if (isDevModeActive()) {
            return ok({
                id: DEV_USER.id,
                name: DEV_USER.name,
                email: DEV_USER.email,
                bio: null,
                image: null,
            });
        }

        return NextResponse.json({ user: null }, { status: 200 });
    } catch (error: unknown) {
        logAuthFailure("GET /api/auth/me", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
