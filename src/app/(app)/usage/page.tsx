'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useChatConversations } from '@/context/ChatContext';
import { MODELS } from '@/lib/ai/models';
import { cn } from '@/lib/utils';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
}

function daysAgo(date: Date): number {
    const now = new Date();
    return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function getModelName(id: string): string {
    return MODELS.find(m => m.id === id)?.name ?? id;
}

// ── Bar chart (pure CSS) ─────────────────────────────────────────────────────

function BarChart({ data, label }: { data: { key: string; value: number }[]; label: string }) {
    const max = Math.max(...data.map(d => d.value), 1);
    return (
        <div>
            <p className="text-xs font-mono text-muted-foreground/50 uppercase tracking-wider mb-3">{label}</p>
            <div className="space-y-2">
                {data.map((d) => (
                    <div key={d.key} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-20 truncate text-right shrink-0">
                            {d.key}
                        </span>
                        <div className="flex-1 h-6 bg-muted/30 rounded-md overflow-hidden">
                            <div
                                className="h-full bg-violet-500/60 rounded-md transition-all duration-500"
                                style={{ width: `${Math.max((d.value / max) * 100, 2)}%` }}
                            />
                        </div>
                        <span className="text-xs font-mono text-foreground/60 w-10 text-right shrink-0">
                            {d.value}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Stat card ────────────────────────────────────────────────────────────────

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="rounded-xl border border-border bg-card px-5 py-4">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/50 mb-1">
                {label}
            </p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
    );
}

// ── Activity heatmap (last 12 weeks) ─────────────────────────────────────────

function ActivityGrid({ messageDates }: { messageDates: Date[] }) {
    const weeks = 12;
    const days = weeks * 7;
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    // Count messages per day
    const counts: Record<string, number> = {};
    for (const d of messageDates) {
        const key = new Date(d).toISOString().slice(0, 10);
        counts[key] = (counts[key] ?? 0) + 1;
    }

    const maxCount = Math.max(...Object.values(counts), 1);
    const cells: { date: string; count: number; dayOfWeek: number }[] = [];

    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        cells.push({ date: key, count: counts[key] ?? 0, dayOfWeek: d.getDay() });
    }

    // Group into columns (weeks)
    const columns: typeof cells[] = [];
    for (let i = 0; i < cells.length; i += 7) {
        columns.push(cells.slice(i, i + 7));
    }

    function intensity(count: number): string {
        if (count === 0) return 'bg-muted/30';
        const ratio = count / maxCount;
        if (ratio < 0.25) return 'bg-violet-500/20';
        if (ratio < 0.5) return 'bg-violet-500/40';
        if (ratio < 0.75) return 'bg-violet-500/60';
        return 'bg-violet-500/90';
    }

    return (
        <div>
            <p className="text-xs font-mono text-muted-foreground/50 uppercase tracking-wider mb-3">
                Activity — Last 12 Weeks
            </p>
            <div className="flex gap-[3px]">
                {columns.map((col, ci) => (
                    <div key={ci} className="flex flex-col gap-[3px]">
                        {col.map((cell) => (
                            <div
                                key={cell.date}
                                title={`${cell.date}: ${cell.count} message${cell.count !== 1 ? 's' : ''}`}
                                className={cn(
                                    'w-3 h-3 rounded-[2px] transition-colors',
                                    intensity(cell.count),
                                )}
                            />
                        ))}
                    </div>
                ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] text-muted-foreground/40">Less</span>
                {['bg-muted/30', 'bg-violet-500/20', 'bg-violet-500/40', 'bg-violet-500/60', 'bg-violet-500/90'].map((c, i) => (
                    <div key={i} className={cn('w-3 h-3 rounded-[2px]', c)} />
                ))}
                <span className="text-[10px] text-muted-foreground/40">More</span>
            </div>
        </div>
    );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function UsagePage() {
    const { user } = useAuth();
    const { conversations } = useChatConversations();
    const [mounted, setMounted] = useState(false);

    useEffect(() => setMounted(true), []);

    const stats = useMemo(() => {
        const allMessages = conversations.flatMap(c => c.messages ?? []);
        const userMessages = allMessages.filter(m => m.role === 'user');
        const aiMessages = allMessages.filter(m => m.role === 'assistant');

        // Model usage counts
        const modelCounts: Record<string, number> = {};
        for (const c of conversations) {
            const model = (c as any).model ?? 'suzhou-3';
            modelCounts[model] = (modelCounts[model] ?? 0) + 1;
        }

        // Estimate tokens (rough: 4 chars per token)
        const totalChars = allMessages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
        const estimatedTokens = Math.round(totalChars / 4);

        // Messages per day (last 30 days)
        const now = new Date();
        const last30: Record<string, number> = {};
        for (let i = 29; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            last30[d.toISOString().slice(0, 10)] = 0;
        }
        for (const m of allMessages) {
            const key = new Date(m.timestamp ?? Date.now()).toISOString().slice(0, 10);
            if (key in last30) last30[key]++;
        }

        // Message dates for heatmap
        const messageDates = allMessages
            .map(m => new Date(m.timestamp ?? Date.now()))
            .filter(d => daysAgo(d) <= 84);

        // Average messages per conversation
        const avgPerConvo = conversations.length
            ? Math.round(allMessages.length / conversations.length)
            : 0;

        // Longest conversation
        const longest = conversations.reduce(
            (max, c) => ((c.messages?.length ?? 0) > max ? c.messages?.length ?? 0 : max),
            0,
        );

        // Streak
        let streak = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 0; i < 365; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            const hasActivity = allMessages.some(m => {
                const mk = new Date(m.timestamp ?? 0).toISOString().slice(0, 10);
                return mk === key;
            });
            if (hasActivity) streak++;
            else break;
        }

        // Favorite model
        const favoriteModel = Object.entries(modelCounts)
            .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'suzhou-3';

        // Daily chart data
        const dailyData = Object.entries(last30)
            .slice(-14)
            .map(([key, value]) => ({
                key: key.slice(5), // MM-DD
                value,
            }));

        // Model chart data
        const modelData = MODELS.map(m => ({
            key: m.name,
            value: modelCounts[m.id] ?? 0,
        }));

        return {
            totalConversations: conversations.length,
            totalMessages: allMessages.length,
            userMessages: userMessages.length,
            aiMessages: aiMessages.length,
            estimatedTokens,
            avgPerConvo,
            longest,
            streak,
            favoriteModel,
            dailyData,
            modelData,
            messageDates,
        };
    }, [conversations]);

    if (!mounted) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="h-6 w-6 border-2 border-foreground/20 border-t-foreground/60 rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-y-auto">
            <div className="w-full max-w-5xl mx-auto px-4 py-8 flex-1">

                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-2xl font-bold tracking-tight">Usage</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        {user?.name ? `${user.name}'s` : 'Your'} Tripplet stats at a glance.
                    </p>
                </div>

                {/* Stat cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
                    <Stat
                        label="Conversations"
                        value={formatNumber(stats.totalConversations)}
                    />
                    <Stat
                        label="Messages"
                        value={formatNumber(stats.totalMessages)}
                        sub={`${formatNumber(stats.userMessages)} yours, ${formatNumber(stats.aiMessages)} AI`}
                    />
                    <Stat
                        label="Est. Tokens"
                        value={formatNumber(stats.estimatedTokens)}
                        sub="~4 chars per token"
                    />
                    <Stat
                        label="Streak"
                        value={`${stats.streak}d`}
                        sub={stats.streak >= 7 ? 'On fire' : stats.streak >= 3 ? 'Keep going' : 'Build it up'}
                    />
                </div>

                {/* Second row */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-10">
                    <Stat
                        label="Avg per Conversation"
                        value={String(stats.avgPerConvo)}
                        sub="messages"
                    />
                    <Stat
                        label="Longest Conversation"
                        value={String(stats.longest)}
                        sub="messages"
                    />
                    <Stat
                        label="Favorite Model"
                        value={getModelName(stats.favoriteModel)}
                    />
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
                    <div className="rounded-xl border border-border bg-card p-5">
                        <BarChart data={stats.dailyData} label="Messages — Last 14 Days" />
                    </div>
                    <div className="rounded-xl border border-border bg-card p-5">
                        <BarChart data={stats.modelData} label="Conversations by Model" />
                    </div>
                </div>

                {/* Activity heatmap */}
                <div className="rounded-xl border border-border bg-card p-5 mb-10">
                    <ActivityGrid messageDates={stats.messageDates} />
                </div>

                {/* Footer note */}
                <p className="text-[10px] font-mono text-muted-foreground/30 text-center">
                    Stats are computed from local conversation data. Token count is estimated.
                </p>
            </div>
        </div>
    );
}
