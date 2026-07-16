import type { AgentResponse } from './collaboration';
import type { SearchResult } from './search';

export type Role = 'system' | 'user' | 'assistant' | 'data';

export type ToneType = 'formal' | 'concise' | 'detailed' | 'minimal';

export type ChatMode = 'think' | 'deep-research' | 'web-search' | 'study' | 'code' | 'creative' | 'summarize' | 'eli5' | 'brainstorm' | 'roleplay' | 'debate' | 'translate' | 'fact-check' | 'freestyle';

export interface ActiveModes {
    modes: ChatMode[];
    tone: ToneType | null;
}

export type AutoSkillSetting = 'off' | 'ask' | 'auto';

export type TaskStatusType = 'idle' | 'thinking' | 'searching' | 'analyzing' | 'generating' | 'reading' | 'processing' | 'collaborating' | 'web_searching' | 'remembering';

export interface Attachment {
    id: string;
    type: 'image' | 'file';
    url: string;
    name: string;
}

export type CodeExecutionStatus = 'queued' | 'running' | 'completed' | 'error';

export interface CodeExecution {
    id: string;
    toolCallId?: string;
    language: 'python' | 'bash';
    code: string;
    status: CodeExecutionStatus;
    stdout?: string;
    stderr?: string;
    output?: string;
    error?: string;
    sandboxId?: string;
    startedAt?: string;
    completedAt?: string;
}

export interface Message {
    id: string;
    role: Role;
    content: string;
    timestamp: Date;
    model?: string;
    attachments?: Attachment[];
    tone?: ToneType;
    extendedThinking?: boolean;
    searchCount?: number;
    agents?: AgentResponse[];
    searchResults?: SearchResult[];
    isCollaboration?: boolean;
    codeExecutions?: CodeExecution[];
    // Set when a guest hits the free-message wall — the bubble renders as a
    // friendly upgrade prompt (link to create an account) instead of a red
    // error, so the highest-stakes conversion moment isn't framed as a failure.
    isGuestLimit?: boolean;
}

export interface Conversation {
    id: string;
    title: string;
    model: string;
    updatedAt: Date;
    createdAt: Date;
    messages: Message[];
}
