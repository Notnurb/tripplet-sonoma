// ─── Multi-AI Collaboration ──────────────────────────────────────────────────

export interface AgentInfo {
    id: string;
    name: string;
    emoji: string;
    specialty: string;
}

export interface AgentResponse {
    agent: AgentInfo;
    content: string;
    timestamp: string;
    error?: boolean;
}

export interface CollaborationResult {
    mode: 'sequential' | 'batch' | 'batch_http';
    query: string;
    agent_count: number;
    responses: AgentResponse[];
    synthesis: string;
    timestamp: string;
    batch_id?: string;
}
