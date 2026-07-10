import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/neon";
import crypto from 'crypto';
import { hashPassword } from "@/lib/auth/password";
import { parseBody, resetPasswordSchema } from "@/lib/validation";
import { forgotPasswordLimiter, LIMITS, getRateLimitToken, rateLimitResponse } from "@/lib/security/rate-limit";
import { logAuthFailure } from "@/lib/auth/log";

export async function POST(req: NextRequest) {
    try {
        const limitToken = getRateLimitToken(req);
        await forgotPasswordLimiter.check(LIMITS.forgotPassword, limitToken);
    } catch {
        return rateLimitResponse();
    }

    try {
        const { data, error: validationError } = await parseBody(req, resetPasswordSchema);
        if (validationError) return validationError;
        const { token, password } = data;

        // Hash the raw token from the URL before querying — the DB only stores the hash.
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        const resetTokenRecord = await queryOne<{ id: string; userId: string; expiresAt: string }>(
            `SELECT id, "userId", "expiresAt" FROM "PasswordResetToken" WHERE token = $1 LIMIT 1`,
            [tokenHash],
        );

        if (!resetTokenRecord) {
            return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 });
        }

        if (new Date() > new Date(resetTokenRecord.expiresAt)) {
            await query(`DELETE FROM "PasswordResetToken" WHERE id = $1`, [resetTokenRecord.id]);
            return NextResponse.json({ error: "Token expired" }, { status: 400 });
        }

        const passwordHash = await hashPassword(password);

        await query(
            `UPDATE "User" SET "passwordHash" = $1, "updatedAt" = now() WHERE id = $2`,
            [passwordHash, resetTokenRecord.userId],
        );

        await query(
            `DELETE FROM "PasswordResetToken" WHERE "userId" = $1`,
            [resetTokenRecord.userId],
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        logAuthFailure("POST /api/auth/reset-password", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
