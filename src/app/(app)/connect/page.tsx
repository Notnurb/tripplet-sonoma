'use client';

import { useRef, useState, useCallback, useEffect, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Link2, Check, Loader2, Copy, Terminal, Download } from 'lucide-react';

const CODE_LENGTH = 6; // XXX-XXX, matches the OpenSonoma pairing alphabet
const INSTALL_CMD = 'curl -fsSL https://tripplet.lol/installconnect | bash';

type Step = 'code' | 'emoji' | 'connected';

const INK = 'var(--sonoma-ink, #fff)';
const MUTED = 'var(--sonoma-muted, #999)';

export default function ConnectPage() {
    const router = useRouter();
    const [step, setStep] = useState<Step>('code');
    const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
    const [choices, setChoices] = useState<string[]>([]);
    const [machineName, setMachineName] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);
    const [showInstall, setShowInstall] = useState(false);
    const [platform, setPlatform] = useState<'mac' | 'linux' | 'windows' | 'other'>('other');
    const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

    // Detect the OS of the machine being paired so we can show the right
    // "where to paste this" hint (the install one-liner is the same everywhere).
    useEffect(() => {
        const ua = (navigator.userAgent || '').toLowerCase();
        if (ua.includes('win')) setPlatform('windows');
        else if (ua.includes('mac')) setPlatform('mac');
        else if (ua.includes('linux') || ua.includes('android')) setPlatform('linux');
        else setPlatform('other');
    }, []);

    const copyInstall = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(INSTALL_CMD);
        } catch {
            /* clipboard blocked — the command is still visible to copy by hand */
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
    }, []);

    const code = digits.join('');
    const complete = code.length === CODE_LENGTH;

    const focusInput = (i: number) => {
        const el = inputsRef.current[i];
        if (el) el.focus();
    };

    const setDigit = useCallback((i: number, value: string) => {
        setDigits((prev) => {
            const next = [...prev];
            next[i] = value;
            return next;
        });
    }, []);

    const handleChange = (i: number, raw: string) => {
        const value = raw.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
        if (!value) {
            setDigit(i, '');
            return;
        }
        const chars = value.split('');
        setDigits((prev) => {
            const next = [...prev];
            let idx = i;
            for (const ch of chars) {
                if (idx >= CODE_LENGTH) break;
                next[idx] = ch;
                idx++;
            }
            return next;
        });
        focusInput(Math.min(i + chars.length, CODE_LENGTH - 1));
        setError('');
    };

    const handleKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && !digits[i] && i > 0) {
            focusInput(i - 1);
        } else if (e.key === 'ArrowLeft' && i > 0) {
            focusInput(i - 1);
        } else if (e.key === 'ArrowRight' && i < CODE_LENGTH - 1) {
            focusInput(i + 1);
        } else if (e.key === 'Enter' && complete) {
            void submitCode();
        }
    };

    const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text').replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
        if (!text) return;
        const chars = text.slice(0, CODE_LENGTH).split('');
        setDigits(() => {
            const next = Array(CODE_LENGTH).fill('');
            chars.forEach((ch, idx) => {
                next[idx] = ch;
            });
            return next;
        });
        focusInput(Math.min(chars.length, CODE_LENGTH - 1));
    };

    // Step 1 → fetch the emoji choices for this code.
    const submitCode = async () => {
        if (!complete || busy) return;
        setBusy(true);
        setError('');
        try {
            const res = await fetch('/api/connect/pair', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Could not read that code. Try again.');
            setChoices(Array.isArray(data.choices) ? data.choices : []);
            setStep('emoji');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Pairing failed.');
        } finally {
            setBusy(false);
        }
    };

    // Step 2 → pick the emoji shown on the computer; bind on a match.
    const pickEmoji = async (emoji: string) => {
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            const res = await fetch('/api/connect/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, emoji }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Verification failed.');
            setMachineName(typeof data.machineName === 'string' ? data.machineName : null);
            setStep('connected');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Verification failed.');
        } finally {
            setBusy(false);
        }
    };

    const resetToCode = () => {
        setStep('code');
        setChoices([]);
        setError('');
    };

    return (
        <div
            style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--sonoma-bg, #000)',
                padding: 24,
            }}
        >
            <button
                type="button"
                onClick={() => (step === 'code' ? router.back() : resetToCode())}
                style={backBtnStyle}
            >
                <ArrowLeft size={15} />
                {step === 'code' ? 'Back' : 'Re-enter code'}
            </button>

            <div style={{ width: '100%', maxWidth: 440, textAlign: 'center' }}>
                <div style={iconWrapStyle}>
                    {step === 'connected' ? (
                        <Check size={26} color="#34d399" />
                    ) : (
                        <Link2 size={26} color={INK} />
                    )}
                </div>

                {/* ── Step 1 — code ─────────────────────────────────────────── */}
                {step === 'code' && (
                    <>
                        <h1 style={titleStyle}>Pair a device</h1>
                        <p style={subStyle}>
                            Run <code style={codeTokenStyle}>opensonoma</code> on your computer, then
                            enter the {CODE_LENGTH}-character code it shows.
                        </p>

                        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 24 }}>
                            {digits.map((d, i) => (
                                <input
                                    key={i}
                                    ref={(el) => {
                                        inputsRef.current[i] = el;
                                    }}
                                    value={d}
                                    onChange={(e) => handleChange(i, e.target.value)}
                                    onKeyDown={(e) => handleKeyDown(i, e)}
                                    onPaste={handlePaste}
                                    inputMode="text"
                                    maxLength={1}
                                    autoFocus={i === 0}
                                    style={{
                                        width: 48,
                                        height: 56,
                                        textAlign: 'center',
                                        fontSize: 22,
                                        fontWeight: 600,
                                        color: INK,
                                        background: 'rgba(255,255,255,0.04)',
                                        border: `1px solid ${d ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)'}`,
                                        borderRadius: 12,
                                        outline: 'none',
                                        // visual hyphen between the two groups
                                        marginRight: i === 2 ? 10 : 0,
                                    }}
                                />
                            ))}
                        </div>

                        {error && <p style={errorStyle}>{error}</p>}

                        <button
                            type="button"
                            onClick={submitCode}
                            disabled={!complete || busy}
                            style={primaryBtnStyle(complete && !busy)}
                        >
                            {busy ? 'Checking…' : 'Continue'}
                        </button>

                        {/* ── Don't have OpenSonoma yet? ───────────────────── */}
                        <div style={installCardStyle}>
                            <div style={installHeaderStyle}>
                                <Terminal size={15} color={MUTED} />
                                <span>Don&apos;t have it yet?</span>
                            </div>
                            <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 12px', lineHeight: 1.5 }}>
                                Install OpenSonoma on the computer you want to connect. One command sets
                                up the <code style={codeTokenStyle}>opensonoma</code> agent and installs
                                every dependency automatically — Python, a C/C++ compiler, CMake, Make
                                &amp; Git.
                            </p>

                            <button
                                type="button"
                                onClick={() => {
                                    void copyInstall();
                                    setShowInstall(true);
                                }}
                                style={installBtnStyle}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(255,255,255,0.14)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                                }}
                            >
                                <Download size={16} />
                                {copied
                                    ? 'Command copied — paste it in your terminal'
                                    : 'Install OpenSonoma & dependencies'}
                            </button>

                            {showInstall && (
                                <div style={{ marginTop: 12 }}>
                                    <p style={installStepStyle}>
                                        {platform === 'windows' ? (
                                            <>
                                                On Windows, open <b style={{ color: INK }}>Git Bash</b> or{' '}
                                                <b style={{ color: INK }}>WSL</b>, then paste:
                                            </>
                                        ) : (
                                            <>
                                                Open your <b style={{ color: INK }}>Terminal</b>
                                                {platform === 'mac' ? ' (⌘-Space → “Terminal”)' : ''} and
                                                paste:
                                            </>
                                        )}
                                    </p>
                                    <div style={installCmdRowStyle}>
                                        <code style={installCmdStyle}>{INSTALL_CMD}</code>
                                        <button
                                            type="button"
                                            onClick={copyInstall}
                                            aria-label="Copy install command"
                                            style={copyBtnStyle}
                                        >
                                            {copied ? (
                                                <Check size={15} color="#34d399" />
                                            ) : (
                                                <Copy size={15} />
                                            )}
                                        </button>
                                    </div>
                                    <p
                                        style={{
                                            fontSize: 11.5,
                                            color: 'var(--sonoma-faint, #6b7280)',
                                            margin: '10px 0 0',
                                        }}
                                    >
                                        Installing the build tools may prompt for your password. When it
                                        finishes it prints a code + emoji — enter them above.
                                    </p>
                                </div>
                            )}
                        </div>
                    </>
                )}

                {/* ── Step 2 — emoji ────────────────────────────────────────── */}
                {step === 'emoji' && (
                    <>
                        <h1 style={titleStyle}>Confirm it&apos;s your device</h1>
                        <p style={subStyle}>
                            Pick the emoji shown next to the code on your computer&apos;s screen.
                        </p>

                        <div
                            style={{
                                display: 'flex',
                                gap: 10,
                                justifyContent: 'center',
                                flexWrap: 'wrap',
                                marginBottom: 24,
                            }}
                        >
                            {choices.map((emoji) => (
                                <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => pickEmoji(emoji)}
                                    disabled={busy}
                                    style={emojiBtnStyle}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
                                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.45)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
                                    }}
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>

                        {busy && (
                            <p style={{ ...subStyle, display: 'flex', gap: 6, justifyContent: 'center' }}>
                                <Loader2 size={15} className="animate-spin" /> Connecting…
                            </p>
                        )}
                        {error && <p style={errorStyle}>{error}</p>}
                    </>
                )}

                {/* ── Step 3 — connected ────────────────────────────────────── */}
                {step === 'connected' && (
                    <>
                        <h1 style={titleStyle}>Connected</h1>
                        <p style={subStyle}>
                            {machineName ? (
                                <>
                                    <b style={{ color: INK }}>{machineName}</b> is now linked. Sonoma Code
                                    has terminal access to this machine.
                                </>
                            ) : (
                                'Your device is linked. Sonoma Code has terminal access to this machine.'
                            )}
                        </p>

                        <button
                            type="button"
                            onClick={() => router.push('/code')}
                            style={primaryBtnStyle(true)}
                        >
                            Open Code
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

// ── styles ──────────────────────────────────────────────────────────────────
const backBtnStyle: React.CSSProperties = {
    position: 'absolute',
    top: 16,
    left: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    borderRadius: 9999,
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'rgba(255,255,255,0.05)',
    color: INK,
    fontSize: 13,
    cursor: 'pointer',
};

const iconWrapStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
    height: 56,
    borderRadius: 16,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    marginBottom: 20,
};

const titleStyle: React.CSSProperties = {
    fontSize: 24,
    fontWeight: 600,
    color: INK,
    margin: '0 0 8px',
};

const subStyle: React.CSSProperties = {
    fontSize: 14,
    color: MUTED,
    margin: '0 0 28px',
    lineHeight: 1.5,
};

const codeTokenStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono, monospace)',
    background: 'rgba(255,255,255,0.08)',
    padding: '1px 6px',
    borderRadius: 6,
    color: INK,
};

const errorStyle: React.CSSProperties = {
    color: '#f87171',
    fontSize: 13,
    margin: '0 0 16px',
};

const emojiBtnStyle: React.CSSProperties = {
    width: 60,
    height: 60,
    fontSize: 30,
    lineHeight: '60px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 14,
    cursor: 'pointer',
    transition: 'background 120ms, border-color 120ms',
};

const installCardStyle: React.CSSProperties = {
    marginTop: 28,
    padding: 16,
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.03)',
    textAlign: 'left',
};

const installHeaderStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 13,
    fontWeight: 600,
    color: INK,
    margin: '0 0 8px',
};

const installBtnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    padding: '11px 16px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(255,255,255,0.08)',
    color: INK,
    fontSize: 13.5,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 120ms',
};

const installStepStyle: React.CSSProperties = {
    fontSize: 12.5,
    color: MUTED,
    margin: '0 0 8px',
    lineHeight: 1.5,
};

const installCmdRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'stretch',
    gap: 8,
};

const installCmdStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    overflowX: 'auto',
    whiteSpace: 'nowrap',
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: 12.5,
    color: INK,
    background: 'rgba(0,0,0,0.45)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 9,
    padding: '10px 12px',
};

const copyBtnStyle: React.CSSProperties = {
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    borderRadius: 9,
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'rgba(255,255,255,0.06)',
    color: INK,
    cursor: 'pointer',
};

function primaryBtnStyle(active: boolean): React.CSSProperties {
    return {
        width: '100%',
        padding: '12px 16px',
        borderRadius: 12,
        border: 'none',
        background: active ? INK : 'rgba(255,255,255,0.1)',
        color: active ? '#000' : 'rgba(255,255,255,0.4)',
        fontSize: 15,
        fontWeight: 600,
        cursor: active ? 'pointer' : 'not-allowed',
    };
}
