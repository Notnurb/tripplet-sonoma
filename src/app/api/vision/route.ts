import { NextRequest } from 'next/server';
import { analyzeImage } from '@/lib/ai/chat-client';
import { auth } from '@/lib/auth/session';
import { imageLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return new Response(
            JSON.stringify({ error: 'Authentication required.' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
    }
    const limitToken = getRateLimitToken(request, userId);
    try {
        await imageLimiter.check(LIMITS.image, limitToken);
    } catch {
        return rateLimitResponse();
    }
    try {
        const formData = await request.formData();
        const file = formData.get('image') as File | null;

        if (!file) {
            return new Response(
                JSON.stringify({ error: 'No image provided' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Validate file type and size (max 10 MB)
        const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!ALLOWED_TYPES.includes(file.type)) {
            return new Response(
                JSON.stringify({ error: 'Invalid image type. Allowed: JPEG, PNG, WebP, GIF' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }
        const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
        if (file.size > MAX_SIZE) {
            return new Response(
                JSON.stringify({ error: 'Image too large (max 10 MB)' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Convert file to base64
        const bytes = await file.arrayBuffer();
        const base64 = Buffer.from(bytes).toString('base64');
        const mimeType = file.type;

        // Analyze with vision model
        const description = await analyzeImage(base64, mimeType);

        return new Response(
            JSON.stringify({ description, filename: file.name }),
            { headers: { 'Content-Type': 'application/json' } }
        );
    } catch (error: unknown) {
        console.error('Vision API error:', error);
        const message = error instanceof Error ? error.message : 'Vision analysis failed';
        return new Response(
            JSON.stringify({ error: message }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}
