'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { AgentResponse } from '@/types';

interface AgentPanelProps {
    agents: AgentResponse[];
    isCollaborating: boolean;
    synthesis?: string;
}

const AGENT_COLORS: Record<string, string> = {
    analyst: '#6366f1',
    coder: '#22d3ee',
    researcher: '#a855f7',
    creative: '#f472b6',
    critic: '#f97316',
    planner: '#84cc16',
    security: '#ef4444',
    ux: '#14b8a6',
    optimizer: '#eab308',
    educator: '#3b82f6',
    ethicist: '#8b5cf6',
    strategist: '#64748b',
    debugger: '#fb923c',
    architect: '#0ea5e9',
    writer: '#a3e635',
    devops: '#f43f5e',
    data_eng: '#06b6d4',
    ml_eng: '#7c3aed',
    product: '#d946ef',
    legal: '#78716c',
    financial: '#fbbf24',
    accessibility: '#2dd4bf',
    localization: '#60a5fa',
    testing: '#34d399',
    mentor: '#c084fc',
};

export default function AgentPanel({ agents, isCollaborating, synthesis }: AgentPanelProps) {
    if (!agents?.length && !isCollaborating) return null;

    return (
        <div className="agent-panel mt-4 rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 bg-gradient-to-r from-indigo-500/10 to-purple-500/10">
                <div className="flex -space-x-2">
                    <AnimatePresence>
                        {agents.map((a, i) => (
                            <motion.div
                                key={a.agent.id}
                                initial={{ scale: 0, x: -10 }}
                                animate={{ scale: 1, x: 0 }}
                                exit={{ scale: 0 }}
                                transition={{ delay: i * 0.1, type: 'spring', stiffness: 300 }}
                                className="w-7 h-7 rounded-full flex items-center justify-center text-xs border-2 border-background"
                                style={{ backgroundColor: AGENT_COLORS[a.agent.id] || '#6366f1', zIndex: agents.length - i }}
                                title={`${a.agent.emoji} ${a.agent.name}`}
                            >
                                {a.agent.emoji}
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
                <span className="text-sm text-foreground/70 ml-2">
                    {isCollaborating ? (
                        <span className="flex items-center gap-1.5">
                            <motion.span
                                animate={{ opacity: [1, 0.4, 1] }}
                                transition={{ repeat: Infinity, duration: 1.5 }}
                                className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400"
                            />
                            Collaborating...
                        </span>
                    ) : (
                        `${agents.length} agents collaborated`
                    )}
                </span>
            </div>

            {/* Agent Responses */}
            <div className="divide-y divide-white/5">
                <AnimatePresence>
                    {agents.map((a, i) => (
                        <motion.div
                            key={a.agent.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.15 }}
                            className="px-4 py-3"
                        >
                            <div className="flex items-center gap-2 mb-1.5">
                                <span
                                    className="w-5 h-5 rounded-full flex items-center justify-center text-[10px]"
                                    style={{ backgroundColor: AGENT_COLORS[a.agent.id] || '#6366f1' }}
                                >
                                    {a.agent.emoji}
                                </span>
                                <span className="text-xs font-medium" style={{ color: AGENT_COLORS[a.agent.id] }}>
                                    {a.agent.name}
                                </span>
                                <span className="text-[10px] text-foreground/40">{a.agent.specialty}</span>
                            </div>
                            <p className="text-sm text-foreground/80 leading-relaxed pl-7">
                                {a.error ? (
                                    <span className="text-red-400">{a.content}</span>
                                ) : (
                                    a.content
                                )}
                            </p>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            {/* Synthesis */}
            {synthesis && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="px-4 py-3 border-t border-white/10 bg-gradient-to-r from-indigo-500/5 to-purple-500/5"
                >
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold text-indigo-400">✨ Taipei 3 Synthesis</span>
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed">{synthesis}</p>
                </motion.div>
            )}
        </div>
    );
}
