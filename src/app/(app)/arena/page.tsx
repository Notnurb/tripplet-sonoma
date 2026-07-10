'use client';

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { MODELS } from '@/lib/ai/models';

// ── Types ────────────────────────────────────────────────────────────────────

type BattleState = 'idle' | 'loading' | 'voting' | 'revealed';

interface BattleResult {
    prompt: string;
    modelA: string;
    modelB: string;
    responseA: string;
    responseB: string;
    winner: 'A' | 'B' | 'tie' | null;
}

// ── ELO helpers ──────────────────────────────────────────────────────────────

const ELO_K = 32;
const STORAGE_KEY = 'tripplet_arena_elo';
const HISTORY_KEY = 'tripplet_arena_history';

function loadElo(): Record<string, number> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch {}
    const init: Record<string, number> = {};
    for (const m of MODELS) init[m.id] = 1200;
    return init;
}

function saveElo(elo: Record<string, number>) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(elo)); } catch {}
}

function loadHistory(): BattleResult[] {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (raw) return JSON.parse(raw);
    } catch {}
    return [];
}

function saveHistory(h: BattleResult[]) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-50))); } catch {}
}

function updateElo(
    elo: Record<string, number>,
    winner: string,
    loser: string,
    tie: boolean
): Record<string, number> {
    const next = { ...elo };
    const eA = next[winner] ?? 1200;
    const eB = next[loser] ?? 1200;
    const expectedA = 1 / (1 + 10 ** ((eB - eA) / 400));
    const expectedB = 1 - expectedA;
    if (tie) {
        next[winner] = Math.round(eA + ELO_K * (0.5 - expectedA));
        next[loser] = Math.round(eB + ELO_K * (0.5 - expectedB));
    } else {
        next[winner] = Math.round(eA + ELO_K * (1 - expectedA));
        next[loser] = Math.round(eB + ELO_K * (0 - expectedB));
    }
    return next;
}

// ── Suggested prompts ────────────────────────────────────────────────────────

const SUGGESTED = [
    'Explain quantum computing to a 10 year old',
    'Write a haiku about debugging code at 3am',
    'What would happen if the moon disappeared?',
    'Give me a creative business idea involving AI and pets',
    'Explain why the sky is blue without using the word "scatter"',
    'Write the opening paragraph of a mystery novel set in a library',
    'What are 3 inventions that should exist but don\'t?',
    'Roast pineapple pizza in the style of Shakespeare',
];

// ── Pick two random different models ─────────────────────────────────────────

function pickTwo(): [string, string] {
    const ids = MODELS.map(m => m.id);
    const a = ids[Math.floor(Math.random() * ids.length)];
    let b = a;
    while (b === a) b = ids[Math.floor(Math.random() * ids.length)];
    return [a, b];
}

function getModelName(id: string): string {
    return MODELS.find(m => m.id === id)?.name ?? id;
}

// ── Stream a response from one model ─────────────────────────────────────────

async function streamModel(
    prompt: string,
    modelId: string,
    onChunk: (text: string) => void,
    signal: AbortSignal,
) {
    const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages: [{ role: 'user', content: prompt }],
            model: modelId,
            tone: 'concise',
            modes: [],
        }),
        signal,
    });
    if (!res.ok || !res.body) throw new Error('Stream failed');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') continue;
            try {
                const json = JSON.parse(payload);
                const delta = json.choices?.[0]?.delta?.content;
                if (delta) {
                    full += delta;
                    onChunk(full);
                }
            } catch {}
        }
    }
    return full;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ArenaPage() {
    const [prompt, setPrompt] = useState('');
    const [state, setState] = useState<BattleState>('idle');
    const [modelA, setModelA] = useState('');
    const [modelB, setModelB] = useState('');
    const [responseA, setResponseA] = useState('');
    const [responseB, setResponseB] = useState('');
    const [elo, setElo] = useState<Record<string, number>>(loadElo);
    const [history, setHistory] = useState<BattleResult[]>(loadHistory);
    const [totalBattles, setTotalBattles] = useState(() => history.length);
    const abortRef = useRef<AbortController | null>(null);

    const startBattle = useCallback(async (text: string) => {
        if (!text.trim()) return;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const [a, b] = pickTwo();
        setModelA(a);
        setModelB(b);
        setResponseA('');
        setResponseB('');
        setState('loading');

        try {
            await Promise.all([
                streamModel(text, a, setResponseA, controller.signal),
                streamModel(text, b, setResponseB, controller.signal),
            ]);
            setState('voting');
        } catch (err) {
            if (!controller.signal.aborted) setState('idle');
        }
    }, []);

    const handleVote = useCallback((winner: 'A' | 'B' | 'tie') => {
        const result: BattleResult = {
            prompt,
            modelA,
            modelB,
            responseA,
            responseB,
            winner,
        };

        let nextElo = { ...elo };
        if (winner === 'A') {
            nextElo = updateElo(nextElo, modelA, modelB, false);
        } else if (winner === 'B') {
            nextElo = updateElo(nextElo, modelB, modelA, false);
        } else {
            nextElo = updateElo(nextElo, modelA, modelB, true);
        }

        setElo(nextElo);
        saveElo(nextElo);
        const nextHistory = [...history, result];
        setHistory(nextHistory);
        saveHistory(nextHistory);
        setTotalBattles(nextHistory.length);
        setState('revealed');
    }, [prompt, modelA, modelB, responseA, responseB, elo, history]);

    const newBattle = useCallback(() => {
        setPrompt('');
        setResponseA('');
        setResponseB('');
        setState('idle');
    }, []);

    const resetElo = useCallback(() => {
        const init: Record<string, number> = {};
        for (const m of MODELS) init[m.id] = 1200;
        setElo(init);
        saveElo(init);
        setHistory([]);
        saveHistory([]);
        setTotalBattles(0);
    }, []);

    const sortedElo = MODELS
        .map(m => ({ ...m, elo: elo[m.id] ?? 1200 }))
        .sort((a, b) => b.elo - a.elo);

    return (
        <div className="flex flex-col h-full overflow-y-auto">
            <div className="w-full max-w-6xl mx-auto px-4 py-8 flex-1">

                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-bold tracking-tight">Model Arena</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Two models enter. One wins. You decide.
                    </p>
                </div>

                {/* Leaderboard */}
                <div className="mb-8 max-w-md mx-auto">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-xs font-mono font-semibold tracking-widest uppercase text-muted-foreground">
                            Elo Leaderboard
                        </h2>
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] font-mono text-muted-foreground/50">
                                {totalBattles} battle{totalBattles !== 1 ? 's' : ''}
                            </span>
                            {totalBattles > 0 && (
                                <button
                                    onClick={resetElo}
                                    className="text-[10px] font-mono text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                                >
                                    Reset
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="rounded-lg border border-border overflow-hidden">
                        {sortedElo.map((m, i) => (
                            <div
                                key={m.id}
                                className={cn(
                                    'flex items-center justify-between px-4 py-2.5',
                                    i !== sortedElo.length - 1 && 'border-b border-border/50',
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <span className={cn(
                                        'text-xs font-bold w-5 text-center',
                                        i === 0 && 'text-amber-400',
                                        i === 1 && 'text-zinc-400',
                                        i === 2 && 'text-orange-700',
                                    )}>
                                        {i + 1}
                                    </span>
                                    <span className="text-sm font-medium">{m.name}</span>
                                </div>
                                <span className="font-mono text-sm font-semibold text-foreground/70">
                                    {m.elo}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Prompt input */}
                {state === 'idle' && (
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-2xl mx-auto"
                    >
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && startBattle(prompt)}
                                placeholder="Type a prompt to battle two models..."
                                className="flex-1 rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:border-foreground/30 transition-colors"
                                autoFocus
                            />
                            <button
                                onClick={() => startBattle(prompt)}
                                disabled={!prompt.trim()}
                                className="rounded-xl bg-foreground text-background px-5 py-3 text-sm font-semibold disabled:opacity-30 hover:opacity-90 transition-opacity"
                            >
                                Battle
                            </button>
                        </div>

                        {/* Suggestions */}
                        <div className="mt-4 flex flex-wrap gap-2 justify-center">
                            {SUGGESTED.sort(() => Math.random() - 0.5).slice(0, 4).map((s) => (
                                <button
                                    key={s}
                                    onClick={() => { setPrompt(s); startBattle(s); }}
                                    className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}

                {/* Battle area */}
                {(state === 'loading' || state === 'voting' || state === 'revealed') && (
                    <div className="space-y-4">
                        {/* Prompt display */}
                        <div className="text-center mb-6">
                            <p className="text-xs font-mono text-muted-foreground/50 uppercase tracking-wider mb-1">Prompt</p>
                            <p className="text-sm text-foreground/80 max-w-xl mx-auto">{prompt}</p>
                        </div>

                        {/* Side by side responses */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Model A */}
                            <div className="rounded-xl border border-border bg-card overflow-hidden">
                                <div className="px-4 py-2.5 border-b border-border/50 flex items-center justify-between">
                                    <span className="text-xs font-mono font-semibold text-muted-foreground">
                                        {state === 'revealed' ? getModelName(modelA) : 'Model A'}
                                    </span>
                                    {state === 'loading' && !responseA && (
                                        <span className="h-2 w-2 rounded-full bg-violet-500 animate-pulse" />
                                    )}
                                </div>
                                <div className="px-4 py-3 min-h-[200px] max-h-[400px] overflow-y-auto">
                                    <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">
                                        {responseA || (
                                            <span className="text-muted-foreground/40 italic">Thinking...</span>
                                        )}
                                    </p>
                                </div>
                            </div>

                            {/* Model B */}
                            <div className="rounded-xl border border-border bg-card overflow-hidden">
                                <div className="px-4 py-2.5 border-b border-border/50 flex items-center justify-between">
                                    <span className="text-xs font-mono font-semibold text-muted-foreground">
                                        {state === 'revealed' ? getModelName(modelB) : 'Model B'}
                                    </span>
                                    {state === 'loading' && !responseB && (
                                        <span className="h-2 w-2 rounded-full bg-violet-500 animate-pulse" />
                                    )}
                                </div>
                                <div className="px-4 py-3 min-h-[200px] max-h-[400px] overflow-y-auto">
                                    <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">
                                        {responseB || (
                                            <span className="text-muted-foreground/40 italic">Thinking...</span>
                                        )}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Voting buttons */}
                        <AnimatePresence>
                            {state === 'voting' && (
                                <motion.div
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="flex items-center justify-center gap-3 pt-2"
                                >
                                    <button
                                        onClick={() => handleVote('A')}
                                        className="rounded-xl border border-border bg-card px-6 py-2.5 text-sm font-semibold hover:border-emerald-500/50 hover:text-emerald-400 transition-colors"
                                    >
                                        A is better
                                    </button>
                                    <button
                                        onClick={() => handleVote('tie')}
                                        className="rounded-xl border border-border bg-card px-6 py-2.5 text-sm font-semibold hover:border-amber-500/50 hover:text-amber-400 transition-colors"
                                    >
                                        Tie
                                    </button>
                                    <button
                                        onClick={() => handleVote('B')}
                                        className="rounded-xl border border-border bg-card px-6 py-2.5 text-sm font-semibold hover:border-emerald-500/50 hover:text-emerald-400 transition-colors"
                                    >
                                        B is better
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Revealed state */}
                        <AnimatePresence>
                            {state === 'revealed' && (
                                <motion.div
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="text-center pt-2 space-y-3"
                                >
                                    <p className="text-sm text-muted-foreground">
                                        {history[history.length - 1]?.winner === 'tie'
                                            ? `It's a tie! Both models tied.`
                                            : `You picked ${history[history.length - 1]?.winner === 'A' ? getModelName(modelA) : getModelName(modelB)} as the winner.`
                                        }
                                    </p>
                                    <button
                                        onClick={newBattle}
                                        className="rounded-xl bg-foreground text-background px-6 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
                                    >
                                        New Battle
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                )}
            </div>
        </div>
    );
}
