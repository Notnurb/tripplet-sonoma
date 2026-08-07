import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import prisma from '@/lib/db/prisma';
import { auth } from '@/lib/auth/session';
import { deriveWebhookUrl, getMe, setWebhook } from '@/lib/telegram';
import { MODELS } from '@/lib/ai/models';
import { profileLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

const VALID_MODEL_IDS = new Set(MODELS.map(m => m.id));

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

    const limitToken = getRateLimitToken(req, userId);
    try {
        await profileLimiter.check(LIMITS.profile, limitToken);
    } catch {
        return rateLimitResponse();
    }

    let body: { token?: string; model?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const token = (body.token ?? '').trim();
    const model = body.model ?? 'majuli4';

    if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
        return NextResponse.json({ error: 'That does not look like a valid Telegram bot token' }, { status: 400 });
    }
    if (!VALID_MODEL_IDS.has(model)) {
        return NextResponse.json({ error: 'Unknown model id' }, { status: 400 });
    }

    // Verify the token works with Telegram.
    let me: { username?: string };
    try {
        me = await getMe(token);
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        return NextResponse.json({ error: `Token rejected by Telegram: ${msg}` }, { status: 400 });
    }

    // Determine the public origin we should point Telegram at.
    const explicitOrigin = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL;
    const origin = explicitOrigin || `${req.nextUrl.protocol}//${req.nextUrl.host}`;

    if (origin.startsWith('http://localhost') || origin.startsWith('http://127.')) {
        return NextResponse.json(
            {
                error:
                    'Telegram requires a public HTTPS URL for webhooks. Set PUBLIC_APP_URL to your deployment URL (or use ngrok) and try again.',
            },
            { status: 400 },
        );
    }

    const webhookUrl = deriveWebhookUrl(origin, token);
    // Generate a random webhook secret so we can verify Telegram is the caller.
    const webhookSecret = randomBytes(24).toString('hex');
    try {
        await setWebhook(token, webhookUrl, webhookSecret);
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        return NextResponse.json({ error: `Telegram rejected webhook URL: ${msg}` }, { status: 400 });
    }

    // Store the binding (replace any existing one for this user).
    await prisma.telegramBot.deleteMany({ where: { userId } });
    const saved = await prisma.telegramBot.create({
        data: {
            userId,
            token,
            username: me.username ?? null,
            model,
            active: true,
            webhookSecret,
        },
    });

    return NextResponse.json({
        ok: true,
        username: saved.username,
        model: saved.model,
        webhookUrl,
    });
}
