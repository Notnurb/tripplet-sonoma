'use client';

// Connectors menu for the Sonoma composer: a ToolChip-style trigger that opens
// an upward popover (same interaction pattern as ModelMenu) where the user can
// see their connected apps, link new ones, and disconnect — without leaving
// the chat. Backed by /api/composio/{apps,connections}; deep management stays
// in Settings → Connectors.
//
// The OAuth consent is a full-page redirect; POST passes the current path as
// returnTo so Composio drops the user back on this chat page with
// ?connector=done, which auto-opens the menu to show the new connection.

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { SonomaPlug, SonomaX } from './icons';

interface Connection {
    id: string;
    app: string;
    status: string; // INITIALIZING | INITIATED | ACTIVE | FAILED | EXPIRED | INACTIVE | REVOKED
    statusReason: string | null;
    createdAt: string;
    isDisabled: boolean;
}

interface CatalogApp {
    slug: string;
    name: string;
    description: string;
    logo: string;
    categories: string[];
    noAuth: boolean;
}

type MenuStatus =
    | 'loading'
    | 'ready'
    | 'signed-out'      // 401 — guests can open the menu but must sign in to connect
    | 'not-configured'  // 503 — deployment has no COMPOSIO_API_KEY
    | 'error';

function appTitle(slug: string): string {
    return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function connectionDot(status: string): { color: string; label: string } {
    switch (status) {
        case 'ACTIVE':
            return { color: 'var(--sonoma-ok)', label: 'connected' };
        case 'INITIALIZING':
        case 'INITIATED':
            return { color: 'var(--sonoma-accent)', label: 'pending — finish sign-in' };
        default:
            return { color: 'var(--destructive)', label: status.toLowerCase() };
    }
}

export default function ConnectorsMenu({ compact }: { compact?: boolean }) {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState<MenuStatus>('loading');
    const [connections, setConnections] = useState<Connection[]>([]);
    const [apps, setApps] = useState<CatalogApp[] | null>(null);
    const [search, setSearch] = useState('');
    const [searching, setSearching] = useState(false);
    const [connectingSlug, setConnectingSlug] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function onDoc(e: MouseEvent) {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, []);

    const loadConnections = useCallback(async () => {
        setStatus('loading');
        setActionError(null);
        try {
            const res = await fetch('/api/composio/connections');
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (res.status === 401) return setStatus('signed-out');
                if (data?.code === 'NOT_CONFIGURED') return setStatus('not-configured');
                throw new Error(data?.error || `Server returned ${res.status}`);
            }
            setConnections(data.connections ?? []);
            setStatus('ready');
        } catch {
            setStatus('error');
        }
    }, []);

    const loadApps = useCallback(async (query: string) => {
        setSearching(true);
        try {
            const qs = query ? `?search=${encodeURIComponent(query)}` : '';
            const res = await fetch(`/api/composio/apps${qs}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`);
            setApps(data.apps ?? []);
        } catch {
            setApps([]);
        } finally {
            setSearching(false);
        }
    }, []);

    // Fetch fresh on every open — cheap list calls, and the user may have just
    // finished an OAuth consent in another tab.
    useEffect(() => {
        if (!open) return;
        void loadConnections();
        void loadApps('');
    }, [open, loadConnections, loadApps]);

    // Returning from the hosted OAuth consent (?connector=done): clean the URL
    // and auto-open so the new connection is visible right where it was made.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const url = new URL(window.location.href);
        if (url.searchParams.get('connector') !== 'done') return;
        url.searchParams.delete('connector');
        window.history.replaceState(null, '', url.pathname + (url.search || ''));
        setOpen(true);
    }, []);

    const connect = useCallback(
        async (slug: string) => {
            setConnectingSlug(slug);
            setActionError(null);
            try {
                const res = await fetch('/api/composio/connections', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ app: slug, returnTo: pathname || '/chat' }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data?.error || 'Could not start the connection');
                if (data.redirectUrl) {
                    window.location.href = data.redirectUrl; // hosted OAuth consent
                    return;
                }
                await loadConnections(); // no-auth apps activate immediately
            } catch (e) {
                setActionError(e instanceof Error ? e.message : 'Could not start the connection');
            } finally {
                setConnectingSlug(null);
            }
        },
        [pathname, loadConnections],
    );

    const disconnect = useCallback(
        async (conn: Connection) => {
            if (!confirm(`Disconnect ${appTitle(conn.app)}? Tripplet will lose access to it.`)) return;
            setActionError(null);
            try {
                const res = await fetch(`/api/composio/connections?id=${encodeURIComponent(conn.id)}`, {
                    method: 'DELETE',
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data?.error || 'Could not remove connection');
                setConnections((prev) => prev.filter((c) => c.id !== conn.id));
            } catch (e) {
                setActionError(e instanceof Error ? e.message : 'Could not remove connection');
            }
        },
        [],
    );

    const activeCount = connections.filter((c) => c.status === 'ACTIVE' && !c.isDisabled).length;
    const chipActive = open || activeCount > 0;
    const liveSlugs = new Set(
        connections
            .filter((c) => ['ACTIVE', 'INITIATED', 'INITIALIZING'].includes(c.status))
            .map((c) => c.app),
    );

    const chipPalette: React.CSSProperties = {
        border: `1px solid ${chipActive ? 'color-mix(in oklch, var(--sonoma-accent) 50%, transparent)' : 'var(--sonoma-border)'}`,
        background: chipActive ? 'var(--sonoma-accent-soft)' : 'var(--sonoma-surface)',
        color: chipActive ? 'var(--sonoma-accent-2)' : 'var(--sonoma-ink-2)',
        boxShadow: 'var(--sonoma-shadow-sm)',
    };
    const label = activeCount > 0 ? `Apps · ${activeCount}` : 'Apps';

    const rowText: React.CSSProperties = { color: 'var(--sonoma-ink)', fontSize: 13, fontWeight: 500 };
    const faint: React.CSSProperties = { color: 'var(--sonoma-muted)', fontSize: 11.5 };

    return (
        <div ref={wrapRef} className="relative">
            {compact ? (
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-label="Connected apps"
                    title="Connected apps"
                    aria-expanded={open}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors"
                    style={chipPalette}
                >
                    <SonomaPlug />
                </button>
            ) : (
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                    className="inline-flex items-center gap-2 rounded-full text-[13.5px] font-medium transition-colors"
                    style={{ ...chipPalette, padding: '7px 12px 7px 11px' }}
                >
                    <span className="inline-flex" style={{ opacity: chipActive ? 1 : 0.85 }}>
                        <SonomaPlug />
                    </span>
                    <span>{label}</span>
                </button>
            )}

            {open && (
                <div
                    role="dialog"
                    aria-label="Connected apps"
                    className="absolute z-30 flex flex-col"
                    style={{
                        bottom: 'calc(100% + 8px)',
                        left: 0,
                        width: 'min(340px, calc(100vw - 32px))',
                        maxHeight: 'min(440px, 60vh)',
                        background: 'var(--sonoma-surface)',
                        border: '1px solid var(--sonoma-border)',
                        borderRadius: 14,
                        boxShadow: 'var(--sonoma-shadow-lg)',
                        overflow: 'hidden',
                    }}
                >
                    <div
                        className="flex items-center justify-between gap-2"
                        style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--sonoma-border)' }}
                    >
                        <div>
                            <div style={rowText}>Connected apps</div>
                            <div style={faint}>Tripplet can read and act in apps you link.</div>
                        </div>
                        <a
                            href="/settings"
                            style={{ ...faint, color: 'var(--sonoma-accent-2)', whiteSpace: 'nowrap' }}
                            className="hover:underline"
                        >
                            Manage →
                        </a>
                    </div>

                    <div className="sonoma-scroll flex-1 overflow-y-auto" style={{ padding: 10 }}>
                        {status === 'loading' && <div style={{ ...faint, padding: '8px 2px' }}>Loading…</div>}

                        {status === 'signed-out' && (
                            <div style={{ padding: '8px 2px' }}>
                                <div style={rowText}>Sign in to connect apps</div>
                                <div style={{ ...faint, marginTop: 3 }}>
                                    Connections are tied to your account, so Tripplet always acts as you.
                                </div>
                                <a
                                    href="/login"
                                    className="mt-2 inline-flex items-center rounded-full text-[12.5px] font-medium"
                                    style={{
                                        padding: '6px 12px',
                                        background: 'var(--sonoma-accent)',
                                        color: '#fff',
                                    }}
                                >
                                    Sign in
                                </a>
                            </div>
                        )}

                        {status === 'not-configured' && (
                            <div style={{ ...faint, padding: '8px 2px', lineHeight: 1.5 }}>
                                Connectors are not set up on this deployment. Add a{' '}
                                <code style={{ fontFamily: 'var(--font-mono)' }}>COMPOSIO_API_KEY</code> (free at
                                composio.dev) and restart the server.
                            </div>
                        )}

                        {status === 'error' && (
                            <div style={{ padding: '8px 2px' }}>
                                <div style={{ ...faint, color: 'var(--destructive)' }}>
                                    Could not load your connections.
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void loadConnections()}
                                    className="mt-1 text-[12px] font-medium hover:underline"
                                    style={{ color: 'var(--sonoma-accent-2)' }}
                                >
                                    Retry
                                </button>
                            </div>
                        )}

                        {status === 'ready' && (
                            <>
                                {actionError && (
                                    <div
                                        style={{
                                            ...faint,
                                            color: 'var(--destructive)',
                                            padding: '2px 2px 8px',
                                        }}
                                    >
                                        {actionError}
                                    </div>
                                )}

                                {connections.length > 0 ? (
                                    <ul className="flex flex-col gap-1" style={{ marginBottom: 10 }}>
                                        {connections.map((c) => {
                                            const dot = connectionDot(c.status);
                                            return (
                                                <li
                                                    key={c.id}
                                                    className="group flex items-center gap-2.5 rounded-[10px]"
                                                    style={{
                                                        padding: '7px 8px',
                                                        border: '1px solid var(--sonoma-border)',
                                                        background: 'var(--sonoma-bg-2)',
                                                    }}
                                                >
                                                    <span
                                                        className="h-2 w-2 flex-shrink-0 rounded-full"
                                                        style={{ background: dot.color }}
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                        <div style={rowText}>{appTitle(c.app)}</div>
                                                        <div className="truncate" style={faint}>
                                                            {dot.label}
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => void disconnect(c)}
                                                        title={`Disconnect ${appTitle(c.app)}`}
                                                        aria-label={`Disconnect ${appTitle(c.app)}`}
                                                        className="inline-flex h-6 w-6 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                                                        style={{ color: 'var(--sonoma-muted)' }}
                                                    >
                                                        <SonomaX size={12} />
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                ) : (
                                    <div style={{ ...faint, padding: '0 2px 10px' }}>
                                        Nothing connected yet — link an app below and Tripplet can use it in this
                                        chat.
                                    </div>
                                )}

                                <form
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        void loadApps(search.trim());
                                    }}
                                >
                                    <input
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        placeholder="Search apps (github, gmail, notion…)"
                                        className="w-full rounded-[10px] outline-none"
                                        style={{
                                            padding: '7px 10px',
                                            fontSize: 12.5,
                                            background: 'var(--sonoma-bg-2)',
                                            border: '1px solid var(--sonoma-border)',
                                            color: 'var(--sonoma-ink)',
                                        }}
                                    />
                                </form>

                                <div className="mt-2 flex flex-col gap-1">
                                    {searching || apps === null ? (
                                        <div style={{ ...faint, padding: '4px 2px' }}>Loading apps…</div>
                                    ) : apps.length === 0 ? (
                                        <div style={{ ...faint, padding: '4px 2px' }}>No apps found.</div>
                                    ) : (
                                        apps.map((app) => {
                                            const connected = liveSlugs.has(app.slug);
                                            const busy = connectingSlug === app.slug;
                                            return (
                                                <div
                                                    key={app.slug}
                                                    className="flex items-center gap-2.5 rounded-[10px]"
                                                    style={{ padding: '6px 8px' }}
                                                >
                                                    {app.logo ? (
                                                         
                                                        <img
                                                            src={app.logo}
                                                            alt=""
                                                            width={18}
                                                            height={18}
                                                            className="h-[18px] w-[18px] flex-shrink-0 rounded object-contain"
                                                        />
                                                    ) : (
                                                        <span
                                                            className="h-[18px] w-[18px] flex-shrink-0 rounded"
                                                            style={{ background: 'var(--sonoma-bg-2)' }}
                                                        />
                                                    )}
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate" style={rowText}>
                                                            {app.name}
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        disabled={connected || busy || app.noAuth}
                                                        title={app.noAuth ? 'This app needs no sign-in' : undefined}
                                                        onClick={() => void connect(app.slug)}
                                                        className="rounded-full text-[12px] font-medium transition-colors"
                                                        style={{
                                                            padding: '4px 10px',
                                                            border: '1px solid var(--sonoma-border)',
                                                            background: connected || app.noAuth
                                                                ? 'transparent'
                                                                : 'var(--sonoma-surface)',
                                                            color: connected || app.noAuth
                                                                ? 'var(--sonoma-muted)'
                                                                : 'var(--sonoma-accent-2)',
                                                            cursor: connected || busy || app.noAuth ? 'default' : 'pointer',
                                                        }}
                                                    >
                                                        {connected ? 'Connected' : busy ? 'Opening…' : app.noAuth ? 'No sign-in' : 'Connect'}
                                                    </button>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
