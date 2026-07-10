// Step 1 of pairing: the user enters the XXX-XXX code shown by OpenSonoma.
// We validate the format and return the 5 verification-emoji choices to pick
// from. The correct emoji is derived deterministically from the code (it's the
// same one the daemon prints on its own screen), so this step needs no relay
// round-trip — it's instant and works offline. The actual device bind happens
// in /api/connect/verify once the right emoji is chosen.

import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth/session';
import { isValidCode, normalizeCode, pairingEmojiChoices } from '@/lib/connect/pairing';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return Response.json({ error: 'Sign in to pair a device.' }, { status: 401 });
    }

    let body: { code?: string };
    try {
        body = (await req.json()) as { code?: string };
    } catch {
        return Response.json({ error: 'Bad request.' }, { status: 400 });
    }

    const code = normalizeCode(String(body?.code ?? ''));
    if (!isValidCode(code)) {
        return Response.json(
            { error: 'Enter the full 6-character code shown on your computer (e.g. A7K-3FQ).' },
            { status: 400 },
        );
    }

    return Response.json({ ok: true, code, choices: pairingEmojiChoices(code, 5) });
}
