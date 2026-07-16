import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import { uploadLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export async function POST(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
        }

        const token = getRateLimitToken(req, userId);
        try {
            await uploadLimiter.check(LIMITS.upload, token);
        } catch {
            return rateLimitResponse();
        }

        const formData = await req.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'File is required' }, { status: 400 });
        }

        if (!ALLOWED_MIMES.has(file.type)) {
            return NextResponse.json({ error: 'Only JPEG, PNG, WebP, and GIF images allowed' }, { status: 400 });
        }

        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json({ error: 'Image must be under 5 MB' }, { status: 413 });
        }

        // Neon is a database, not an object store, so we encode the image as a
        // base64 data URL and return it. Callers persist this string directly
        // (e.g. in an article's infobox), the same way profile images are stored.
        const buffer = Buffer.from(await file.arrayBuffer());
        const dataUrl = `data:${file.type};base64,${buffer.toString('base64')}`;

        return NextResponse.json({ url: dataUrl });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Upload failed';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
