import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db/neon";
import crypto from 'crypto';
import { forgotPasswordLimiter, LIMITS, getRateLimitToken, rateLimitResponse } from "@/lib/security/rate-limit";
import { parseBody, forgotPasswordSchema } from "@/lib/validation";
import { logAuthFailure } from "@/lib/auth/log";

export async function POST(req: NextRequest) {
    try {
        const token = getRateLimitToken(req);
        await forgotPasswordLimiter.check(LIMITS.forgotPassword, token);
    } catch {
        return rateLimitResponse();
    }

    try {
        const { data, error: validationError } = await parseBody(req, forgotPasswordSchema);
        if (validationError) return validationError;
        const { email } = data;

        const user = await queryOne<{ id: string; email: string }>(
            `SELECT id, email FROM "User" WHERE email = $1 LIMIT 1`,
            [email],
        );

        // Return success regardless to prevent enumeration
        if (!user) return NextResponse.json({ success: true });

        // The raw token goes in the URL; only the hash is stored in the DB.
        // Even if the DB is compromised, the attacker cannot derive the URL token from the hash.
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        // Delete any existing unused tokens for this user before inserting
        await query(`DELETE FROM "PasswordResetToken" WHERE "userId" = $1`, [user.id]);

        await query(
            `INSERT INTO "PasswordResetToken" (id, "userId", token, "expiresAt")
             VALUES (gen_random_uuid()::text, $1, $2, $3)`,
            [user.id, resetTokenHash, expiresAt],
        );

        // TODO: Send reset email via email service (e.g. Resend, SendGrid)
        // const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;

        return NextResponse.json({ success: true });
    } catch (error) {
        logAuthFailure("POST /api/auth/forgot-password", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
