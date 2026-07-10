'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';

export default function LoopTrainPage() {
    const [rps, setRps] = useState(5);
    const [concurrency, setConcurrency] = useState(8);
    const [count, setCount] = useState(0);
    const [running, setRunning] = useState(false);
    const [pid, setPid] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        const res = await fetch('/api/looptrain/status');
        if (!res.ok) return;
        const data = await res.json();
        setRunning(Boolean(data.running));
        setPid(data.pid ?? null);
    }, []);

    useEffect(() => {
        refresh();
        const t = setInterval(refresh, 3000);
        return () => clearInterval(t);
    }, [refresh]);

    const start = useCallback(async () => {
        setBusy(true);
        setError('');
        const res = await fetch('/api/looptrain/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rps, concurrency, count }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            setError(data.error || 'Failed to start');
        } else {
            setRunning(true);
            setPid(data.pid ?? null);
        }
        setBusy(false);
    }, [rps, concurrency, count]);

    const stop = useCallback(async () => {
        setBusy(true);
        setError('');
        await fetch('/api/looptrain/stop', { method: 'POST' });
        setRunning(false);
        setPid(null);
        setBusy(false);
    }, []);

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col">
            <div className="sticky top-0 z-40 flex items-center gap-3 px-6 py-3 border-b border-border bg-background/95 backdrop-blur-sm">
                <Link
                    href="/"
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                    <ArrowLeft size={14} />
                    Back
                </Link>
                <span className="text-border/60">·</span>
                <span className="text-sm font-semibold text-foreground">Looptrain</span>
            </div>

            <div className="flex-1 max-w-xl w-full mx-auto px-6 py-10">
                <h1 className="text-2xl font-semibold mb-2">Looptrain (Python)</h1>
                <p className="text-sm text-muted-foreground mb-6">
                    Runs a local Python trainer that pulls Wikipedia articles and inserts them into your Neon
                    database via the app API. Requires your local server and env to be configured.
                </p>

                <div className="space-y-4">
                    <div className="flex items-center justify-between gap-4">
                        <label className="text-sm text-muted-foreground">Requests per second</label>
                        <input
                            type="number"
                            min={1}
                            value={rps}
                            onChange={(e) => setRps(Number(e.target.value))}
                            className="w-28 bg-transparent border border-border rounded-lg px-3 py-2 text-sm"
                        />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                        <label className="text-sm text-muted-foreground">Concurrency</label>
                        <input
                            type="number"
                            min={1}
                            value={concurrency}
                            onChange={(e) => setConcurrency(Number(e.target.value))}
                            className="w-28 bg-transparent border border-border rounded-lg px-3 py-2 text-sm"
                        />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                        <label className="text-sm text-muted-foreground">Total count (0 = infinite)</label>
                        <input
                            type="number"
                            min={0}
                            value={count}
                            onChange={(e) => setCount(Number(e.target.value))}
                            className="w-28 bg-transparent border border-border rounded-lg px-3 py-2 text-sm"
                        />
                    </div>
                </div>

                <div className="mt-6 flex items-center gap-3">
                    <button
                        onClick={start}
                        disabled={busy || running}
                        className="px-4 py-2 rounded-lg bg-foreground text-background text-sm font-semibold disabled:opacity-50"
                    >
                        {busy && <Loader2 size={12} className="mr-2 inline animate-spin" />}
                        Start
                    </button>
                    <button
                        onClick={stop}
                        disabled={busy || !running}
                        className="px-4 py-2 rounded-lg border border-border text-sm font-semibold disabled:opacity-50"
                    >
                        Stop
                    </button>
                    <span className="text-xs text-muted-foreground">
                        {running ? `Running${pid ? ` (pid ${pid})` : ''}` : 'Stopped'}
                    </span>
                </div>

                {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
            </div>
        </div>
    );
}
