import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth/jwt";
import { invalidateSessionsNow } from "@/lib/auth/session-store";

export async function POST(req: NextRequest) {
    // Revoke the JWT server-side, not just delete the cookie — without this,
    // a copy of the token taken before logout (stolen, synced to another
    // device, etc.) kept working for its full 7-day life. Read the cookie
    // straight off the request (like /api/auth/me does), not via the
    // next/headers `auth()` singleton, so this works identically inside and
    // outside route-handler request context.
    const token = req.cookies.get("auth_token")?.value;
    if (token) {
        try {
            const { userId } = await verifyToken(token);
            await invalidateSessionsNow(userId).catch(() => { /* best-effort */ });
        } catch {
            // Invalid/expired token — nothing to revoke.
        }
    }

    const response = NextResponse.json(
        { message: "Logged out successfully" },
        { status: 200 }
    );

    response.cookies.set("auth_token", "", {
        httpOnly: true,
        expires: new Date(0),
        path: "/",
    });

    return response;
}
