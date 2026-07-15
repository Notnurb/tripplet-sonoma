'use client';

// /store — the Tripplet Store, an x402-native, ACCOUNTLESS storefront.
// Nothing on this page reads a session: humans pay from an injected wallet
// (one EIP-3009 signature, gasless), agents pay the same endpoints over raw
// HTTP 402. Buying a pack returns a prepaid `trpl_x4_` API key inside the
// receipt; per-call payment needs no key at all.
//
// Same design language as the rest of the app: serif hero, --sonoma-* tokens,
// sm-fadeUp cards. Wallet plumbing lives in src/lib/x402/wallet.ts.

import { useCallback, useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    BotIcon,
    CheckmarkCircle02Icon,
    Copy01Icon,
    CrownIcon,
    Diamond01Icon,
    Key01Icon,
    LinkSquare02Icon,
    RefreshIcon,
    Wallet03Icon,
    ZapIcon,
} from '@hugeicons/core-free-icons';
import {
    PAYMENT_HEADER,
    encodePaymentHeader,
    type PaymentRequiredBody,
    type PaymentRequirements,
} from '@/lib/x402/types';
import { formatUsdcAtomic, formatCredits, KEY_PREFIX } from '@/lib/x402/catalog';
import {
    ensureChain,
    fetchUsdcBalance,
    getInjectedProvider,
    requestAccount,
    signTransferAuthorization,
} from '@/lib/x402/wallet';

// ─── Wire types (mirrors /api/x402/catalog + payments.ts receipts) ───────────

interface CatalogNetwork {
    id: string;
    chainId: number;
    label: string;
    testnet: boolean;
    rpcUrl: string;
    explorerTx: string;
    usdc: { address: string; symbol: string };
    faucet?: string;
}

interface CatalogModel {
    id: string;
    name: string;
    description: string;
    pricePerCallUsd: string;
    maxOutputTokens: number;
}

interface CatalogPack {
    id: string;
    name: string;
    tagline: string;
    priceUsd: string;
    credits: number;
    features: string[];
    accent: string;
    icon: 'zap' | 'crown' | 'diamond';
    popular: boolean;
    endpoint: string;
}

interface Catalog {
    enabled: boolean;
    reason?: string;
    network: CatalogNetwork;
    inference: { endpoint: string; payPerCall: { models: CatalogModel[] } };
    packs: CatalogPack[];
}

interface Receipt {
    receiptId: string;
    replayed?: boolean;
    product: { id: string; name: string; priceUsd: string };
    payment: {
        testnet: boolean;
        asset: string;
        amount: string;
        payer: string;
        transaction: string | null;
        explorerUrl: string | null;
    };
    grant: {
        mode: 'minted' | 'topped-up';
        apiKey: string | null;
        keyPrefix: string | null;
        creditsAdded: number;
        creditsRemaining: number | null;
        note: string;
    };
}

interface KeyInfo {
    keyPrefix: string;
    creditsGranted: number;
    creditsRemaining: number;
    exhausted: boolean;
    lastUsedAt: string | null;
}

type BuyPhase = 'idle' | 'connecting' | 'switching' | 'challenge' | 'signing' | 'settling' | 'error';

interface BuyState {
    packId: string | null;
    phase: BuyPhase;
    message: string | null;
    retryHeader: string | null;
    retryEndpoint: string | null;
}

const IDLE_BUY: BuyState = { packId: null, phase: 'idle', message: null, retryHeader: null, retryEndpoint: null };

const PHASE_LABEL: Record<Exclude<BuyPhase, 'idle' | 'error'>, string> = {
    connecting: 'Connecting wallet…',
    switching: 'Switching network…',
    challenge: 'Fetching quote…',
    signing: 'Waiting for signature…',
    settling: 'Settling on-chain…',
};

const PACK_ICON = { zap: ZapIcon, crown: CrownIcon, diamond: Diamond01Icon } as const;

function shortAddress(addr: string): string {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function friendlyError(e: unknown): string {
    if ((e as { code?: number })?.code === 4001) return 'Signature request declined in the wallet.';
    return e instanceof Error ? e.message : String(e);
}

function CopyButton({ text, label }: { text: string; label?: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            onClick={() => {
                void navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
            }}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 11px',
                borderRadius: 9999,
                border: '1px solid var(--sonoma-border)',
                background: 'var(--sonoma-surface)',
                color: copied ? 'var(--sonoma-accent-2)' : 'var(--sonoma-ink-2)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                flexShrink: 0,
            }}
        >
            <HugeiconsIcon icon={copied ? CheckmarkCircle02Icon : Copy01Icon} size={14} strokeWidth={1.8} />
            {copied ? 'Copied' : (label ?? 'Copy')}
        </button>
    );
}

function Snippet({ title, code }: { title: string; code: string }) {
    return (
        <div style={{ position: 'relative', marginTop: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--sonoma-faint)', marginBottom: 6 }}>
                {title}
            </div>
            <div
                style={{
                    padding: '14px 16px',
                    borderRadius: 13,
                    border: '1px solid var(--sonoma-border)',
                    background: 'var(--sonoma-bg-2, var(--sonoma-surface))',
                    overflowX: 'auto',
                }}
            >
                <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: 'var(--sonoma-ink-2)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    {code}
                </pre>
                <div style={{ position: 'absolute', top: 30, right: 10 }}>
                    <CopyButton text={code} />
                </div>
            </div>
        </div>
    );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function StorePage() {
    const [catalog, setCatalog] = useState<Catalog | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [wallet, setWallet] = useState<string | null>(null);
    const [buying, setBuying] = useState<BuyState>(IDLE_BUY);
    const [receipt, setReceipt] = useState<Receipt | null>(null);
    const [keyInput, setKeyInput] = useState('');
    const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null);
    const [keyError, setKeyError] = useState<string | null>(null);
    const [keyBusy, setKeyBusy] = useState(false);
    const [topUpKey, setTopUpKey] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/x402/catalog', { cache: 'no-store' });
                if (!res.ok) throw new Error(`catalog fetch ${res.status}`);
                setCatalog((await res.json()) as Catalog);
            } catch {
                setLoadError('Could not load the store right now.');
            }
        })();
    }, []);

    const submitPayment = useCallback(
        async (endpoint: string, header: string, topUp: string | null) => {
            setBuying((s) => ({ ...s, phase: 'settling', message: null, retryHeader: header, retryEndpoint: endpoint }));
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { [PAYMENT_HEADER]: header, ...(topUp ? { 'X-Tripplet-Key': topUp } : {}) },
            });
            const data = (await res.json().catch(() => null)) as (Receipt & { error?: string }) | null;
            if (res.ok && data) {
                setReceipt(data);
                setBuying(IDLE_BUY);
                if (topUp) {
                    // Refresh the balance panel for the key that was topped up.
                    setKeyInput(topUp);
                    void checkKeyRaw(topUp);
                }
                return;
            }
            const retryable = res.status === 503 || res.status === 409;
            setBuying((s) => ({
                ...s,
                phase: 'error',
                message:
                    (data?.error ?? `Payment failed (HTTP ${res.status}).`) +
                    (retryable ? ' Your money moves at most once — use “Retry same payment”.' : ''),
                retryHeader: retryable ? header : null,
                retryEndpoint: retryable ? endpoint : null,
            }));
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    );

    const buy = useCallback(
        async (pack: CatalogPack) => {
            if (!catalog) return;
            setReceipt(null);
            setBuying({ packId: pack.id, phase: 'connecting', message: null, retryHeader: null, retryEndpoint: null });
            try {
                const provider = getInjectedProvider();
                if (!provider) {
                    throw new Error(
                        'No browser wallet found. Install MetaMask (or any EIP-1193 wallet) — or pay over raw HTTP; see “For agents & robots” below.',
                    );
                }
                const from = await requestAccount(provider);
                setWallet(from);

                setBuying((s) => ({ ...s, phase: 'switching' }));
                const net = catalog.network;
                await ensureChain(provider, {
                    chainId: net.chainId,
                    name: net.label,
                    rpcUrl: net.rpcUrl,
                    explorerBase: net.explorerTx.replace(/\/tx\/$/, ''),
                });

                // The 402 challenge is the source of truth for what to sign.
                setBuying((s) => ({ ...s, phase: 'challenge' }));
                const challenge = await fetch(pack.endpoint, { method: 'POST' });
                if (challenge.status !== 402) throw new Error(`Expected a 402 challenge, got HTTP ${challenge.status}.`);
                const challengeBody = (await challenge.json()) as PaymentRequiredBody;
                const requirements: PaymentRequirements | undefined = challengeBody.accepts?.[0];
                if (!requirements) throw new Error('The 402 challenge carried no payment requirements.');

                const balance = await fetchUsdcBalance(provider, requirements.asset, from);
                if (balance !== null && balance < BigInt(requirements.maxAmountRequired)) {
                    throw new Error(
                        `Not enough ${net.usdc.symbol} on ${net.label}: you have ${formatUsdcAtomic(balance.toString())}, this costs ${pack.priceUsd}.` +
                            (net.faucet ? ` Get free testnet USDC at ${net.faucet}.` : ''),
                    );
                }

                setBuying((s) => ({ ...s, phase: 'signing' }));
                const payload = await signTransferAuthorization(provider, from, net.chainId, requirements);
                await submitPayment(pack.endpoint, encodePaymentHeader(payload), topUpKey);
            } catch (e) {
                setBuying((s) => ({ ...s, phase: 'error', message: friendlyError(e) }));
            }
        },
        [catalog, submitPayment, topUpKey],
    );

    const checkKeyRaw = useCallback(async (raw: string) => {
        setKeyBusy(true);
        setKeyError(null);
        setKeyInfo(null);
        try {
            const res = await fetch('/api/x402/key', { headers: { Authorization: `Bearer ${raw.trim()}` } });
            const data = (await res.json()) as KeyInfo & { error?: string };
            if (res.ok) setKeyInfo(data);
            else setKeyError(data.error ?? `Lookup failed (HTTP ${res.status}).`);
        } catch {
            setKeyError('Lookup failed — network error.');
        } finally {
            setKeyBusy(false);
        }
    }, []);

    const net = catalog?.network;
    const host = catalog?.packs[0]?.endpoint.replace(/\/api\/x402\/buy\/.*$/, '') ?? '';
    const chatEndpoint = catalog?.inference.endpoint ?? `${host}/api/x402/chat/completions`;
    const models = catalog?.inference.payPerCall.models ?? [];

    return (
        <div className="sonoma-scroll" style={{ height: '100%', overflowY: 'auto', background: 'var(--sonoma-bg)' }}>
            <div style={{ maxWidth: 1020, margin: '0 auto', padding: '48px 24px 90px' }}>
                {/* Hero */}
                <div className="sm-fadeUp" style={{ textAlign: 'center', marginBottom: 28 }}>
                    <div style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(32px, 4vw, 44px)', letterSpacing: '-0.022em', color: 'var(--sonoma-ink)' }}>
                        The Store.
                    </div>
                    <div style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 'clamp(17px, 2vw, 22px)', color: 'var(--sonoma-muted)', marginTop: 6 }}>
                        AI you pay for over HTTP. No account. No card. No subscription.
                    </div>

                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 18 }}>
                        {net && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 9999, border: '1px solid var(--sonoma-border)', background: 'var(--sonoma-surface)', fontSize: 12, fontWeight: 650, color: 'var(--sonoma-ink-2)' }}>
                                <span style={{ width: 7, height: 7, borderRadius: 9999, background: net.testnet ? '#f59e0b' : '#22c55e' }} />
                                {net.usdc.symbol} on {net.label}
                            </span>
                        )}
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 9999, border: '1px solid var(--sonoma-border)', background: 'var(--sonoma-surface)', fontSize: 12, fontWeight: 650, color: 'var(--sonoma-ink-2)' }}>
                            <HugeiconsIcon icon={BotIcon} size={13} strokeWidth={1.8} />
                            Agents welcome — x402 native
                        </span>
                        {wallet && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 9999, border: '1px solid var(--sonoma-border)', background: 'var(--sonoma-surface)', fontSize: 12, fontWeight: 650, color: 'var(--sonoma-ink-2)' }}>
                                <HugeiconsIcon icon={Wallet03Icon} size={13} strokeWidth={1.8} />
                                {shortAddress(wallet)}
                            </span>
                        )}
                    </div>
                </div>

                {/* Testnet strip */}
                {net?.testnet && (
                    <div className="sm-fadeUp" style={{ marginBottom: 22, padding: '11px 16px', borderRadius: 13, border: '1px solid rgba(245, 158, 11, 0.35)', background: 'rgba(245, 158, 11, 0.07)', fontSize: 12.5, lineHeight: 1.6, color: 'var(--sonoma-ink-2)', textAlign: 'center' }}>
                        Test mode — payments settle on {net.label} with free testnet {net.usdc.symbol}
                        {net.faucet && (
                            <>
                                {' '}(grab some at{' '}
                                <a href={net.faucet} target="_blank" rel="noreferrer" style={{ color: 'var(--sonoma-accent-2)' }}>faucet.circle.com</a>)
                            </>
                        )}
                        . Keys and credits are real.
                    </div>
                )}

                {loadError && (
                    <div style={{ textAlign: 'center', padding: '14px 18px', borderRadius: 14, border: '1px solid var(--sonoma-border)', background: 'var(--sonoma-surface)', color: 'var(--sonoma-muted)', fontSize: 13.5, marginBottom: 20 }}>
                        {loadError}
                    </div>
                )}
                {!catalog && !loadError && (
                    <div style={{ textAlign: 'center', color: 'var(--sonoma-muted)', fontSize: 14 }}>Opening the store…</div>
                )}

                {catalog && !catalog.enabled && (
                    <div className="sm-fadeUp" style={{ marginBottom: 24, padding: '18px 22px', borderRadius: 16, border: '1px solid var(--sonoma-border)', background: 'var(--sonoma-surface)', fontSize: 13.5, lineHeight: 1.65, color: 'var(--sonoma-ink-2)' }}>
                        <div style={{ fontWeight: 650, color: 'var(--sonoma-ink)', marginBottom: 4 }}>The store is warming up</div>
                        Checkout is not configured on this deployment yet{catalog.reason ? <> — {catalog.reason}</> : '.'} Browsing works; paying does not.
                    </div>
                )}

                {catalog && (
                    <>
                        {/* Pay-per-call pricing */}
                        <div className="sm-fadeUp" style={{ marginBottom: 28 }}>
                            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 24, color: 'var(--sonoma-ink)', marginBottom: 4 }}>
                                Pay per call
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--sonoma-muted)', marginBottom: 14, lineHeight: 1.6 }}>
                                One OpenAI-style request, one micro-payment, zero setup. POST to{' '}
                                <code style={{ fontSize: 12, color: 'var(--sonoma-ink-2)' }}>{chatEndpoint.replace(/^https?:\/\//, '')}</code>{' '}
                                with an X-PAYMENT header — that&apos;s the whole integration.
                            </div>
                            <div style={{ borderRadius: 16, border: '1px solid var(--sonoma-border)', background: 'var(--sonoma-surface)', overflow: 'hidden' }}>
                                {models.map((m, i) => (
                                    <div key={m.id} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '13px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--sonoma-border)', flexWrap: 'wrap' }}>
                                        <span style={{ fontWeight: 650, fontSize: 14.5, color: 'var(--sonoma-ink)', minWidth: 90 }}>{m.name}</span>
                                        <code style={{ fontSize: 12, color: 'var(--sonoma-faint)' }}>{m.id}</code>
                                        <span style={{ fontSize: 12.5, color: 'var(--sonoma-muted)', flex: 1, minWidth: 160 }}>{m.description}</span>
                                        <span style={{ fontFamily: 'var(--font-serif)', fontSize: 18, color: 'var(--sonoma-ink)' }}>${m.pricePerCallUsd}</span>
                                        <span style={{ fontSize: 11.5, color: 'var(--sonoma-faint)' }}>/ call · ≤{formatCredits(m.maxOutputTokens)} out</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Prepaid packs */}
                        <div className="sm-fadeUp" style={{ marginBottom: 6 }}>
                            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 24, color: 'var(--sonoma-ink)', marginBottom: 4 }}>
                                Prepaid keys
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--sonoma-muted)', marginBottom: 16, lineHeight: 1.6 }}>
                                Pay once, get a <code style={{ fontSize: 12 }}>{KEY_PREFIX}…</code> bearer key in the receipt. Cheaper per token,
                                no settle latency per call, works with any OpenAI-style client.
                                {topUpKey && (
                                    <span style={{ color: 'var(--sonoma-accent-2)' }}>
                                        {' '}Purchases will top up {topUpKey.slice(0, 14)}… <button type="button" onClick={() => setTopUpKey(null)} style={{ color: 'var(--sonoma-muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: 12.5 }}>mint new instead</button>
                                    </span>
                                )}
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(272px, 1fr))', gap: 16, alignItems: 'stretch' }}>
                            {catalog.packs.map((pack) => {
                                const mine = buying.packId === pack.id;
                                const busy = mine && buying.phase !== 'idle' && buying.phase !== 'error';
                                return (
                                    <div
                                        key={pack.id}
                                        className="sm-fadeUp"
                                        style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            padding: '26px 26px 24px',
                                            borderRadius: 22,
                                            border: pack.popular ? `1.5px solid ${pack.accent}` : '1px solid var(--sonoma-border)',
                                            background: 'var(--sonoma-surface)',
                                            boxShadow: pack.popular ? `0 18px 44px -18px ${pack.accent}66` : 'var(--sonoma-shadow-md)',
                                            position: 'relative',
                                        }}
                                    >
                                        {pack.popular && (
                                            <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', padding: '4px 14px', borderRadius: 9999, background: pack.accent, color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                                                Most popular
                                            </div>
                                        )}
                                        <div style={{ width: 42, height: 42, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${pack.accent}1f`, color: pack.accent, marginBottom: 14 }}>
                                            <HugeiconsIcon icon={PACK_ICON[pack.icon]} size={21} strokeWidth={1.8} />
                                        </div>
                                        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 23, letterSpacing: '-0.015em', color: 'var(--sonoma-ink)' }}>{pack.name}</div>
                                        <div style={{ marginTop: 3, fontSize: 13, color: 'var(--sonoma-muted)' }}>{pack.tagline}</div>
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, margin: '18px 0 16px' }}>
                                            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 36, letterSpacing: '-0.02em', color: 'var(--sonoma-ink)' }}>${pack.priceUsd}</span>
                                            <span style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--sonoma-muted)' }}>USDC</span>
                                            <span style={{ fontSize: 12.5, color: 'var(--sonoma-faint)' }}>· {formatCredits(pack.credits)} credits</span>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20, flex: 1 }}>
                                            {pack.features.map((f) => (
                                                <div key={f} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--sonoma-ink-2)' }}>
                                                    <span style={{ color: pack.accent, display: 'inline-flex', marginTop: 1.5, flexShrink: 0 }}>
                                                        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={15} strokeWidth={1.8} />
                                                    </span>
                                                    {f}
                                                </div>
                                            ))}
                                        </div>
                                        <button
                                            type="button"
                                            disabled={busy || !catalog.enabled}
                                            onClick={() => void buy(pack)}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: 8,
                                                width: '100%',
                                                padding: '11px 16px',
                                                borderRadius: 9999,
                                                border: 'none',
                                                background: !catalog.enabled ? 'var(--sonoma-surface-2)' : pack.accent,
                                                color: !catalog.enabled ? 'var(--sonoma-faint)' : '#fff',
                                                fontSize: 14,
                                                fontWeight: 650,
                                                cursor: busy || !catalog.enabled ? 'not-allowed' : 'pointer',
                                                opacity: busy ? 0.75 : 1,
                                                transition: 'transform .15s',
                                            }}
                                            onMouseEnter={(e) => {
                                                if (!busy && catalog.enabled) e.currentTarget.style.transform = 'translateY(-1px)';
                                            }}
                                            onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
                                        >
                                            <HugeiconsIcon icon={Wallet03Icon} size={17} strokeWidth={1.8} />
                                            {busy ? PHASE_LABEL[buying.phase as keyof typeof PHASE_LABEL] : topUpKey ? 'Top up with wallet' : 'Pay with wallet'}
                                        </button>
                                        {mine && buying.phase === 'error' && (
                                            <div className="sm-fadeUp" style={{ marginTop: 12, padding: '10px 13px', borderRadius: 12, border: '1px solid rgba(239, 68, 68, 0.35)', background: 'rgba(239, 68, 68, 0.08)', fontSize: 12.5, lineHeight: 1.55, color: 'var(--sonoma-ink-2)' }}>
                                                {buying.message}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Retry strip for ambiguous settlements */}
                        {buying.phase === 'error' && buying.retryHeader && buying.retryEndpoint && (
                            <div className="sm-fadeUp" style={{ marginTop: 16, textAlign: 'center' }}>
                                <button
                                    type="button"
                                    onClick={() => void submitPayment(buying.retryEndpoint as string, buying.retryHeader as string, topUpKey)}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 20px', borderRadius: 9999, border: '1px solid var(--sonoma-border)', background: 'var(--sonoma-surface)', color: 'var(--sonoma-ink)', fontSize: 13, fontWeight: 650, cursor: 'pointer' }}
                                >
                                    <HugeiconsIcon icon={RefreshIcon} size={15} strokeWidth={1.8} />
                                    Retry same payment
                                </button>
                            </div>
                        )}

                        {/* Receipt */}
                        {receipt && (
                            <div className="sm-fadeUp" style={{ marginTop: 26, padding: '22px 24px', borderRadius: 20, border: '1.5px solid rgba(34, 197, 94, 0.4)', background: 'var(--sonoma-surface)', boxShadow: 'var(--sonoma-shadow-md)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                                    <span style={{ color: '#22c55e', display: 'inline-flex' }}>
                                        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={22} strokeWidth={1.8} />
                                    </span>
                                    <span style={{ fontFamily: 'var(--font-serif)', fontSize: 21, color: 'var(--sonoma-ink)' }}>
                                        {receipt.replayed ? 'Payment already settled' : 'Payment settled'}
                                    </span>
                                    {receipt.payment.testnet && (
                                        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#f59e0b' }}>testnet</span>
                                    )}
                                </div>
                                <div style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--sonoma-ink-2)' }}>
                                    <strong>{receipt.product.name}</strong> · {receipt.payment.amount} {receipt.payment.asset} from {shortAddress(receipt.payment.payer)}
                                    {receipt.payment.explorerUrl && (
                                        <>
                                            {' · '}
                                            <a href={receipt.payment.explorerUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--sonoma-accent-2)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                                view transaction
                                                <HugeiconsIcon icon={LinkSquare02Icon} size={13} strokeWidth={1.8} />
                                            </a>
                                        </>
                                    )}
                                </div>

                                {receipt.grant.apiKey ? (
                                    <div style={{ marginTop: 14, padding: '14px 16px', borderRadius: 14, border: '1px dashed var(--sonoma-border-2, var(--sonoma-border))', background: 'var(--sonoma-bg)' }}>
                                        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--sonoma-faint)', marginBottom: 7 }}>
                                            Your API key — treat like cash
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                            <code style={{ fontSize: 15, fontWeight: 650, letterSpacing: '0.02em', color: 'var(--sonoma-ink)', wordBreak: 'break-all' }}>
                                                {receipt.grant.apiKey}
                                            </code>
                                            <CopyButton text={receipt.grant.apiKey} />
                                        </div>
                                        <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6, color: 'var(--sonoma-muted)' }}>
                                            {formatCredits(receipt.grant.creditsAdded)} credits loaded. Use it as{' '}
                                            <code style={{ fontSize: 11.5 }}>Authorization: Bearer …</code> against{' '}
                                            <code style={{ fontSize: 11.5 }}>{chatEndpoint.replace(/^https?:\/\//, '')}</code>. {receipt.grant.note}
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ marginTop: 10, fontSize: 13.5, color: 'var(--sonoma-ink-2)' }}>
                                        {receipt.grant.note}{' '}
                                        {receipt.grant.creditsRemaining !== null && (
                                            <span style={{ color: 'var(--sonoma-muted)' }}>
                                                Balance now {formatCredits(receipt.grant.creditsRemaining)} credits.
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Key balance checker */}
                        <div className="sm-fadeUp" style={{ marginTop: 40, padding: '20px 22px', borderRadius: 18, border: '1px solid var(--sonoma-border)', background: 'var(--sonoma-surface)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <span style={{ color: 'var(--sonoma-accent)', display: 'inline-flex' }}>
                                    <HugeiconsIcon icon={Key01Icon} size={17} strokeWidth={1.8} />
                                </span>
                                <span style={{ fontFamily: 'var(--font-serif)', fontSize: 19, color: 'var(--sonoma-ink)' }}>Check a key</span>
                            </div>
                            <div style={{ fontSize: 12.5, color: 'var(--sonoma-muted)', marginBottom: 14, lineHeight: 1.6 }}>
                                Paste any <code style={{ fontSize: 11.5 }}>{KEY_PREFIX}…</code> key to see its balance — possession is the only credential.
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <input
                                    value={keyInput}
                                    onChange={(e) => setKeyInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && keyInput.trim()) void checkKeyRaw(keyInput);
                                    }}
                                    placeholder={`${KEY_PREFIX}…`}
                                    spellCheck={false}
                                    style={{ flex: 1, minWidth: 220, padding: '9px 13px', borderRadius: 11, border: '1px solid var(--sonoma-border)', background: 'var(--sonoma-bg)', color: 'var(--sonoma-ink)', fontSize: 13.5, letterSpacing: '0.02em', fontFamily: 'ui-monospace, Menlo, monospace' }}
                                />
                                <button
                                    type="button"
                                    disabled={keyBusy || !keyInput.trim()}
                                    onClick={() => void checkKeyRaw(keyInput)}
                                    style={{ padding: '9px 18px', borderRadius: 11, border: 'none', background: 'var(--sonoma-accent)', color: '#fff', fontSize: 13.5, fontWeight: 650, cursor: keyBusy || !keyInput.trim() ? 'not-allowed' : 'pointer', opacity: keyBusy ? 0.7 : 1 }}
                                >
                                    {keyBusy ? 'Checking…' : 'Check balance'}
                                </button>
                            </div>
                            {keyError && <div className="sm-fadeUp" style={{ marginTop: 10, fontSize: 12.5, color: 'var(--sonoma-ink-2)' }}>{keyError}</div>}
                            {keyInfo && (
                                <div className="sm-fadeUp" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 13, color: 'var(--sonoma-ink-2)' }}>
                                    <span><strong>{keyInfo.keyPrefix}</strong></span>
                                    <span>
                                        {formatCredits(keyInfo.creditsRemaining)} of {formatCredits(keyInfo.creditsGranted)} credits left
                                    </span>
                                    {keyInfo.exhausted && <span style={{ color: '#ef4444', fontWeight: 650 }}>empty</span>}
                                    <button
                                        type="button"
                                        onClick={() => setTopUpKey(keyInput.trim())}
                                        style={{ padding: '5px 13px', borderRadius: 9999, border: '1px solid var(--sonoma-border)', background: 'var(--sonoma-bg)', color: 'var(--sonoma-accent-2)', fontSize: 12, fontWeight: 650, cursor: 'pointer' }}
                                    >
                                        Top up this key ↑
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* For agents */}
                        <div className="sm-fadeUp" style={{ marginTop: 40 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <span style={{ color: 'var(--sonoma-accent)', display: 'inline-flex' }}>
                                    <HugeiconsIcon icon={BotIcon} size={18} strokeWidth={1.8} />
                                </span>
                                <span style={{ fontFamily: 'var(--font-serif)', fontSize: 22, color: 'var(--sonoma-ink)' }}>For agents &amp; robots</span>
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--sonoma-muted)', lineHeight: 1.6 }}>
                                Everything here is an x402 v1 resource: no signup, no API-key dashboard, no OAuth dance. Discover at{' '}
                                <code style={{ fontSize: 12 }}>{host.replace(/^https?:\/\//, '')}/.well-known/x402</code>, pay per call, or hold a prepaid key.
                                Standard clients (x402-fetch, x402-axios, httpx hooks) handle the payment loop automatically. Replays are idempotent — a lost
                                receipt never loses your key.
                            </div>

                            <Snippet
                                title="1 · Pay per call (curl — the 402 loop)"
                                code={`# Quote: POST without payment → HTTP 402 + accepts[] price tag
curl -i ${chatEndpoint} -X POST -H 'Content-Type: application/json' \\
  -d '{"model":"majuli-3","messages":[{"role":"user","content":"hello"}]}'

# Pay: sign EIP-3009 TransferWithAuthorization for accepts[0] (gasless),
# then retry with the payment attached → completion JSON + tx receipt
curl ${chatEndpoint} -X POST \\
  -H 'Content-Type: application/json' -H "X-PAYMENT: <base64 PaymentPayload>" \\
  -d '{"model":"majuli-3","messages":[{"role":"user","content":"hello"}]}'`}
                            />

                            <Snippet
                                title="2 · Or automate it (x402-fetch, ~5 lines)"
                                code={`import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";

const payFetch = wrapFetchWithPayment(fetch, privateKeyToAccount(AGENT_PRIVATE_KEY));
const res = await payFetch("${chatEndpoint}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model: "astro-5", messages: [{ role: "user", content: "Plan my week" }] }),
});  // 402 → sign → retry happens automatically`}
                            />

                            <Snippet
                                title="3 · Prepaid key (cheaper + faster: pay once, then plain HTTP)"
                                code={`# Buy a pack — the receipt's grant.apiKey is your bearer key
curl -X POST ${host}/api/x402/buy/builder -H "X-PAYMENT: <base64 PaymentPayload>"

# Then it's just an OpenAI-style API — no payment per request
curl ${chatEndpoint} -X POST \\
  -H "Authorization: Bearer ${KEY_PREFIX}..." -H 'Content-Type: application/json' \\
  -d '{"model":"astro-5","messages":[{"role":"user","content":"hello"}]}'

# Balance / top-up (top-up: pay any pack with X-Tripplet-Key: <your key>)
curl ${host}/api/x402/key -H "Authorization: Bearer ${KEY_PREFIX}..."
# Empty key? The API answers HTTP 402 whose accepts[] are the packs. Pay, retry, continue.`}
                            />
                        </div>

                        {/* Fine print */}
                        <div style={{ marginTop: 36, paddingTop: 20, borderTop: '1px solid var(--sonoma-border)', fontSize: 12.5, lineHeight: 1.7, color: 'var(--sonoma-faint)' }}>
                            Payments are one-shot USDC transfers over the{' '}
                            <a href="https://www.x402.org" target="_blank" rel="noreferrer" style={{ color: 'var(--sonoma-accent-2)' }}>x402 protocol</a>
                            {' '}— gasless for the payer, no account anywhere, nothing stored but hashed keys and receipts. Keys never expire; credits meter
                            actual token usage. Machine-readable catalog:{' '}
                            <a href="/api/x402/catalog" style={{ color: 'var(--sonoma-accent-2)' }}>/api/x402/catalog</a> · discovery:{' '}
                            <a href="/.well-known/x402" style={{ color: 'var(--sonoma-accent-2)' }}>/.well-known/x402</a>.
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
