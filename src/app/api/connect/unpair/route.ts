// Unbind a paired machine from the signed-in user's account. Backs the
// "Manage" panel's Unpair action.

import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth/session';
import { relayUnpair } from '@/lib/connect/relay';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function POST(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return Response.json({ error: 'Sign in to manage paired devices.' }, { status: 401 });
    }

    let body: { deviceId?: string };
    try {
        body = (await req.json()) as { deviceId?: string };
    } catch {
        return Response.json({ error: 'Bad request.' }, { status: 400 });
    }

    const deviceId = String(body?.deviceId ?? '').trim();
    if (!deviceId) {
        return Response.json({ error: 'Missing deviceId.' }, { status: 400 });
    }

    const authJwt = (await cookies()).get('auth_token')?.value;
    const result = await relayUnpair({ accountId: userId, authJwt, deviceId });
    if (!result.ok) {
        return Response.json({ error: result.error || 'Could not unpair that device.' }, { status: 502 });
    }

    return Response.json({ ok: true });
}
