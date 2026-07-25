// Run a shell command on a paired OpenSonoma machine and stream its output
// back as SSE. This is the execution backend for the `run_on_machine` Sonoma
// tool — the client only calls this after the user has explicitly approved
// the command (see the in-chat permission card). The relay enforces that the
// caller's account owns the target device; the device's password is supplied
// fresh by the browser on every call and is never persisted server-side.

import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth/session';
import { relayExec } from '@/lib/connect/relay';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return Response.json({ error: 'Sign in to run commands on a paired device.' }, { status: 401 });
    }

    let body: { deviceId?: string; command?: string; password?: string };
    try {
        body = (await req.json()) as { deviceId?: string; command?: string; password?: string };
    } catch {
        return Response.json({ error: 'Bad request.' }, { status: 400 });
    }

    const deviceId = String(body?.deviceId ?? '').trim();
    const command = String(body?.command ?? '');
    const password = String(body?.password ?? '');
    if (!deviceId || !command) {
        return Response.json({ error: 'Missing deviceId or command.' }, { status: 400 });
    }
    if (!password) {
        return Response.json({ error: 'This device requires its password to run commands.' }, { status: 400 });
    }

    const authJwt = (await cookies()).get('auth_token')?.value;

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const send = (event: Record<string, unknown>) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            };
            relayExec({
                accountId: userId,
                authJwt,
                deviceId,
                command,
                password,
                onStream: (ev) => send({ type: 'stream', stream: ev.stream, data: ev.data }),
            })
                .then((result) => {
                    send({ type: 'result', ok: result.ok, exitCode: result.exitCode, error: result.error });
                    controller.close();
                })
                .catch((e) => {
                    send({ type: 'result', ok: false, exitCode: null, error: e instanceof Error ? e.message : 'exec failed' });
                    controller.close();
                });
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
        },
    });
}
