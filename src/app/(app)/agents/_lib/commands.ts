// Slash-command execution for the Multi-Agent Workspace, extracted from the
// page component. The page parses the input, resolves the session, and hands
// this module a context of state operations — so command behavior lives here
// (independently readable/testable) while React state stays in the page.

import type { Dispatch, SetStateAction } from 'react';
import { ChatMode } from '@/types';
import { toggleMode } from '@/lib/ai/modes';
import {
    type AgentMessage,
    type AgentSession,
    type AgentGroup,
    MODEL_META,
    estimateTokens,
    uid,
    createSession,
} from './agents-core';

export interface CommandContext {
    sessions: AgentSession[];
    groups: AgentGroup[];
    activeModes: ChatMode[];
    setSessions: Dispatch<SetStateAction<AgentSession[]>>;
    setGroups: Dispatch<SetStateAction<AgentGroup[]>>;
    setActiveId: (id: string) => void;
    setActiveModes: Dispatch<SetStateAction<ChatMode[]>>;
    setSubAgentInitialName: (name: string) => void;
    setShowSubAgentModal: (show: boolean) => void;
    updateSession: (id: string, patch: Partial<AgentSession> | ((s: AgentSession) => Partial<AgentSession>)) => void;
    addSystemInfoMessage: (agentId: string, text: string) => void;
    addSpecialCard: (agentId: string, type: 'stats' | 'help' | 'cost' | 'compare') => void;
    streamAgentMessage: (
        agentId: string,
        history: { role: string; content: string }[],
        model: string,
        systemPrompt: string,
        extendedThinking: boolean,
    ) => void;
    /** Per-agent /auto timers — owned by the page (cleared on unmount/delete). */
    autoIntervals: Map<string, ReturnType<typeof setInterval>>;
}

export function executeSlashCommand(
    command: string,
    arg: string,
    agentId: string,
    session: AgentSession,
    ctx: CommandContext,
): void {
    const {
        sessions, groups, activeModes,
        setSessions, setGroups, setActiveId, setActiveModes,
        setSubAgentInitialName, setShowSubAgentModal,
        updateSession, addSystemInfoMessage, addSpecialCard,
        streamAgentMessage, autoIntervals,
    } = ctx;

    switch (command) {
        case '/agents': {
            setSubAgentInitialName(arg || '');
            setShowSubAgentModal(true);
            break;
        }

        case '/broadcast': {
            if (!arg) break;
            const groupId = session.groupId;
            const targets = groupId
                ? sessions.filter((s) => s.groupId === groupId && s.id !== agentId)
                : [];
            if (targets.length === 0) {
                addSystemInfoMessage(agentId, 'No group members to broadcast to. Use /group [name] first.');
                break;
            }
            targets.forEach((t) => {
                const userMsg: AgentMessage = {
                    id: uid(), role: 'user', content: arg, timestamp: new Date(),
                    tokenCount: estimateTokens(arg),
                };
                setSessions((prev) => prev.map((s) =>
                    s.id === t.id ? { ...s, messages: [...s.messages, userMsg] } : s
                ));
                const history = [...t.messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
                streamAgentMessage(t.id, history, t.model, t.systemPrompt, t.extendedThinking);
            });
            break;
        }

        case '/group': {
            const groupName = arg || 'Group 1';
            const existing = groups.find((g) => g.name === groupName);
            if (existing) {
                updateSession(agentId, { groupId: existing.id });
                setSessions((prev) => prev.map((s) =>
                    s.id === agentId ? { ...s, groupId: existing.id } : s
                ));
                setGroups((prev) => prev.map((g) =>
                    g.id === existing.id && !g.agentIds.includes(agentId)
                        ? { ...g, agentIds: [...g.agentIds, agentId] }
                        : g
                ));
            } else {
                const newGroup: AgentGroup = {
                    id: uid(), name: groupName, agentIds: [agentId], collapsed: false,
                };
                setGroups((prev) => [...prev, newGroup]);
                setSessions((prev) => prev.map((s) =>
                    s.id === agentId ? { ...s, groupId: newGroup.id } : s
                ));
            }
            addSystemInfoMessage(agentId, `Joined group "${groupName}".`);
            break;
        }

        case '/fork': {
            const forked = createSession({
                name: `${session.name} (Fork)`,
                systemPrompt: session.systemPrompt,
                model: session.model,
                messages: [...session.messages],
                groupId: session.groupId,
                extendedThinking: session.extendedThinking,
            });
            setSessions((prev) => [...prev, forked]);
            setActiveId(forked.id);
            break;
        }

        case '/auto': {
            const wasEnabled = session.autoEnabled;
            updateSession(agentId, { autoEnabled: !wasEnabled });
            if (!wasEnabled) {
                // Start auto-continue interval
                const interval = setInterval(() => {
                    setSessions((prev) => {
                        const s = prev.find((x) => x.id === agentId);
                        if (!s || s.isStreaming) return prev;
                        const continueMsg: AgentMessage = {
                            id: uid(), role: 'user', content: 'Continue and give me a status update.',
                            timestamp: new Date(), tokenCount: estimateTokens('Continue and give me a status update.'),
                        };
                        const history = [...s.messages, continueMsg].map((m) => ({ role: m.role, content: m.content }));
                        streamAgentMessage(agentId, history, s.model, s.systemPrompt, s.extendedThinking);
                        return prev.map((x) => x.id === agentId ? { ...x, messages: [...x.messages, continueMsg] } : x);
                    });
                }, 30000);
                autoIntervals.set(agentId, interval);
            } else {
                const existing = autoIntervals.get(agentId);
                if (existing) { clearInterval(existing); autoIntervals.delete(agentId); }
            }
            break;
        }

        case '/think': {
            updateSession(agentId, (s) => ({ extendedThinking: !s.extendedThinking }));
            break;
        }

        case '/search': {
            setActiveModes((prev) => toggleMode(prev, 'web-search'));
            addSystemInfoMessage(agentId, activeModes.includes('web-search') ? 'Web search disabled.' : 'Web search enabled.');
            break;
        }

        case '/model': {
            const modelMap: Record<string, string> = {
                taipei: 'taipei4', majuli: 'majuli4', suzhou: 'suzhou4',
            };
            const newModel = modelMap[arg.toLowerCase()];
            if (newModel) {
                updateSession(agentId, { model: newModel });
                addSystemInfoMessage(agentId, `Model changed to ${MODEL_META[newModel].displayName}.`);
            } else {
                addSystemInfoMessage(agentId, 'Usage: /model taipei | majuli | suzhou');
            }
            break;
        }

        case '/clearcontext': {
            updateSession(agentId, { messages: [], inputTokens: 0, outputTokens: 0 });
            break;
        }

        case '/summarize': {
            const summaryMsg: AgentMessage = {
                id: uid(), role: 'user',
                content: 'Summarize our conversation so far in 3 bullet points.',
                timestamp: new Date(),
                tokenCount: estimateTokens('Summarize our conversation so far in 3 bullet points.'),
            };
            setSessions((prev) => prev.map((s) =>
                s.id === agentId ? { ...s, messages: [...s.messages, summaryMsg] } : s
            ));
            const history = [...session.messages, summaryMsg].map((m) => ({ role: m.role, content: m.content }));
            streamAgentMessage(agentId, history, session.model, session.systemPrompt, session.extendedThinking);
            break;
        }

        case '/pin': {
            setSessions((prev) => prev.map((s) => {
                if (s.id !== agentId) return s;
                const lastAssistantIdx = [...s.messages].reverse().findIndex((m) => m.role === 'assistant');
                if (lastAssistantIdx === -1) return s;
                const realIdx = s.messages.length - 1 - lastAssistantIdx;
                const updated = s.messages.map((m, i) => i === realIdx ? { ...m, pinned: true } : m);
                return { ...s, messages: updated };
            }));
            break;
        }

        case '/export': {
            const lines: string[] = [`# ${session.name}\n`, `> Model: ${MODEL_META[session.model]?.displayName}\n`];
            session.messages.forEach((m) => {
                lines.push(`\n## ${m.role === 'user' ? 'You' : 'Agent'} — ${m.timestamp.toLocaleTimeString()}\n`);
                lines.push(m.content);
            });
            const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${session.name.replace(/\s+/g, '-').toLowerCase()}.md`;
            a.click();
            URL.revokeObjectURL(url);
            break;
        }

        case '/rename': {
            if (arg) updateSession(agentId, { name: arg });
            break;
        }

        case '/stats': {
            addSpecialCard(agentId, 'stats');
            break;
        }

        case '/help': {
            addSpecialCard(agentId, 'help');
            break;
        }

        case '/cost': {
            addSpecialCard(agentId, 'cost');
            break;
        }

        case '/compare': {
            addSpecialCard(agentId, 'compare');
            break;
        }

        default: {
            addSystemInfoMessage(agentId, `Unknown command: ${command}. Type /help to see all commands.`);
        }
    }
}
