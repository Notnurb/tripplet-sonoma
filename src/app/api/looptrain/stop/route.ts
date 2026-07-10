import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import { getLooptrainProcess, setLooptrainProcess } from '@/lib/looptrain/process';

const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

export async function POST() {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
    if (ADMIN_USER_IDS.length === 0 || !ADMIN_USER_IDS.includes(userId)) {
        return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    const proc = getLooptrainProcess();
    if (!proc || proc.killed) {
        return NextResponse.json({ running: false });
    }

    try {
        proc.kill('SIGTERM');
    } catch {
        // ignore
    }

    setLooptrainProcess(null);
    return NextResponse.json({ running: false });
}
