'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { MODEL_CATALOG } from '@/lib/developer-api/catalog';
import {
    Key, Plus, Trash2, Copy, Check, Eye, EyeOff,
    Loader2, AlertTriangle, BookOpen, Cpu, Package, Terminal,
    Shield,
} from 'lucide-react';
import { toast } from 'sonner';

const TIER_COLORS: Record<string, string> = {
    flagship: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    standard: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    legacy: 'bg-muted/50 text-muted-foreground border-border',
    agent: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    experimental: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
};

const TABS = [
    { id: 'keys', label: 'Keys', icon: Key },
    { id: 'models', label: 'Models', icon: Cpu },
    { id: 'quickstart', label: 'Quick Start', icon: Package },
    { id: 'endpoints', label: 'Endpoints', icon: BookOpen },
] as const;

type TabId = (typeof TABS)[number]['id'];

const MODEL_FAMILIES = ['Taipei', 'Majuli', 'Suzhou', 'Tura', 'Agent', 'Synthara'];

const KEYS_STORAGE_KEY = 'tripplet_api_keys';

interface StoredKey {
    id: string;
    key_full: string;
    key_prefix: string;
    name: string;
    created_at: string;
    last_used_at: string | null;
    is_revoked: boolean;
}

function loadLocalKeys(): StoredKey[] {
    try {
        const raw = localStorage.getItem(KEYS_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveLocalKeys(keys: StoredKey[]) {
    localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(keys));
}

function KeyRow({
    apiKey,
    onRevoke,
    revoking,
}: {
    apiKey: StoredKey;
    onRevoke: (id: string) => void;
    revoking: boolean;
}) {
    const [showFull, setShowFull] = useState(false);
    const created = new Date(apiKey.created_at).toLocaleDateString();
    const fullKey = apiKey.key_full || apiKey.key_prefix;
    const canReveal = Boolean(apiKey.key_full);

    return (
        <div className={cn(
            'flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 transition-colors',
            apiKey.is_revoked ? 'opacity-40' : 'hover:bg-muted/10',
        )}>
            <Key size={13} className="text-muted-foreground/50 shrink-0" />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground font-mono">{apiKey.name}</span>
                    {apiKey.is_revoked && (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-rose-400 bg-rose-500/10 border border-rose-500/20 px-1 py-px rounded">
                            revoked
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                    <code className="text-xs font-mono text-muted-foreground">
                        {showFull ? fullKey : apiKey.key_prefix}
                    </code>
                    {canReveal && (
                        <button
                            onClick={() => setShowFull(!showFull)}
                            className="text-muted-foreground/30 hover:text-muted-foreground transition-colors"
                        >
                            {showFull ? <EyeOff size={11} /> : <Eye size={11} />}
                        </button>
                    )}
                </div>
                <p className="text-[10px] text-muted-foreground/40 mt-0.5 font-mono">
                    Created {created}
                    {apiKey.last_used_at && ` · Last used ${new Date(apiKey.last_used_at).toLocaleDateString()}`}
                </p>
            </div>
            {!apiKey.is_revoked && (
                <button
                    onClick={() => onRevoke(apiKey.id)}
                    disabled={revoking}
                    className="shrink-0 text-xs text-muted-foreground/40 hover:text-rose-400 transition-colors flex items-center gap-1"
                >
                    {revoking ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
            )}
        </div>
    );
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
    const [copied, setCopied] = useState(false);

    const copy = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="border border-border overflow-hidden rounded-sm">
            <div className="flex items-center justify-between px-3 py-1.5 bg-muted/20 border-b border-border">
                <span className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider">{lang}</span>
                <button onClick={copy} className="text-muted-foreground/40 hover:text-foreground transition-colors">
                    {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                </button>
            </div>
            <pre className="p-3 text-xs font-mono text-foreground/80 overflow-x-auto leading-relaxed bg-background/60">
                {code}
            </pre>
        </div>
    );
}

export default function ApiDashboardPage() {
    const { user } = useAuth();
    const email = user?.email ?? '';
    const fallbackApiBase = `${(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')}/api/v1`;
    const [tab, setTab] = useState<TabId>('keys');
    const [keys, setKeys] = useState<StoredKey[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [revokingId, setRevokingId] = useState<string | null>(null);
    const [newKeyName, setNewKeyName] = useState('');
    const [justCreatedKey, setJustCreatedKey] = useState<string | null>(null);
    const [keyCopied, setKeyCopied] = useState(false);
    const [publicApiBase, setPublicApiBase] = useState(fallbackApiBase);

    useEffect(() => {
        setKeys(loadLocalKeys());
        setLoading(false);
    }, []);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            setPublicApiBase(`${window.location.origin}/api/v1`);
        }
    }, []);

    useEffect(() => {
        if (!email) return;
        (async () => {
            try {
                const res = await fetch('/api/developer/keys');
                if (res.ok) {
                    const data = await res.json();
                    const local = loadLocalKeys();
                    const localById = new Map(local.map(k => [k.id, k]));
                    const merged = Array.isArray(data.keys)
                        ? data.keys.map((remoteKey: Omit<StoredKey, 'key_full'>) => ({
                            ...remoteKey,
                            key_full: localById.get(remoteKey.id)?.key_full || '',
                        }))
                        : local;
                    saveLocalKeys(merged);
                    setKeys(merged);
                }
            } catch { /* Supabase not configured — use local only */ }
        })();
    }, [email]);

    const handleCreate = useCallback(async () => {
        if (!email) {
            toast.error('Sign in to create a working API key.');
            return;
        }
        setCreating(true);
        setJustCreatedKey(null);
        try {
            const res = await fetch('/api/developer/keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newKeyName.trim() || 'Default' }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(typeof data.error === 'string' ? data.error : 'Failed to create API key.');
            }
            const newKey: StoredKey = {
                id: data.id,
                key_full: data.key,
                key_prefix: data.key_prefix,
                name: data.name,
                created_at: data.created_at,
                last_used_at: null,
                is_revoked: false,
            };
            const updated = [newKey, ...keys.filter(k => k.id !== newKey.id)];
            saveLocalKeys(updated);
            setKeys(updated);
            setJustCreatedKey(data.key);
            setNewKeyName('');
            toast.success('Key created');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to create API key.';
            toast.error(message);
        } finally {
            setCreating(false);
        }
    }, [keys, newKeyName, email]);

    const handleRevoke = useCallback(async (id: string) => {
        setRevokingId(id);
        try {
            const res = await fetch('/api/developer/keys', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(typeof data.error === 'string' ? data.error : 'Failed to revoke key.');
            }
            const updated = keys.map(k => k.id === id ? { ...k, is_revoked: true } : k);
            saveLocalKeys(updated);
            setKeys(updated);
            toast('Key revoked');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to revoke key.';
            toast.error(message);
        } finally {
            setRevokingId(null);
        }
    }, [keys]);

    const copyNewKey = () => {
        if (!justCreatedKey) return;
        navigator.clipboard.writeText(justCreatedKey);
        setKeyCopied(true);
        setTimeout(() => setKeyCopied(false), 2000);
    };

    const activeKeys = keys.filter(k => !k.is_revoked);

    return (
        <div className="flex flex-col h-full overflow-hidden bg-background">
            {/* Header */}
            <div className="shrink-0 px-6 pt-5 pb-0 border-b border-border">
                <div className="flex items-center gap-2.5 mb-3">
                    <Terminal size={16} className="text-foreground/70" />
                    <h1 className="text-base font-semibold text-foreground font-mono tracking-tight">Console</h1>
                    <span className="text-[9px] font-mono text-muted-foreground/40 bg-muted/30 border border-border px-1.5 py-px rounded-sm">
                        v1
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                        <Shield size={11} className="text-emerald-400/60" />
                        <span className="text-[10px] font-mono text-muted-foreground/40">TLS 1.3</span>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-0 -mb-px">
                    {TABS.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            onClick={() => setTab(id)}
                            className={cn(
                                'flex items-center gap-1.5 px-4 py-2 text-xs font-mono font-medium border-b-2 transition-colors',
                                tab === id
                                    ? 'border-foreground text-foreground'
                                    : 'border-transparent text-muted-foreground/50 hover:text-muted-foreground hover:border-border',
                            )}
                        >
                            <Icon size={11} />
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
                <div className="max-w-3xl">

                    {/* ── API Keys ── */}
                    {tab === 'keys' && (
                        <div className="space-y-4">
                            <div>
                                <h2 className="text-sm font-semibold text-foreground font-mono mb-1">API Keys</h2>
                                <p className="text-xs text-muted-foreground/70">
                                    Keys authenticate requests to the Tripplet API. Treat them like passwords — never share or commit them.
                                    Maximum 5 active keys per account.
                                </p>
                            </div>

                            {/* Create key */}
                            <div className="flex gap-2">
                                <input
                                    value={newKeyName}
                                    onChange={e => setNewKeyName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                                    placeholder="Key name (e.g. production, staging)..."
                                    className="flex-1 bg-transparent border border-border rounded-sm px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-foreground/30 transition-colors"
                                />
                                <button
                                    onClick={handleCreate}
                                    disabled={creating || activeKeys.length >= 5}
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-sm bg-foreground text-background text-xs font-mono font-semibold hover:opacity-85 transition-opacity disabled:opacity-30"
                                >
                                    {creating ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                                    Generate
                                </button>
                            </div>

                            {/* Just-created key */}
                            {justCreatedKey && (
                                <div className="border border-amber-500/25 bg-amber-500/5 rounded-sm px-4 py-3 space-y-2">
                                    <div className="flex items-center gap-2">
                                        <AlertTriangle size={12} className="text-amber-400 shrink-0" />
                                        <p className="text-xs text-foreground font-mono">
                                            Copy now — the full key will not be shown again.
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <code className="flex-1 text-xs font-mono text-emerald-400 bg-background/60 px-3 py-2 rounded-sm border border-border select-all break-all">
                                            {justCreatedKey}
                                        </code>
                                        <button
                                            onClick={copyNewKey}
                                            className="shrink-0 p-2 rounded-sm border border-border hover:bg-muted/50 transition-colors"
                                        >
                                            {keyCopied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} className="text-muted-foreground" />}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Key list */}
                            {loading ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 size={16} className="animate-spin text-muted-foreground/30" />
                                </div>
                            ) : keys.length === 0 ? (
                                <div className="text-center py-12 border border-dashed border-border rounded-sm">
                                    <Key size={24} className="mx-auto mb-3 text-muted-foreground/20" />
                                    <p className="text-xs font-mono text-muted-foreground/40">no keys</p>
                                </div>
                            ) : (
                                <div className="border border-border rounded-sm overflow-hidden">
                                    {keys.map(k => (
                                        <KeyRow
                                            key={k.id}
                                            apiKey={k}
                                            onRevoke={handleRevoke}
                                            revoking={revokingId === k.id}
                                        />
                                    ))}
                                </div>
                            )}

                            {activeKeys.length > 0 && (
                                <p className="text-[10px] font-mono text-muted-foreground/30">
                                    {activeKeys.length}/5 active
                                </p>
                            )}
                        </div>
                    )}

                    {/* ── Models ── */}
                    {tab === 'models' && (
                        <div className="space-y-5">
                            <div>
                                <h2 className="text-sm font-semibold text-foreground font-mono mb-1">Models</h2>
                                <p className="text-xs text-muted-foreground/70">
                                    {MODEL_CATALOG.length} models across {MODEL_FAMILIES.length} families.
                                    Use the model <code className="font-mono text-foreground/60 bg-muted/40 px-1 py-px rounded-sm">id</code> in API requests.
                                </p>
                            </div>

                            {MODEL_FAMILIES.map(family => {
                                const familyModels = MODEL_CATALOG.filter(m => m.family === family);
                                if (familyModels.length === 0) return null;
                                return (
                                    <div key={family}>
                                        <h3 className="text-xs font-mono font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2">
                                            {family} · {familyModels.length}
                                        </h3>
                                        <div className="border border-border rounded-sm overflow-hidden divide-y divide-border">
                                            {familyModels.map(m => (
                                                <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/10 transition-colors">
                                                    <code className="text-xs font-mono text-foreground/80 w-44 shrink-0">{m.id}</code>
                                                    <div className="flex-1 min-w-0">
                                                        <span className="text-xs text-muted-foreground/70">{m.name}</span>
                                                        {m.description && (
                                                            <p className="text-[9px] text-muted-foreground/40 truncate">
                                                                {m.description}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <span className="text-[10px] font-mono text-muted-foreground/40 shrink-0 w-12 text-right">{m.context}</span>
                                                    <div className="flex items-center gap-1.5">
                                                        <span className={cn(
                                                            'text-[9px] font-bold font-mono uppercase tracking-wide px-1.5 py-px rounded-sm border shrink-0',
                                                            TIER_COLORS[m.tier],
                                                        )}>
                                                            {m.tier}
                                                        </span>
                                                        {m.extended && (
                                                            <span className="text-[9px] font-bold font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-px rounded-sm shrink-0">
                                                                ET
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* ── Quick Start ── */}
                    {tab === 'quickstart' && (
                        <div className="space-y-5">
                            <div>
                                <h2 className="text-sm font-semibold text-foreground font-mono mb-1">Quick Start</h2>
                                <p className="text-xs text-muted-foreground/70">
                                    OpenAI-compatible — point any OpenAI SDK at Tripplet&apos;s base URL.
                                </p>
                            </div>

                            <div className="border border-border rounded-sm bg-muted/5 px-4 py-3">
                                <p className="text-[10px] font-mono text-muted-foreground/50 mb-1">Base URL</p>
                                <code className="text-xs font-mono text-foreground/80">{publicApiBase}</code>
                            </div>

                            <div>
                                <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">1 · Install</p>
                                <CodeBlock lang="bash" code={`npm install openai   # JavaScript / TypeScript\npip install openai   # Python`} />
                            </div>

                            <div>
                                <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">2 · Initialize</p>
                                <div className="space-y-2">
                                    <CodeBlock lang="typescript" code={`import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.TRIPPLET_API_KEY,
  baseURL: '${publicApiBase}',
});`} />
                                    <CodeBlock lang="python" code={`from openai import OpenAI

client = OpenAI(
    api_key=os.environ["TRIPPLET_API_KEY"],
    base_url="${publicApiBase}",
)`} />
                                </div>
                            </div>

                            <div>
                                <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">3 · Chat completion</p>
                                <CodeBlock lang="typescript" code={`const response = await client.chat.completions.create({
  model: 'tura-3',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Write a haiku about coding.' },
  ],
  max_tokens: 256,
});

console.log(response.choices[0].message.content);`} />
                            </div>

                            <div>
                                <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">4 · Streaming</p>
                                <CodeBlock lang="typescript" code={`const stream = await client.chat.completions.create({
  model: 'suzhou-3',
  messages: [{ role: 'user', content: 'Tell me a story.' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}`} />
                            </div>

                            <div>
                                <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">5 · Reasoning (tura-3)</p>
                                <CodeBlock lang="typescript" code={`const response = await client.chat.completions.create({
  model: 'tura-3',
  messages: [{ role: 'user', content: 'Prove that sqrt(2) is irrational.' }],
  max_tokens: 4096,
});`} />
                            </div>

                            <div>
                                <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">6 · Tool use</p>
                                <CodeBlock lang="typescript" code={`const response = await client.chat.completions.create({
  model: 'tura-3',
  messages: [{ role: 'user', content: 'Research latest AI news.' }],
  tools: [{
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  }],
});`} />
                            </div>

                        </div>
                    )}

                    {/* ── Endpoints ── */}
                    {tab === 'endpoints' && (
                        <div className="space-y-5">
                            <div>
                                <h2 className="text-sm font-semibold text-foreground font-mono mb-1">API Reference</h2>
                                <p className="text-xs text-muted-foreground/70">
                                    Base URL: <code className="font-mono text-foreground/60 bg-muted/40 px-1 py-px rounded-sm">{publicApiBase}</code>
                                </p>
                            </div>

                            {/* Auth */}
                            <div className="border border-border rounded-sm overflow-hidden">
                                <div className="px-4 py-2 bg-muted/20 border-b border-border">
                                    <h3 className="text-xs font-mono font-semibold text-foreground">Authentication</h3>
                                </div>
                                <div className="px-4 py-3 space-y-2">
                                    <p className="text-xs text-muted-foreground/70">
                                        All requests require a Bearer token in the <code className="font-mono text-foreground/60 bg-muted/40 px-1 py-px rounded-sm">Authorization</code> header.
                                    </p>
                                    <CodeBlock lang="http" code={`Authorization: Bearer trpl_sk_YOUR_API_KEY`} />
                                </div>
                            </div>

                            {/* Endpoints */}
                            {[
                                {
                                    method: 'GET',
                                    path: '/models',
                                    desc: 'List the chat models currently supported by the developer API.',
                                    params: [],
                                    example: `curl ${publicApiBase}/models \\\n  -H "Authorization: Bearer trpl_sk_YOUR_API_KEY"`,
                                },
                                {
                                    method: 'POST',
                                    path: '/chat/completions',
                                    desc: 'Create a chat completion. Supports streaming and tool definitions.',
                                    params: [
                                        { name: 'model', type: 'string', required: true, desc: 'Model ID (see Models tab)' },
                                        { name: 'messages', type: 'array', required: true, desc: 'Array of {role, content} message objects' },
                                        { name: 'max_tokens', type: 'integer', required: false, desc: 'Maximum tokens to generate' },
                                        { name: 'temperature', type: 'float', required: false, desc: 'Sampling temperature 0.0–2.0' },
                                        { name: 'stream', type: 'boolean', required: false, desc: 'Enable SSE streaming' },
                                        { name: 'tools', type: 'array', required: false, desc: 'Function definitions for tool use' },
                                        { name: 'top_p', type: 'float', required: false, desc: 'Nucleus sampling value' },
                                        { name: 'stop', type: 'string[]', required: false, desc: 'Stop sequences' },
                                    ],
                                    example: `curl ${publicApiBase}/chat/completions \\\n  -H "Authorization: Bearer trpl_sk_YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"tura-3","messages":[{"role":"user","content":"Hello"}]}'`,
                                },
                            ].map(ep => (
                                <div key={ep.path} className="border border-border rounded-sm overflow-hidden">
                                    <div className="px-4 py-2 bg-muted/20 border-b border-border flex items-center gap-3">
                                        <span className={cn(
                                            'text-[9px] font-bold font-mono px-1.5 py-px rounded-sm',
                                            ep.method === 'POST'
                                                ? 'bg-emerald-500/15 text-emerald-400'
                                                : 'bg-blue-500/15 text-blue-400',
                                        )}>
                                            {ep.method}
                                        </span>
                                        <code className="text-xs font-mono text-foreground">{ep.path}</code>
                                    </div>
                                    <div className="px-4 py-3 space-y-3">
                                        <p className="text-xs text-muted-foreground/70">{ep.desc}</p>
                                        {ep.params.length > 0 && (
                                            <div className="border border-border divide-y divide-border rounded-sm overflow-hidden">
                                                <div className="grid grid-cols-[120px_80px_40px_1fr] gap-2 px-3 py-1.5 bg-muted/20 text-[9px] font-mono font-semibold text-muted-foreground/50 uppercase tracking-wider">
                                                    <span>param</span>
                                                    <span>type</span>
                                                    <span>req</span>
                                                    <span>description</span>
                                                </div>
                                                {ep.params.map(p => (
                                                    <div key={p.name} className="grid grid-cols-[120px_80px_40px_1fr] gap-2 px-3 py-2 text-xs">
                                                        <code className="font-mono text-foreground/70">{p.name}</code>
                                                        <span className="text-muted-foreground/50 font-mono">{p.type}</span>
                                                        <span className={p.required ? 'text-amber-400 font-mono text-[10px]' : 'text-muted-foreground/25 font-mono text-[10px]'}>
                                                            {p.required ? 'yes' : 'no'}
                                                        </span>
                                                        <span className="text-muted-foreground/60">{p.desc}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <CodeBlock lang="bash" code={ep.example} />
                                    </div>
                                </div>
                            ))}

                            {/* Error codes */}
                            <div className="border border-border rounded-sm overflow-hidden">
                                <div className="px-4 py-2 bg-muted/20 border-b border-border">
                                    <h3 className="text-xs font-mono font-semibold text-foreground">Error Codes</h3>
                                </div>
                                <div className="divide-y divide-border">
                                    {[
                                        { code: 400, meaning: 'Bad request — check your parameters' },
                                        { code: 401, meaning: 'Invalid or missing API key' },
                                        { code: 403, meaning: 'Key revoked or insufficient permissions' },
                                        { code: 429, meaning: 'Rate limit exceeded — back off and retry' },
                                        { code: 500, meaning: 'Internal server error — retry with exponential backoff' },
                                        { code: 503, meaning: 'Model temporarily unavailable' },
                                    ].map(e => (
                                        <div key={e.code} className="flex items-center gap-4 px-4 py-2.5 hover:bg-muted/10 transition-colors">
                                            <code className="text-xs font-mono font-bold text-foreground/70 w-8">{e.code}</code>
                                            <span className="text-xs font-mono text-muted-foreground/60">{e.meaning}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
