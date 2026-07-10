import { NextRequest, NextResponse } from "next/server";
import { LRUCache } from "lru-cache";
import { findAuthUserByEmail } from "@/lib/auth/user-store";
import { verifyPassword } from "@/lib/auth/password";
import { signToken } from "@/lib/auth/jwt";
import { loginLimiter, LIMITS, getRateLimitToken, rateLimitResponse } from "@/lib/security/rate-limit";
import { parseBody, loginSchema } from "@/lib/validation";
import { logAuthFailure } from "@/lib/auth/log";

const ACCOUNT_LOCKOUT_THRESHOLD = 5;
const ACCOUNT_LOCKOUT_TTL_MS = 15 * 60 * 1000;

const failedLoginCache = new LRUCache<string, number>({
    max: 100000,
    ttl: ACCOUNT_LOCKOUT_TTL_MS,
});

export async function POST(req: NextRequest) {
    try {
        const token = getRateLimitToken(req);
        await loginLimiter.check(LIMITS.login, token);
    } catch {
        return rateLimitResponse();
    }

    try {
        const { data, error: validationError } = await parseBody(req, loginSchema);
        if (validationError) return validationError;
        const { email, password } = data;

        // Account lockout: track failed attempts per email
        const lockKey = `lockout:${email.toLowerCase().trim()}`;
        const failedAttempts = failedLoginCache.get(lockKey) || 0;
        if (failedAttempts >= ACCOUNT_LOCKOUT_THRESHOLD) {
            return NextResponse.json(
                { error: "Account temporarily locked due to too many failed attempts. Try again in 15 minutes." },
                { status: 429 }
            );
        }

        const user = await findAuthUserByEmail(email);

        if (!user) {
            failedLoginCache.set(lockKey, failedAttempts + 1);
            return NextResponse.json(
                { error: "Invalid email or password" },
                { status: 401 }
            );
        }

        if (!user.passwordHash) {
            failedLoginCache.set(lockKey, failedAttempts + 1);
            return NextResponse.json(
                { error: "This account does not have a password login. Reset your password first." },
                { status: 401 }
            );
        }

        // Verify password
        const isValid = await verifyPassword(password, user.passwordHash);

        if (!isValid) {
            failedLoginCache.set(lockKey, failedAttempts + 1);
            return NextResponse.json(
                { error: "Invalid email or password" },
                { status: 401 }
            );
        }

        // On successful login, clear the lockout counter
        failedLoginCache.delete(lockKey);

        // Sign JWT
        const token = await signToken({ userId: user.id, email: user.email });

        // Set cookie
        const response = NextResponse.json(
            { message: "Logged in successfully" },
            { status: 200 }
        );

        response.cookies.set("auth_token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            maxAge: 60 * 60 * 24 * 7, // 7 days
            path: "/",
        });

        return response;
    } catch (error: unknown) {
        logAuthFailure("POST /api/auth/login", error);
        return NextResponse.json(
            { error: "Something went wrong. Please try again." },
            { status: 500 }
        );
    }
}
