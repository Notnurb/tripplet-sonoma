import { NextRequest, NextResponse } from "next/server";
import { findAuthUserByEmail } from "@/lib/auth/user-store";
import { verifyPassword, DUMMY_PASSWORD_HASH } from "@/lib/auth/password";
import { signToken } from "@/lib/auth/jwt";
import { loginLimiter, LIMITS, getRateLimitToken, rateLimitResponse, lockoutGet, lockoutIncr, lockoutClear } from "@/lib/security/rate-limit";
import { parseBody, loginSchema } from "@/lib/validation";
import { logAuthFailure } from "@/lib/auth/log";

const ACCOUNT_LOCKOUT_THRESHOLD = 5;
const ACCOUNT_LOCKOUT_TTL_MS = 15 * 60 * 1000;

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

        // Account lockout: track failed attempts per email, in a store shared
        // across instances (Redis when configured) so an attacker can't just
        // land on a fresh serverless instance to reset the counter.
        const lockKey = `lockout:${email.toLowerCase().trim()}`;
        const failedAttempts = await lockoutGet(lockKey);
        if (failedAttempts >= ACCOUNT_LOCKOUT_THRESHOLD) {
            return NextResponse.json(
                { error: "Account temporarily locked due to too many failed attempts. Try again in 15 minutes." },
                { status: 429 }
            );
        }

        const user = await findAuthUserByEmail(email);

        // Enumeration/timing-oracle guard: always run a bcrypt compare, even
        // when the account doesn't exist or has no password, against a fixed
        // dummy hash. bcrypt is by far the slowest step here, so skipping it
        // for unknown emails (as the old code did) made "no such account"
        // measurably faster than "wrong password" — an attacker can enumerate
        // valid emails purely from response timing. Comparing against a
        // constant dummy hash keeps the cost — and the response — identical
        // for "no such user", "no password set", and "wrong password".
        const isValid = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

        if (!user || !user.passwordHash || !isValid) {
            await lockoutIncr(lockKey, ACCOUNT_LOCKOUT_TTL_MS);
            return NextResponse.json(
                { error: "Invalid email or password" },
                { status: 401 }
            );
        }

        // On successful login, clear the lockout counter
        await lockoutClear(lockKey);

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
