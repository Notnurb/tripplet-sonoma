// Shared client-side plumbing for /api/sonoma streams.
//
// ChatShell and DevChatShell used to each carry their own copy of the SSE
// parse loop and the activity-card merge logic; the two copies drifted (and
// had to be bug-fixed twice). This module is the single source of truth —
// the shells keep only their own state wiring.

import type { SonomaActivity } from '@/components/Sonoma/Message';

export interface SonomaStreamEvent {
    type: string;
    delta?: string;
    tool?: string;
    status?: 'running' | 'done';
    id?: string;
    args?: Record<string, unknown>;
    result?: unknown;
    message?: string;
}

export interface SonomaStreamCallbacks {
    onThinking: (delta: string) => void;
    onContent: (delta: string) => void;
    onActivity: (ev: SonomaStreamEvent & { tool: string; id: string }) => void;
    onError: (message: string) => void;
}

// Read an /api/sonoma SSE body to completion, dispatching each event.
export async function readSonomaStream(
    body: ReadableStream<Uint8Array>,
    cb: SonomaStreamCallbacks,
): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            let ev: SonomaStreamEvent;
            try {
                ev = JSON.parse(data);
            } catch {
                continue;
            }
            if (ev.type === 'thinking' && ev.delta) cb.onThinking(ev.delta);
            else if (ev.type === 'content' && ev.delta) cb.onContent(ev.delta);
            else if (ev.type === 'activity' && ev.tool && ev.id) {
                cb.onActivity(ev as SonomaStreamEvent & { tool: string; id: string });
            } else if (ev.type === 'error' && ev.message) cb.onError(ev.message);
        }
    }
}

// Merge an activity event into a card list (immutably), stamping wall-clock
// timings for the "done · 1.2s" chip. For run_bash the server result is a
// placeholder — the real execution happens in the browser VM — so the card is
// pinned to "running" and the server result is ignored; finishBashActivity()
// completes it when the VM returns.
export function mergeActivity(
    list: SonomaActivity[],
    ev: SonomaStreamEvent & { tool: string; id: string },
): SonomaActivity[] {
    const isBash = ev.tool === 'run_bash';
    const status: SonomaActivity['status'] =
        isBash ? 'running' : ev.status === 'done' ? 'done' : 'running';
    const now = Date.now();
    const next = [...list];
    const idx = next.findIndex((a) => a.id === ev.id);
    if (idx >= 0) {
        const prev = next[idx];
        next[idx] = {
            ...prev,
            status,
            ...(isBash ? {} : { result: ev.result }),
            ...(status === 'done' && prev.startedAt ? { elapsedMs: now - prev.startedAt } : {}),
        };
    } else {
        next.push({
            id: ev.id,
            tool: ev.tool,
            args: ev.args ?? {},
            status,
            result: isBash ? undefined : ev.result,
            startedAt: now,
        });
    }
    return next;
}

// Complete a run_bash card with the VM's real output.
export function finishBashActivity(
    list: SonomaActivity[],
    activityId: string,
    output: string,
): SonomaActivity[] {
    return list.map((a) =>
        a.id === activityId
            ? {
                ...a,
                status: 'done' as const,
                result: { output },
                ...(a.startedAt ? { elapsedMs: Date.now() - a.startedAt } : {}),
            }
            : a,
    );
}
