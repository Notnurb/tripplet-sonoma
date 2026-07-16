'use client';

// Settings → Connectors: link third-party apps (GitHub, Gmail, Notion, …) via
// Composio so Sonoma can act on the user's real accounts with `composio_*`
// tools. Backed by /api/composio/{apps,connections}.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HugeiconsIcon } from '@hugeicons/react';
import { Loading01Icon, Delete02Icon, CheckmarkCircle01Icon } from '@hugeicons/core-free-icons';

interface ConnectorApp {
    slug: string;
    name: string;
    description: string;
    logo: string;
    categories: string[];
    noAuth: boolean;
}

interface Connection {
    id: string;
    app: string;
    status: string; // INITIALIZING | INITIATED | ACTIVE | FAILED | EXPIRED | INACTIVE | REVOKED
    statusReason: string | null;
    createdAt: string;
    isDisabled: boolean;
}

function statusBadge(status: string): { label: string; color: string } {
    switch (status) {
        case 'ACTIVE':
            return { label: 'Connected', color: 'text-emerald-500' };
        case 'INITIALIZING':
        case 'INITIATED':
            return { label: 'Pending — finish sign-in', color: 'text-amber-500' };
        default:
            return { label: status.toLowerCase(), color: 'text-destructive' };
    }
}

function appTitle(slug: string): string {
    return slug.charAt(0).toUpperCase() + slug.slice(1);
}

export default function ConnectorsPanel() {
    const [connections, setConnections] = useState<Connection[] | null>(null);
    const [apps, setApps] = useState<ConnectorApp[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [searching, setSearching] = useState(false);
    const [search, setSearch] = useState('');
    const [connectingSlug, setConnectingSlug] = useState<string | null>(null);
    // 503 NOT_CONFIGURED → deployment has no COMPOSIO_API_KEY; show setup help.
    const [notConfigured, setNotConfigured] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchConnections = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/composio/connections');
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (res.status === 401) {
                    setConnections([]);
                    return;
                }
                if (data?.code === 'NOT_CONFIGURED') {
                    setNotConfigured(true);
                    setConnections([]);
                    return;
                }
                throw new Error(data?.error || `Server returned ${res.status}`);
            }
            setNotConfigured(false);
            setConnections(data.connections ?? []);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load connections');
            setConnections([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchApps = useCallback(async (query: string) => {
        setSearching(true);
        try {
            const qs = query ? `?search=${encodeURIComponent(query)}` : '';
            const res = await fetch(`/api/composio/apps${qs}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (data?.code === 'NOT_CONFIGURED') {
                    setNotConfigured(true);
                    setApps([]);
                    return;
                }
                throw new Error(data?.error || `Server returned ${res.status}`);
            }
            setApps(data.apps ?? []);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to load apps');
            setApps([]);
        } finally {
            setSearching(false);
        }
    }, []);

    useEffect(() => {
        fetchConnections();
        fetchApps('');
        // Returning from the hosted OAuth consent (?connector=done): refresh
        // and clean the URL so a reload doesn't re-toast.
        if (typeof window !== 'undefined' && window.location.search.includes('connector=done')) {
            toast.success('App connected — Sonoma can use it now');
            const url = new URL(window.location.href);
            url.searchParams.delete('connector');
            window.history.replaceState(null, '', url.pathname + url.search);
        }
    }, [fetchConnections, fetchApps]);

    const connect = useCallback(async (slug: string) => {
        setConnectingSlug(slug);
        try {
            const res = await fetch('/api/composio/connections', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ app: slug }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Could not start the connection');
            if (data.redirectUrl) {
                // Hosted OAuth consent — full-page navigation is the reliable
                // path (popups get blocked); Composio redirects back here.
                window.location.href = data.redirectUrl;
                return;
            }
            // No-auth apps activate immediately.
            toast.success(`${appTitle(slug)} connected`);
            await fetchConnections();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not start the connection');
        } finally {
            setConnectingSlug(null);
        }
    }, [fetchConnections]);

    const disconnect = useCallback(async (conn: Connection) => {
        if (!confirm(`Disconnect ${appTitle(conn.app)}? Sonoma will lose access to it.`)) return;
        try {
            const res = await fetch(`/api/composio/connections?id=${encodeURIComponent(conn.id)}`, {
                method: 'DELETE',
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Could not remove connection');
            setConnections((prev) => (prev ? prev.filter((c) => c.id !== conn.id) : prev));
            toast.success(`${appTitle(conn.app)} disconnected`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not remove connection');
        }
    }, []);

    // Failed/expired connections don't block a reconnect from the catalog.
    const connectedSlugs = new Set(
        (connections ?? [])
            .filter((c) => ['ACTIVE', 'INITIATED', 'INITIALIZING'].includes(c.status))
            .map((c) => c.app),
    );

    return (
        <section className="space-y-4">
            <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Connectors
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                    Link your apps (GitHub, Gmail, Notion, Slack, …) so Sonoma can read your data and act
                    for you — powered by Composio. You approve each app via its own sign-in.
                </p>
            </div>

            {notConfigured && (
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-1.5">
                    <div className="text-sm font-medium">Connectors are not set up on this deployment</div>
                    <p className="text-xs text-muted-foreground">
                        Add a <span className="font-mono">COMPOSIO_API_KEY</span> environment variable (free key at{' '}
                        <a
                            href="https://composio.dev"
                            target="_blank"
                            rel="noreferrer"
                            className="underline text-foreground font-medium hover:opacity-80"
                        >
                            composio.dev
                        </a>
                        ) and restart the server to enable app connections.
                    </p>
                </div>
            )}

            {!notConfigured && (
                <>
                    {/* Connected accounts */}
                    <div className="rounded-xl border border-border p-5 space-y-3">
                        <div>
                            <div className="text-sm font-medium">
                                Your connections
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    ({connections?.length ?? 0})
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Sonoma gets tools for every connected app and always acts as you.
                            </p>
                        </div>

                        {loading && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                                <HugeiconsIcon icon={Loading01Icon} className="animate-spin" size={14} />
                                Loading…
                            </div>
                        )}

                        {error && (
                            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
                                <p className="text-xs text-destructive">{error}</p>
                                <button
                                    type="button"
                                    onClick={fetchConnections}
                                    className="mt-1 text-[11px] font-medium underline text-destructive hover:opacity-80"
                                >
                                    Retry
                                </button>
                            </div>
                        )}

                        {!loading && connections && connections.length === 0 && !error && (
                            <div className="text-xs text-muted-foreground py-2">
                                Nothing connected yet — pick an app below to get started.
                            </div>
                        )}

                        {!loading && connections && connections.length > 0 && (
                            <ul className="space-y-1.5">
                                {connections.map((c) => {
                                    const badge = statusBadge(c.status);
                                    return (
                                        <li
                                            key={c.id}
                                            className="group flex items-center gap-3 rounded-lg border border-border bg-background hover:bg-muted/30 px-3 py-2 transition-colors"
                                        >
                                            <HugeiconsIcon
                                                icon={CheckmarkCircle01Icon}
                                                size={16}
                                                className={c.status === 'ACTIVE' ? 'text-emerald-500' : 'text-muted-foreground'}
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[13px] font-medium">{appTitle(c.app)}</div>
                                                <div className={`text-[11px] ${badge.color}`}>
                                                    {badge.label}
                                                    {c.statusReason ? ` — ${c.statusReason}` : ''}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => disconnect(c)}
                                                title={`Disconnect ${appTitle(c.app)}`}
                                                aria-label={`Disconnect ${appTitle(c.app)}`}
                                                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1 rounded-md hover:bg-destructive/10"
                                            >
                                                <HugeiconsIcon icon={Delete02Icon} size={14} />
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>

                    {/* App catalog */}
                    <div className="rounded-xl border border-border p-5 space-y-3">
                        <div>
                            <div className="text-sm font-medium">Add a connector</div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Popular apps shown first — search for anything else.
                            </p>
                        </div>
                        <form
                            className="flex gap-2"
                            onSubmit={(e) => {
                                e.preventDefault();
                                fetchApps(search.trim());
                            }}
                        >
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search apps (e.g. github, gmail, notion)…"
                            />
                            <Button type="submit" variant="outline" disabled={searching}>
                                {searching && <HugeiconsIcon icon={Loading01Icon} className="animate-spin mr-2" size={14} />}
                                Search
                            </Button>
                        </form>

                        {apps === null || searching ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                                <HugeiconsIcon icon={Loading01Icon} className="animate-spin" size={14} />
                                Loading apps…
                            </div>
                        ) : apps.length === 0 ? (
                            <div className="text-xs text-muted-foreground py-2">No apps found.</div>
                        ) : (
                            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[420px] overflow-y-auto pr-1">
                                {apps.map((app) => {
                                    const connected = connectedSlugs.has(app.slug);
                                    return (
                                        <li
                                            key={app.slug}
                                            className="flex items-start gap-2.5 rounded-lg border border-border bg-background px-3 py-2.5"
                                        >
                                            {app.logo ? (
                                                // eslint-disable-next-line @next/next/no-img-element -- remote CDN logos, tiny, unknown domains
                                                <img
                                                    src={app.logo}
                                                    alt=""
                                                    width={20}
                                                    height={20}
                                                    className="mt-0.5 h-5 w-5 rounded object-contain"
                                                />
                                            ) : (
                                                <div className="mt-0.5 h-5 w-5 rounded bg-muted" />
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[13px] font-medium truncate">{app.name}</div>
                                                <p className="text-[11px] text-muted-foreground line-clamp-2">
                                                    {app.description}
                                                </p>
                                            </div>
                                            <Button
                                                size="sm"
                                                variant={connected || app.noAuth ? 'outline' : 'default'}
                                                disabled={connected || app.noAuth || connectingSlug === app.slug}
                                                title={app.noAuth ? 'This app needs no sign-in — its tools work without connecting' : undefined}
                                                onClick={() => connect(app.slug)}
                                            >
                                                {connectingSlug === app.slug && (
                                                    <HugeiconsIcon icon={Loading01Icon} className="animate-spin mr-2" size={14} />
                                                )}
                                                {connected ? 'Connected' : app.noAuth ? 'No sign-in' : 'Connect'}
                                            </Button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </>
            )}
        </section>
    );
}
