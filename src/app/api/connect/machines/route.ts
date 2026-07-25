// List the paired OpenSonoma machines for the signed-in user. Backs the
// "Manage" panel next to the Pair button and the chat composer's @mention list.

import { cookies } from 'next/headers';
import { auth } from '@/lib/auth/session';
import { relayListMachines } from '@/lib/connect/relay';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function GET() {
    const { userId } = await auth();
    if (!userId) {
        return Response.json({ error: 'Sign in to view paired devices.' }, { status: 401 });
    }

    const authJwt = (await cookies()).get('auth_token')?.value;
    const result = await relayListMachines({ accountId: userId, authJwt });
    if (!result.ok) {
        return Response.json({ error: result.error || 'Could not reach the relay.' }, { status: 502 });
    }

    return Response.json({ ok: true, machines: result.machines });
}
