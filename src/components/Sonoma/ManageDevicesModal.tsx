'use client';

import { useCallback, useEffect, useState } from 'react';

interface Machine {
    deviceId: string;
    machineName: string;
    status: string;
    online: boolean;
    lastSeenAt: string | null;
}

export default function ManageDevicesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [machines, setMachines] = useState<Machine[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [unpairing, setUnpairing] = useState<string | null>(null);

    const load = useCallback(() => {
        setLoading(true);
        setError(null);
        fetch('/api/connect/machines')
            .then((r) => r.json())
            .then((data) => {
                if (data.error) {
                    setError(String(data.error));
                    setMachines([]);
                } else {
                    setMachines(Array.isArray(data.machines) ? data.machines : []);
                }
            })
            .catch(() => setError('Could not reach the relay.'))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (open) load();
    }, [open, load]);

    const unpair = useCallback(
        (deviceId: string) => {
            setUnpairing(deviceId);
            fetch('/api/connect/unpair', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId }),
            })
                .then((r) => r.json())
                .then((data) => {
                    if (data.ok) setMachines((prev) => prev.filter((m) => m.deviceId !== deviceId));
                    else setError(String(data.error || 'Could not unpair.'));
                })
                .catch(() => setError('Could not reach the relay.'))
                .finally(() => setUnpairing(null));
        },
        [],
    );

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'color-mix(in oklch, var(--sonoma-bg) 55%, rgba(0,0,0,0.6))' }}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                className="sm-fadeUp w-full max-w-[440px] overflow-hidden rounded-[18px]"
                style={{
                    background: 'var(--sonoma-bg)',
                    border: '1px solid var(--sonoma-border)',
                    boxShadow: 'var(--sonoma-shadow-lg)',
                }}
            >
                <div className="flex items-center justify-between px-5 pt-5">
                    <div className="text-[16px] font-semibold" style={{ color: 'var(--sonoma-ink)' }}>
                        Manage devices
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg"
                        style={{ color: 'var(--sonoma-muted)' }}
                    >
                        ✕
                    </button>
                </div>

                <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
                    {loading && (
                        <div className="py-6 text-center text-[13px]" style={{ color: 'var(--sonoma-muted)' }}>
                            Loading…
                        </div>
                    )}
                    {!loading && error && (
                        <div
                            className="rounded-[10px] px-3 py-2 text-[12.5px]"
                            style={{ background: 'color-mix(in oklch, var(--destructive) 12%, transparent)', color: 'var(--destructive)' }}
                        >
                            {error}
                        </div>
                    )}
                    {!loading && !error && machines.length === 0 && (
                        <div className="py-6 text-center text-[13px]" style={{ color: 'var(--sonoma-muted)' }}>
                            No paired devices yet. Use Pair to connect one.
                        </div>
                    )}
                    {!loading && machines.length > 0 && (
                        <div className="flex flex-col gap-2">
                            {machines.map((m) => (
                                <div
                                    key={m.deviceId}
                                    className="flex items-center justify-between rounded-[12px] px-3 py-2.5"
                                    style={{ background: 'var(--sonoma-surface)', border: '1px solid var(--sonoma-border)' }}
                                >
                                    <div>
                                        <div className="flex items-center gap-1.5 text-[13.5px] font-medium" style={{ color: 'var(--sonoma-ink)' }}>
                                            <span
                                                className="h-1.5 w-1.5 rounded-full"
                                                style={{ background: m.online ? 'var(--sonoma-ok)' : 'var(--sonoma-faint)' }}
                                            />
                                            {m.machineName}
                                        </div>
                                        <div className="mt-0.5 text-[11.5px]" style={{ color: 'var(--sonoma-faint)' }}>
                                            {m.online ? 'Online' : m.lastSeenAt ? `Last seen ${new Date(m.lastSeenAt).toLocaleString()}` : 'Offline'}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => unpair(m.deviceId)}
                                        disabled={unpairing === m.deviceId}
                                        className="rounded-full px-3 py-1.5 text-[12px] font-medium"
                                        style={{ border: '1px solid var(--sonoma-border)', color: 'var(--destructive)', background: 'transparent' }}
                                    >
                                        {unpairing === m.deviceId ? 'Unpairing…' : 'Unpair'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
