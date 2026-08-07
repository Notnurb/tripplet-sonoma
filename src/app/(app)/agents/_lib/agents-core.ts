// Shared types, model metadata, slash-command reference, and pure helpers for
// the Multi-Agent Workspace. Extracted from the page component so the page file
// holds orchestration state, not data definitions and formatting utilities.

import type React from 'react';
import {
    Cpu,
    Radio,
    Users,
    GitBranch,
    Zap,
    Brain,
    Globe,
    Eraser,
    FileText,
    Pin,
    Download,
    Pencil,
    BarChart3,
    HelpCircle,
    DollarSign,
    Columns2,
} from 'lucide-react';
import { Message } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    model?: string;
    pinned?: boolean;
    tokenCount?: number;
}

export interface AgentSession {
    id: string;
    name: string;
    systemPrompt: string;
    model: string;
    messages: AgentMessage[];
    isStreaming: boolean;
    streamingContent: string;
    sessionStart: Date;
    inputTokens: number;
    outputTokens: number;
    groupId: string | null;
    isSubAgent: boolean;
    subAgentPurpose?: string;
    autoEnabled: boolean;
    extendedThinking: boolean;
}

export interface AgentGroup {
    id: string;
    name: string;
    agentIds: string[];
    collapsed: boolean;
}

export interface SlashCommand {
    name: string;
    args?: string;
    description: string;
    category: 'session' | 'group' | 'ai' | 'ui' | 'export';
    icon: React.ElementType;
}

// ─── Model Metadata ───────────────────────────────────────────────────────────

export const MODEL_META: Record<string, {
    displayName: string;
    inputPricePerM: number;
    outputPricePerM: number;
    contextWindow: number;
}> = {
    'taipei4':   { displayName: 'Taipei 3.1',  inputPricePerM: 3,  outputPricePerM: 15, contextWindow: 131072 },
    'majuli4': { displayName: 'Majuli 3.1',  inputPricePerM: 2,  outputPricePerM: 10, contextWindow: 131072 },
    'suzhou4': { displayName: 'Suzhou 3.1',  inputPricePerM: 2,  outputPricePerM: 10, contextWindow: 131072 },
};

export const DEFAULT_MODEL = 'suzhou4';

// ─── Slash Commands Reference ─────────────────────────────────────────────────

export const SLASH_COMMANDS: SlashCommand[] = [
    { name: '/agents',       args: '[name]',              description: 'Create a SubAgent with a custom purpose',    category: 'session', icon: Cpu },
    { name: '/broadcast',    args: '[msg]',               description: 'Send a message to all agents in the group',  category: 'group',   icon: Radio },
    { name: '/group',        args: '[name]',              description: 'Create a group or add this agent to one',    category: 'group',   icon: Users },
    { name: '/fork',         args: '',                    description: 'Clone this agent as a new session',          category: 'session', icon: GitBranch },
    { name: '/auto',         args: '',                    description: 'Toggle auto-continue every 30 seconds',      category: 'session', icon: Zap },
    { name: '/think',        args: '',                    description: 'Toggle extended thinking mode',              category: 'ai',      icon: Brain },
    { name: '/search',       args: '',                    description: 'Toggle web search mode',                     category: 'ai',      icon: Globe },
    { name: '/model',        args: 'taipei|majuli|suzhou', description: 'Switch the active model',                  category: 'session', icon: Cpu },
    { name: '/clearcontext', args: '',                    description: 'Clear all messages for this agent',          category: 'session', icon: Eraser },
    { name: '/summarize',    args: '',                    description: 'Ask the agent to summarize the conversation', category: 'ai',     icon: FileText },
    { name: '/pin',          args: '',                    description: 'Pin the last assistant message',             category: 'ui',      icon: Pin },
    { name: '/export',       args: '',                    description: 'Download conversation as Markdown',          category: 'export',  icon: Download },
    { name: '/rename',       args: '[name]',              description: 'Rename this agent',                         category: 'session', icon: Pencil },
    { name: '/stats',        args: '',                    description: 'Show usage statistics across all agents',    category: 'ui',      icon: BarChart3 },
    { name: '/help',         args: '',                    description: 'Show all available commands',               category: 'ui',      icon: HelpCircle },
    { name: '/cost',         args: '',                    description: 'Show cost breakdown for this session',       category: 'ui',      icon: DollarSign },
    { name: '/compare',      args: '',                    description: 'Compare last responses from all agents',     category: 'ui',      icon: Columns2 },
];

// ─── Slash Command Usage Tracking ────────────────────────────────────────────

const CMD_USAGE_KEY = 'tripplet_agent_cmd_usage';

export function getCommandUsage(): Record<string, number> {
    if (typeof window === 'undefined') return {};
    try {
        return JSON.parse(localStorage.getItem(CMD_USAGE_KEY) ?? '{}');
    } catch { return {}; }
}

export function bumpCommandUsage(cmdName: string) {
    if (typeof window === 'undefined') return;
    try {
        const usage = getCommandUsage();
        usage[cmdName] = (usage[cmdName] ?? 0) + 1;
        localStorage.setItem(CMD_USAGE_KEY, JSON.stringify(usage));
    } catch { /* ignore */ }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Cheap token estimator: 1 token ≈ 4 chars. */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/** Generate a short unique ID. */
export function uid(): string {
    return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Format elapsed milliseconds as MM:SS. */
export function formatElapsed(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Convert an AgentMessage into the Message type MessageBubble expects. */
export function agentMsgToMessage(m: AgentMessage): Message {
    return {
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        model: m.model,
    };
}

/** Create a fresh AgentSession with safe defaults. */
export function createSession(overrides: Partial<AgentSession> = {}): AgentSession {
    return {
        id: uid(),
        name: 'Agent 1',
        systemPrompt: 'You are a helpful AI assistant.',
        model: DEFAULT_MODEL,
        messages: [],
        isStreaming: false,
        streamingContent: '',
        sessionStart: new Date(),
        inputTokens: 0,
        outputTokens: 0,
        groupId: null,
        isSubAgent: false,
        autoEnabled: false,
        extendedThinking: false,
        ...overrides,
    };
}
