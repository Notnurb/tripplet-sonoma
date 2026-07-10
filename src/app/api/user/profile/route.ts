import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/session";
import { query } from "@/lib/db/neon";
import { profileLimiter, getRateLimitToken, rateLimitResponse } from "@/lib/security/rate-limit";

export async function PATCH(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = getRateLimitToken(req, userId);
        try {
            await profileLimiter.check(100, token);
        } catch {
            return rateLimitResponse();
        }

        const body = await req.json() as {
            name?: unknown;
            bio?: unknown;
            image?: unknown;
        };

        const { name, bio, image } = body;

        if (name !== undefined) {
            if (typeof name !== 'string') return NextResponse.json({ error: "Invalid name" }, { status: 400 });
            if (name.length > 100) return NextResponse.json({ error: "Name too long (max 100 characters)" }, { status: 400 });
        }

        if (bio !== undefined) {
            if (typeof bio !== 'string') return NextResponse.json({ error: "Invalid bio" }, { status: 400 });
            if (bio.length > 500) return NextResponse.json({ error: "Bio too long (max 500 characters)" }, { status: 400 });
        }

        if (image !== undefined) {
            if (typeof image !== 'string') return NextResponse.json({ error: "Invalid image" }, { status: 400 });
            if (image.length > 0) {
                if (image.startsWith('data:')) {
                    if (!/^data:image\/(jpeg|jpg|png|webp|gif)/.test(image)) {
                        return NextResponse.json({ error: "Invalid image format" }, { status: 400 });
                    }
                    if (image.length / 1024 > 1024) {
                        return NextResponse.json({ error: "Image too large" }, { status: 400 });
                    }
                } else if (image.startsWith('https://')) {
                    if (image.length > 500) return NextResponse.json({ error: "Image URL too long" }, { status: 400 });
                } else {
                    return NextResponse.json({ error: "Image must be base64 data URL or HTTPS URL" }, { status: 400 });
                }
            }
        }

        const sets: string[] = ['"updatedAt" = now()'];
        const values: unknown[] = [];
        if (name !== undefined) { values.push(name); sets.push(`name = $${values.length}`); }
        if (bio !== undefined) { values.push(bio); sets.push(`bio = $${values.length}`); }
        if (image !== undefined) { values.push(image); sets.push(`image = $${values.length}`); }
        values.push(userId);

        const rows = await query<Record<string, unknown>>(
            `UPDATE "User" SET ${sets.join(', ')}
             WHERE id = $${values.length}
             RETURNING id, name, email, bio, image, "createdAt", "updatedAt"`,
            values,
        );

        const updatedUser = rows[0];
        if (!updatedUser) {
            return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
        }

        return NextResponse.json({ user: updatedUser });
    } catch {
        return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
    }
}
