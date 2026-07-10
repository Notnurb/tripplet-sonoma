import { NextRequest, NextResponse } from "next/server";
import { createAuthUser, findAuthUserByEmail, isDuplicateUserError } from "@/lib/auth/user-store";
import { hashPassword } from "@/lib/auth/password";
import { signToken } from "@/lib/auth/jwt";
import { registerLimiter, LIMITS, getRateLimitToken, rateLimitResponse } from "@/lib/security/rate-limit";
import { parseBody, registerSchema } from "@/lib/validation";
import { logAuthFailure } from "@/lib/auth/log";

export async function POST(req: NextRequest) {
    try {
        const token = getRateLimitToken(req);
        await registerLimiter.check(LIMITS.register, token);
    } catch {
        return rateLimitResponse();
    }

    try {
        const { data, error: validationError } = await parseBody(req, registerSchema);
        if (validationError) return validationError;
        const { email, password, name } = data;

        const existingUser = await findAuthUserByEmail(email);

        if (existingUser) {
            return NextResponse.json(
                { error: "User already exists" },
                { status: 400 }
            );
        }

        const passwordHash = await hashPassword(password);

        const user = await createAuthUser({ email, passwordHash, name });

        const token = await signToken({ userId: user.id, email: user.email });

        const response = NextResponse.json(
            { message: "User registered successfully" },
            { status: 201 }
        );

        response.cookies.set("auth_token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            maxAge: 60 * 60 * 24 * 7,
            path: "/",
        });

        return response;
    } catch (error: unknown) {
        if (isDuplicateUserError(error)) {
            return NextResponse.json(
                { error: "User already exists" },
                { status: 400 }
            );
        }

        logAuthFailure("POST /api/auth/register", error);
        return NextResponse.json(
            { error: "Something went wrong. Please try again." },
            { status: 500 }
        );
    }
}
