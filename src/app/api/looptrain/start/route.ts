import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { auth } from '@/lib/auth/session';
import { getLooptrainProcess, setLooptrainProcess } from '@/lib/looptrain/process';

const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

export async function POST(req: Request) {
    // This route spawns a server-side child process — restrict to admin users only.
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
    if (ADMIN_USER_IDS.length === 0 || !ADMIN_USER_IDS.includes(userId)) {
        return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    const body = await (req as import('next/server').NextRequest).json().catch(() => ({}));
    const rps = Number(body.rps ?? 5);
    const concurrency = Number(body.concurrency ?? 8);
    const count = Number(body.count ?? 0);

    if (!Number.isFinite(rps) || rps <= 0) {
        return NextResponse.json({ error: 'Invalid rps' }, { status: 400 });
    }
    if (!Number.isFinite(concurrency) || concurrency <= 0) {
        return NextResponse.json({ error: 'Invalid concurrency' }, { status: 400 });
    }
    if (!Number.isFinite(count) || count < 0) {
        return NextResponse.json({ error: 'Invalid count' }, { status: 400 });
    }

    const existing = getLooptrainProcess();
    if (existing && !existing.killed) {
        return NextResponse.json({ running: true, pid: existing.pid });
    }

    const scriptPath = resolve(process.cwd(), 'scripts', 'looptrain.py');
    const args = [
        scriptPath,
        '--rps', String(rps),
        '--concurrency', String(concurrency),
    ];
    if (count > 0) {
        args.push('--count', String(count));
    }

    const SENSITIVE_KEYS = new Set([
        'DATABASE_URL', 'DIRECT_URL', 'JWT_SECRET',
        'GROQ_API_KEY', 'OPENCODE_ZEN_API_KEY',
        'BACKEND_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
    ]);
    const childEnv: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && !SENSITIVE_KEYS.has(key)) {
            childEnv[key] = value;
        }
    }
    const child = spawn('python3', args, { env: childEnv as NodeJS.ProcessEnv, stdio: 'ignore', detached: true });

    child.unref();
    setLooptrainProcess(child);

    child.on('exit', () => {
        setLooptrainProcess(null);
    });

    return NextResponse.json({ running: true, pid: child.pid });
}
