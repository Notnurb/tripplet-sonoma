'use client';

// Plan & Usage section for Settings: real message counts from /api/usage
// (backed by the AIUsage table), rendered as color-banded progress bars with
// live reset countdowns. Polls every 60s and refetches on window focus so the
// bars genuinely track usage, not a snapshot.

import { useCallback, useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Loading01Icon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { usageLevel, describeTimeUntil, type PlanId } from '@/lib/usage/policy';

interface WindowUsage {
    used: number;
    limit: number;
    remaining: number;
    percent: number;
    resetsAt: string;
    tokens: number;
}

interface UsageSummary {
    plan: PlanId;
    fiveHour: WindowUsage;
    weekly: WindowUsage;
}

const POLL_MS = 60_000;
const COUNTDOWN_TICK_MS = 30_000;

const BAR_COLORS: Record<ReturnType<typeof usageLevel>, string> = {
    ok: 'bg-emerald-500',
    warn: 'bg-yellow-500',
    critical: 'bg-red-500',
};

const PLAN_LABELS: Record<PlanId, string> = {
    free: 'Free plan',
    go: 'Go plan',
    builder: 'Builder plan',
    plus: 'Plus plan',
    max: 'Max plan',
};

function formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
    return String(tokens);
}

function formatResetTime(resetsAt: string, includeDay: boolean): string {
    const d = new Date(resetsAt);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (!includeDay) return time;
    return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
}

function UsageBar({
    title,
    subtitle,
    win,
    includeDayInReset,
    now,
}: {
    title: string;
    subtitle: string;
    win: WindowUsage;
    includeDayInReset: boolean;
    now: number;
}) {
    const level = usageLevel(win.percent);
    const exhausted = win.used >= win.limit;
    const msUntilReset = Math.max(0, new Date(win.resetsAt).getTime() - now);
    // Keep a sliver of bar visible as soon as anything is used.
    const widthPercent = win.used > 0 ? Math.max(win.percent, 2) : 0;

    return (
        <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
                <div>
                    <span className="text-sm font-medium">{title}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{subtitle}</span>
                </div>
                <span className="text-sm tabular-nums">
                    <span className="font-medium">{win.used}</span>
                    <span className="text-muted-foreground"> / {win.limit} messages</span>
                </span>
            </div>
            <div
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={win.limit}
                aria-valuenow={win.used}
                aria-label={`${title}: ${win.used} of ${win.limit} messages used`}
            >
                <div
                    className={`h-full rounded-full transition-all duration-500 ${BAR_COLORS[level]}`}
                    style={{ width: `${widthPercent}%` }}
                />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                    Resets {formatResetTime(win.resetsAt, includeDayInReset)} · in {describeTimeUntil(msUntilReset)}
                </span>
                {win.tokens > 0 && <span>≈ {formatTokens(win.tokens)} tokens</span>}
            </div>
            {exhausted && (
                <p className="text-xs font-medium text-red-500">
                    Limit reached — new messages unlock in {describeTimeUntil(msUntilReset)}.
                </p>
            )}
        </div>
    );
}

export default function UsagePanel() {
    const [summary, setSummary] = useState<UsageSummary | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [now, setNow] = useState(() => Date.now());

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/usage');
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Could not load usage.');
            }
            setSummary(await res.json());
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load usage.');
        } finally {
            setLoading(false);
            setNow(Date.now());
        }
    }, []);

    useEffect(() => {
        load();
        const poll = setInterval(load, POLL_MS);
        const tick = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
        const onFocus = () => load();
        window.addEventListener('focus', onFocus);
        return () => {
            clearInterval(poll);
            clearInterval(tick);
            window.removeEventListener('focus', onFocus);
        };
    }, [load]);

    return (
        <section className="space-y-4">
            <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Plan &amp; Usage</h2>
                <p className="text-xs text-muted-foreground mt-1">
                    Message budgets on your current plan. The 5-hour budget refills every 5 hours; the weekly budget
                    refills every week.
                </p>
            </div>

            <div className="space-y-6 rounded-xl border border-border p-5">
                {loading ? (
                    <div className="flex items-center justify-center py-6">
                        <HugeiconsIcon icon={Loading01Icon} className="animate-spin text-muted-foreground" size={20} />
                    </div>
                ) : error ? (
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-muted-foreground">{error}</p>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setLoading(true);
                                load();
                            }}
                        >
                            Retry
                        </Button>
                    </div>
                ) : summary ? (
                    <>
                        <div className="flex items-center justify-between">
                            <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium">
                                {PLAN_LABELS[summary.plan] ?? summary.plan}
                            </span>
                            {summary.plan === 'free' && (
                                <span className="text-xs text-muted-foreground">
                                    Paid plans get much higher limits.
                                </span>
                            )}
                        </div>

                        <UsageBar
                            title="5-hour usage"
                            subtitle="resets every 5 hours"
                            win={summary.fiveHour}
                            includeDayInReset={false}
                            now={now}
                        />
                        <UsageBar
                            title="Weekly usage"
                            subtitle="resets every week"
                            win={summary.weekly}
                            includeDayInReset
                            now={now}
                        />
                    </>
                ) : null}
            </div>
        </section>
    );
}
