// Step 2 of pairing: the user picks the emoji that matches the one shown on
// their computer. If it matches the emoji derived from the code, we pair for
// real — connecting to the OpenSonoma relay as a client and binding the machine
// to this account. On success the machine grants Sonoma terminal access via the
// relay's password-gated exec protocol (see ~/OS/opensonoma/protocol.py).

import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth/session';
import { isValidCode, normalizeCode, pairingEmoji } from '@/lib/connect/pairing';
import { relayPair } from '@/lib/connect/relay';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return Response.json({ error: 'Sign in to pair a device.' }, { status: 401 });
    }

    let body: { code?: string; emoji?: string };
    try {
        body = (await req.json()) as { code?: string; emoji?: string };
    } catch {
        return Response.json({ error: 'Bad request.' }, { status: 400 });
    }

    const code = normalizeCode(String(body?.code ?? ''));
    const emoji = String(body?.emoji ?? '');
    if (!isValidCode(code)) {
        return Response.json({ error: 'That pairing code is no longer valid.' }, { status: 400 });
    }

    if (emoji !== pairingEmoji(code)) {
        return Response.json(
            {
                error:
                    "That's not the emoji on your computer's screen. Check the device and pick the matching one.",
            },
            { status: 400 },
        );
    }

    // Forward the user's real session JWT so the relay can cryptographically
    // verify identity (when it's configured with TRIPPLET_JWT_SECRET). The
    // accountId is sent too for the relay's dev-trust fallback.
    const authJwt = (await cookies()).get('auth_token')?.value;
    const result = await relayPair({ accountId: userId, authJwt, code });
    if (!result.ok) {
        return Response.json(
            {
                error:
                    result.error ||
                    'Could not reach that device. Make sure OpenSonoma is running and the code is current.',
            },
            { status: 502 },
        );
    }

    return Response.json({
        ok: true,
        deviceId: result.deviceId,
        machineName: result.machineName ?? null,
        online: result.online ?? false,
    });
}
