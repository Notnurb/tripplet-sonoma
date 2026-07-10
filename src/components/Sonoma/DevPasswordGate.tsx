'use client';

import { useEffect, useState } from 'react';
import DevChatShell from './DevChatShell';

// The password never exists client-side: the gate POSTs the attempt to
// /api/dev/unlock, which checks it on the server and answers with an HttpOnly
// cookie. "Am I unlocked?" is likewise asked of the server, since JS cannot
// read the cookie.

export default function DevPasswordGate() {
    const [unlocked, setUnlocked] = useState(false);
    const [input, setInput] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        // Restore an existing unlock (cookie survives reloads for 8h).
        fetch('/api/dev/unlock')
            .then((res) => (res.ok ? res.json() : { unlocked: false }))
            .then((data: { unlocked?: boolean }) => {
                if (data.unlocked) setUnlocked(true);
            })
            .catch(() => { /* stay locked */ });
    }, []);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch('/api/dev/unlock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: input }),
            });
            if (res.ok) {
                setUnlocked(true);
            } else if (res.status === 429) {
                setError('Too many attempts. Try again later.');
            } else {
                setError('Wrong password.');
            }
        } catch {
            setError('Network error. Try again.');
        } finally {
            setBusy(false);
        }
    };

    if (unlocked) return <DevChatShell />;

    return (
        <div
            style={{
                display: 'flex',
                minHeight: '100dvh',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--sonoma-bg)',
                fontFamily: 'var(--font-sans)',
                padding: 24,
            }}
        >
            <form
                onSubmit={submit}
                className="sm-pop"
                style={{
                    width: 340,
                    maxWidth: '100%',
                    background: 'var(--sonoma-surface)',
                    border: '1px solid var(--sonoma-border)',
                    boxShadow: 'var(--sonoma-shadow-lg)',
                    borderRadius: 16,
                    padding: 24,
                }}
            >
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--sonoma-ink)', marginBottom: 4 }}>
                    /dev — locked
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--sonoma-muted)', marginBottom: 16 }}>
                    This is an internal fallback chat surface. Enter the password to continue.
                </div>
                <input
                    type="password"
                    autoFocus
                    value={input}
                    onChange={(e) => {
                        setInput(e.target.value);
                        setError(null);
                    }}
                    placeholder="Password"
                    style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: `1px solid ${error ? '#e5484d' : 'var(--sonoma-border)'}`,
                        background: 'var(--sonoma-bg)',
                        color: 'var(--sonoma-ink)',
                        fontSize: 13.5,
                        outline: 'none',
                        marginBottom: 10,
                    }}
                />
                {error && (
                    <div style={{ fontSize: 12, color: '#e5484d', marginBottom: 10 }}>
                        {error}
                    </div>
                )}
                <button
                    type="submit"
                    disabled={busy}
                    style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: 'none',
                        background: 'var(--sonoma-accent)',
                        color: '#fff',
                        fontSize: 13.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                    }}
                >
                    {busy ? 'Checking…' : 'Enter'}
                </button>
            </form>
        </div>
    );
}
