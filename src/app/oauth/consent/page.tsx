'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SonomaLogo } from '@/components/Sonoma/icons';

// Consent screen for the MCP OAuth flow. Reached (via /api/oauth/authorize)
// when an external client — Claude, Codex, Cursor, etc. — wants to act on the
// user's Sonoma account. The user signs in (if needed) and approves the grant.

const SCOPE_LABELS: Record<string, string> = {
    mcp: 'Use Sonoma tools (chat with your models, search the web, read your saved memory)',
    offline_access: 'Stay connected without asking again (refresh access)',
};

function ConsentInner() {
    const params = useSearchParams();
    const [status, setStatus] = useState<'checking' | 'anon' | 'ready' | 'submitting'>('checking');
    const [email, setEmail] = useState<string | null>(null);
    const [error, setError] = useState('');

    const clientId = params.get('client_id') || '';
    const redirectUri = params.get('redirect_uri') || '';
    const scope = params.get('scope') || 'mcp';

    const appHost = useMemo(() => {
        try {
            return new URL(redirectUri).host;
        } catch {
            return redirectUri || 'an application';
        }
    }, [redirectUri]);

    const scopeList = useMemo(
        () => scope.split(/\s+/).filter(Boolean),
        [scope],
    );

    // Check whether the user is signed in to Sonoma.
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
                if (!alive) return;
                if (res.ok) {
                    const data = (await res.json()) as { user?: { email?: string } };
                    setEmail(data.user?.email ?? null);
                    setStatus('ready');
                } else {
                    setStatus('anon');
                }
            } catch {
                if (alive) setStatus('anon');
            }
        })();
        return () => {
            alive = false;
        };
    }, []);

    async function decide(approve: boolean) {
        setError('');
        setStatus('submitting');
        try {
            const res = await fetch('/api/oauth/authorize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    client_id: clientId,
                    redirect_uri: redirectUri,
                    code_challenge: params.get('code_challenge'),
                    code_challenge_method: params.get('code_challenge_method') || 'S256',
                    scope,
                    state: params.get('state'),
                    resource: params.get('resource'),
                    approve,
                }),
            });
            const data = (await res.json()) as { redirect?: string; error?: string };
            if (res.status === 401) {
                setStatus('anon');
                return;
            }
            if (!res.ok || !data.redirect) {
                throw new Error(data.error || 'Authorization failed.');
            }
            const scheme = new URL(data.redirect).protocol.toLowerCase();
            if (scheme === 'javascript:' || scheme === 'data:' || scheme === 'vbscript:') {
                throw new Error('Unsafe redirect target.');
            }
            window.location.href = data.redirect;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Authorization failed.');
            setStatus('ready');
        }
    }

    const cardStyle: React.CSSProperties = {
        background: 'var(--sonoma-surface)',
        border: '1px solid var(--sonoma-border)',
        borderRadius: 20,
        boxShadow: 'var(--sonoma-shadow-lg)',
        padding: 28,
        maxWidth: 440,
        width: '100%',
    };

    if (status === 'checking') {
        return <p style={{ color: 'var(--sonoma-muted)' }}>Loading…</p>;
    }

    if (status === 'anon') {
        const nextUrl = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';
        return (
            <div style={cardStyle}>
                <Header />
                <p style={{ color: 'var(--sonoma-ink-2)', marginTop: 16 }}>
                    Sign in to your Sonoma account to connect <strong>{appHost}</strong>.
                </p>
                <a
                    href={`/login?next=${encodeURIComponent(nextUrl)}`}
                    style={{
                        display: 'inline-flex',
                        marginTop: 20,
                        padding: '10px 18px',
                        borderRadius: 12,
                        background: 'var(--sonoma-accent)',
                        color: '#fff',
                        fontWeight: 600,
                        textDecoration: 'none',
                    }}
                >
                    Sign in to continue
                </a>
            </div>
        );
    }

    return (
        <div style={cardStyle}>
            <Header />
            <p style={{ color: 'var(--sonoma-ink-2)', marginTop: 16, lineHeight: 1.5 }}>
                <strong>{appHost}</strong> wants to connect to your Sonoma account
                {email ? (
                    <>
                        {' '}(<span style={{ color: 'var(--sonoma-ink)' }}>{email}</span>)
                    </>
                ) : null}
                . It will be able to:
            </p>
            <ul style={{ margin: '14px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
                {scopeList.map((s) => (
                    <li
                        key={s}
                        style={{
                            display: 'flex',
                            gap: 10,
                            alignItems: 'flex-start',
                            color: 'var(--sonoma-ink-2)',
                            fontSize: 14,
                        }}
                    >
                        <span style={{ color: 'var(--sonoma-accent-2)', marginTop: 1 }}>✓</span>
                        <span>{SCOPE_LABELS[s] ?? s}</span>
                    </li>
                ))}
            </ul>

            {error && (
                <p style={{ color: '#d33', marginTop: 16, fontSize: 13 }}>{error}</p>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                <button
                    type="button"
                    onClick={() => decide(false)}
                    disabled={status === 'submitting'}
                    style={{
                        flex: 1,
                        padding: '10px 0',
                        borderRadius: 12,
                        border: '1px solid var(--sonoma-border)',
                        background: 'var(--sonoma-surface)',
                        color: 'var(--sonoma-ink-2)',
                        fontWeight: 600,
                        cursor: 'pointer',
                    }}
                >
                    Deny
                </button>
                <button
                    type="button"
                    onClick={() => decide(true)}
                    disabled={status === 'submitting'}
                    style={{
                        flex: 1,
                        padding: '10px 0',
                        borderRadius: 12,
                        border: 'none',
                        background: 'var(--sonoma-accent)',
                        color: '#fff',
                        fontWeight: 600,
                        cursor: status === 'submitting' ? 'wait' : 'pointer',
                    }}
                >
                    {status === 'submitting' ? 'Authorizing…' : 'Authorize'}
                </button>
            </div>
        </div>
    );
}

function Header() {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SonomaLogo size={26} color="var(--sonoma-accent)" />
            <span
                style={{
                    fontFamily: 'var(--font-serif)',
                    fontSize: 20,
                    fontWeight: 500,
                    color: 'var(--sonoma-ink)',
                }}
            >
                Authorize access
            </span>
        </div>
    );
}

export default function ConsentPage() {
    return (
        <main
            style={{
                minHeight: '100dvh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
                background: 'var(--sonoma-bg)',
            }}
        >
            <Suspense fallback={<p style={{ color: 'var(--sonoma-muted)' }}>Loading…</p>}>
                <ConsentInner />
            </Suspense>
        </main>
    );
}
