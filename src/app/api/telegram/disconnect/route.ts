import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { auth } from '@/lib/auth/session';
import { deleteWebhook } from '@/lib/telegram';

export const runtime = 'nodejs';

export async function POST() {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

    const existing = await prisma.telegramBot.findFirst({ where: { userId } });
    if (!existing) return NextResponse.json({ ok: true });

    try {
        await deleteWebhook(existing.token);
    } catch {
        /* still remove the local record */
    }
    await prisma.telegramBot.deleteMany({ where: { userId } });
    return NextResponse.json({ ok: true });
}
