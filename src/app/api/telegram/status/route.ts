import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { auth } from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function GET() {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ connected: false });
    const bot = await prisma.telegramBot.findFirst({ where: { userId } });
    if (!bot) return NextResponse.json({ connected: false });
    return NextResponse.json({
        connected: true,
        username: bot.username,
        model: bot.model,
        connectedAt: bot.createdAt,
    });
}
