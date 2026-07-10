import { headers } from 'next/headers';
import { SonomaLogo } from '@/components/Sonoma/icons';

export const dynamic = 'force-dynamic';

async function baseUrl(): Promise<string> {
    const explicit = process.env.NEXT_PUBLIC_APP_URL;
    if (explicit) return explicit.replace(/\/$/, '');
    const h = await headers();
    const proto = h.get('x-forwarded-proto') || 'https';
    const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
    return `${proto}://${host}`;
}

function Block({ children }: { children: React.ReactNode }) {
    return (
        <pre
            style={{
                background: 'var(--sonoma-surface-2, rgba(0,0,0,0.04))',
                border: '1px solid var(--sonoma-border)',
                borderRadius: 12,
                padding: '14px 16px',
                overflowX: 'auto',
                fontSize: 13,
                lineHeight: 1.6,
                color: 'var(--sonoma-ink)',
                margin: '10px 0 0',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
        >
            <code>{children}</code>
        </pre>
    );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
    return (
        <section style={{ marginTop: 30 }}>
            <h2 style={{ fontSize: 17, fontWeight: 600, color: 'var(--sonoma-ink)', display: 'flex', gap: 10, alignItems: 'center' }}>
                <span
                    style={{
                        display: 'inline-flex',
                        width: 26,
                        height: 26,
                        borderRadius: 999,
                        background: 'var(--sonoma-accent)',
                        color: '#fff',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 13,
                    }}
                >
                    {n}
                </span>
                {title}
            </h2>
            <div style={{ marginTop: 8, color: 'var(--sonoma-ink-2)', fontSize: 14, lineHeight: 1.6 }}>{children}</div>
        </section>
    );
}

export default async function McpConnectPage() {
    const base = await baseUrl();
    const mcpUrl = `${base}/api/mcp`;

    return (
        <main
            style={{
                minHeight: '100dvh',
                background: 'var(--sonoma-bg)',
                padding: '48px 20px',
            }}
        >
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <SonomaLogo size={28} color="var(--sonoma-accent)" />
                    <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 30, fontWeight: 500, color: 'var(--sonoma-ink)' }}>
                        Connect Sonoma over MCP
                    </h1>
                </div>
                <p style={{ marginTop: 12, color: 'var(--sonoma-muted)', fontSize: 15, lineHeight: 1.6 }}>
                    Add Sonoma as a remote MCP server in Claude, Codex, Cursor, or any MCP-capable client.
                    Your client signs you in through Sonoma (OAuth) — no API keys to copy or paste. Once
                    connected, the model can call your Sonoma tools: <strong>sonoma_chat</strong>,{' '}
                    <strong>web_search</strong>, and <strong>memory_search</strong>.
                </p>

                <div
                    style={{
                        marginTop: 24,
                        padding: '14px 16px',
                        borderRadius: 12,
                        border: '1px solid var(--sonoma-border)',
                        background: 'var(--sonoma-surface)',
                    }}
                >
                    <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--sonoma-muted)' }}>
                        MCP server URL
                    </div>
                    <div style={{ marginTop: 4, fontSize: 15, fontFamily: 'ui-monospace, monospace', color: 'var(--sonoma-ink)' }}>
                        {mcpUrl}
                    </div>
                </div>

                <Step n={1} title="Claude Code (CLI)">
                    Run this in your terminal — Claude opens a browser to authorize:
                    <Block>{`claude mcp add --transport http sonoma ${mcpUrl}`}</Block>
                </Step>

                <Step n={2} title="Claude Desktop / claude.ai">
                    Settings → Connectors → <em>Add custom connector</em>. Paste the URL above. Click
                    <em> Connect</em> and approve on the Sonoma screen that opens.
                    <Block>{mcpUrl}</Block>
                </Step>

                <Step n={3} title="ChatGPT / Codex">
                    Add an MCP server pointing at the URL below. It advertises OAuth automatically, so the
                    client will prompt you to sign in to Sonoma on first use.
                    <Block>{`{
  "mcpServers": {
    "sonoma": {
      "type": "http",
      "url": "${mcpUrl}"
    }
  }
}`}</Block>
                </Step>

                <Step n={4} title="Cursor / other clients">
                    Any client that supports remote (HTTP) MCP servers with OAuth works the same way —
                    add the URL, then complete the sign-in prompt.
                    <Block>{mcpUrl}</Block>
                </Step>

                <p style={{ marginTop: 36, color: 'var(--sonoma-faint)', fontSize: 13 }}>
                    Authorization uses OAuth 2.1 (PKCE). You approve each app on a Sonoma consent screen and
                    can’t be connected without signing in. Tools run in your account’s context.
                </p>
            </div>
        </main>
    );
}
