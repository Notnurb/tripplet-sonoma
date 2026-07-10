'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

// Mock OpenSonoma pairing — front-end only, no network calls.

const STORAGE_KEY = 'opensonoma_pair_mock';

// Format raw input into XXX-XXX (letters or numbers, uppercased).
function formatCode(raw: string): string {
    const chars = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    return chars.length > 3 ? `${chars.slice(0, 3)}-${chars.slice(3)}` : chars;
}

const CODE_RE = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;

const PRECAUTIONS = [
    'OpenSonoma can read, run, and modify files on the paired machine. Treat it like granting shell access.',
    'It may execute commands autonomously to complete a task. Review what you ask it to do.',
    'Never pair on a device holding secrets, production credentials, or data you can’t afford to expose.',
    'Pairing codes are single-use and expire. Never share an active code — anyone with it can connect.',
    'You are responsible for anything the agent runs. Use the no-go list to hard-block dangerous commands.',
];

export default function OpenSonomaPair() {
    const [open, setOpen] = useState(false);
    const [code, setCode] = useState('');
    const [ack, setAck] = useState(false);
    const [noGo, setNoGo] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const saved = JSON.parse(raw);
                if (typeof saved?.noGo === 'string') setNoGo(saved.noGo);
            }
        } catch {
            /* ignore */
        }
    }, []);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    const codeValid = useMemo(() => CODE_RE.test(code), [code]);

    const pair = useCallback(() => {
        if (!codeValid) {
            setError('Enter a full pairing code (e.g. A1B-2C3).');
            return;
        }
        if (!ack) {
            setError('Please acknowledge the security precautions first.');
            return;
        }
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ code, noGo }));
        } catch {
            /* ignore */
        }
        setError(null);
        setOpen(false);
        setCode('');
        setAck(false);
    }, [codeValid, ack, code, noGo]);

    return (
        <>
            {/* Top-right trigger */}
            <button
                onClick={() => setOpen(true)}
                className="absolute right-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors"
                style={{
                    background: 'var(--sonoma-surface)',
                    border: '1px solid var(--sonoma-border)',
                    color: 'var(--sonoma-ink)',
                    boxShadow: 'var(--sonoma-shadow-sm)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sonoma-surface-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--sonoma-surface)')}
            >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Pair
            </button>

            {/* Centered modal */}
            {open && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ background: 'color-mix(in oklch, var(--sonoma-bg) 55%, rgba(0,0,0,0.6))' }}
                    onMouseDown={(e) => {
                        if (e.target === e.currentTarget) setOpen(false);
                    }}
                >
                    <div
                        className="sm-fadeUp w-full max-w-[460px] overflow-y-auto rounded-[18px]"
                        style={{
                            maxHeight: '88vh',
                            background: 'var(--sonoma-bg)',
                            border: '1px solid var(--sonoma-border)',
                            boxShadow: 'var(--sonoma-shadow-lg)',
                            padding: 20,
                        }}
                    >
                        <div className="flex items-center justify-between">
                            <div className="text-[16px] font-semibold" style={{ color: 'var(--sonoma-ink)' }}>
                                Pair with OpenSonoma
                            </div>
                            <button
                                onClick={() => setOpen(false)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
                                style={{ color: 'var(--sonoma-muted)' }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sonoma-bg-2)')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                            >
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>

                        {/* Pairing code */}
                        <div className="mt-4 flex flex-col gap-1.5">
                            <label className="text-[12px] font-medium" style={{ color: 'var(--sonoma-ink-2)' }}>
                                Pairing code
                            </label>
                            <input
                                value={code}
                                onChange={(e) => {
                                    setCode(formatCode(e.target.value));
                                    setError(null);
                                }}
                                placeholder="A1B-2C3"
                                spellCheck={false}
                                autoComplete="off"
                                className="w-full rounded-[10px] px-3 py-2.5 text-center text-[18px] font-semibold tracking-[0.3em] outline-none"
                                style={{
                                    background: 'var(--sonoma-bg-2)',
                                    border: `1px solid ${codeValid ? 'var(--sonoma-accent)' : 'var(--sonoma-border)'}`,
                                    color: 'var(--sonoma-ink)',
                                    fontFamily: 'var(--font-mono)',
                                }}
                            />
                            <div className="text-[11.5px]" style={{ color: 'var(--sonoma-faint)' }}>
                                Enter the 6-character code shown in the OpenSonoma app.
                            </div>
                        </div>

                        {/* Precautions */}
                        <div
                            className="mt-4 rounded-[12px] p-3"
                            style={{
                                background: 'color-mix(in oklch, var(--destructive) 8%, transparent)',
                                border: '1px solid color-mix(in oklch, var(--destructive) 24%, transparent)',
                            }}
                        >
                            <div className="text-[12.5px] font-semibold" style={{ color: 'var(--destructive)' }}>
                                Before you pair — security precautions
                            </div>
                            <ul className="mt-1.5 flex flex-col gap-1.5">
                                {PRECAUTIONS.map((p, i) => (
                                    <li key={i} className="flex gap-1.5 text-[12px] leading-[1.45]" style={{ color: 'var(--sonoma-ink-2)' }}>
                                        <span style={{ color: 'var(--destructive)' }}>•</span>
                                        <span>{p}</span>
                                    </li>
                                ))}
                            </ul>
                            <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-[12px]" style={{ color: 'var(--sonoma-ink)' }}>
                                <input
                                    type="checkbox"
                                    checked={ack}
                                    onChange={(e) => {
                                        setAck(e.target.checked);
                                        setError(null);
                                    }}
                                    style={{ accentColor: 'var(--sonoma-accent)', marginTop: 2 }}
                                />
                                <span>I understand the risks and accept responsibility for what the agent runs.</span>
                            </label>
                        </div>

                        {/* No-go commands */}
                        <div className="mt-4 flex flex-col gap-1.5">
                            <label className="text-[12px] font-medium" style={{ color: 'var(--sonoma-ink-2)' }}>
                                No-go commands
                            </label>
                            <textarea
                                value={noGo}
                                onChange={(e) => setNoGo(e.target.value)}
                                rows={4}
                                placeholder={'rm -rf /\nshutdown\ngit push --force'}
                                spellCheck={false}
                                className="w-full resize-y rounded-[10px] px-3 py-2.5 text-[13px] outline-none"
                                style={{
                                    background: 'var(--sonoma-bg-2)',
                                    border: '1px solid var(--sonoma-border)',
                                    color: 'var(--sonoma-ink)',
                                    fontFamily: 'var(--font-mono)',
                                    lineHeight: 1.6,
                                }}
                            />
                            <div className="text-[11.5px]" style={{ color: 'var(--sonoma-faint)' }}>
                                One command per line. OpenSonoma will never run these.
                            </div>
                        </div>

                        {error && (
                            <div
                                className="mt-3 rounded-[10px] px-3 py-2 text-[12.5px]"
                                style={{
                                    background: 'color-mix(in oklch, var(--destructive) 12%, transparent)',
                                    color: 'var(--destructive)',
                                }}
                            >
                                {error}
                            </div>
                        )}

                        {/* Actions */}
                        <div className="mt-5 flex items-center justify-end gap-2">
                            <button
                                onClick={() => setOpen(false)}
                                className="rounded-full px-4 py-2 text-[13px] font-medium transition-colors"
                                style={{ border: '1px solid var(--sonoma-border)', color: 'var(--sonoma-ink-2)', background: 'transparent' }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={pair}
                                disabled={!codeValid || !ack}
                                className="rounded-full px-4 py-2 text-[13px] font-medium transition-opacity"
                                style={{
                                    background: '#000',
                                    color: '#fff',
                                    opacity: codeValid && ack ? 1 : 0.45,
                                    cursor: codeValid && ack ? 'pointer' : 'not-allowed',
                                }}
                            >
                                Pair device
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
