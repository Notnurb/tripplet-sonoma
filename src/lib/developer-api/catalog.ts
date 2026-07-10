export type ModelTier = 'flagship' | 'standard' | 'legacy' | 'agent' | 'experimental';

export interface ModelCatalogEntry {
    id: string;
    name: string;
    family: string;
    context: string;
    tier: ModelTier;
    description: string;
    extended?: boolean;
    apiModel?: string;
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
    { id: 'taipei-3.1-extended', name: 'Taipei 3.1 Extended', family: 'Taipei', context: '200K', tier: 'flagship', description: 'Extended thinking, max depth reasoning.', extended: true },
    { id: 'taipei-3.1', name: 'Taipei 3.1', family: 'Taipei', context: '200K', tier: 'flagship', description: 'Full reasoning, balanced speed.' },
    { id: 'taipei-3-extended', name: 'Taipei 3 Extended', family: 'Taipei', context: '128K', tier: 'standard', description: 'Extended context version of Taipei 3.', extended: true },
    { id: 'taipei-3', name: 'Taipei 3', family: 'Taipei', context: '128K', tier: 'standard', description: 'Standard Taipei conversation model.' },
    { id: 'majuli-3.1-extended', name: 'Majuli 3.1 Extended', family: 'Majuli', context: '200K', tier: 'flagship', description: 'Extended introspection and reasoning.', extended: true },
    { id: 'majuli-3.1', name: 'Majuli 3.1', family: 'Majuli', context: '200K', tier: 'flagship', description: 'Fast and precise across varied prompts.' },
    { id: 'majuli-3-extended', name: 'Majuli 3 Extended', family: 'Majuli', context: '128K', tier: 'standard', description: 'Extended Majuli for larger conversations.', extended: true },
    { id: 'majuli-3', name: 'Majuli 3', family: 'Majuli', context: '128K', tier: 'standard', description: 'Streaming-friendly chat and code workflows.' },
    { id: 'majuli-2.5', name: 'Majuli 2.5', family: 'Majuli', context: '64K', tier: 'legacy', description: 'Earlier Majuli build, still supported for compatibility.' },
    { id: 'suzhou-3.1-extended', name: 'Suzhou 3.1 Extended', family: 'Suzhou', context: '200K', tier: 'flagship', description: 'Creative extended-context story crafting.', extended: true },
    { id: 'suzhou-3.1', name: 'Suzhou 3.1', family: 'Suzhou', context: '200K', tier: 'flagship', description: 'Detailed, imaginative writing.' },
    { id: 'suzhou-3-extended', name: 'Suzhou 3 Extended', family: 'Suzhou', context: '128K', tier: 'standard', description: 'Extended Suzhou for larger narratives.', extended: true },
    { id: 'suzhou-3', name: 'Suzhou 3', family: 'Suzhou', context: '128K', tier: 'standard', description: 'Creative output with reliable coherence.' },
    { id: 'suzhou-2.5', name: 'Suzhou 2.5', family: 'Suzhou', context: '64K', tier: 'legacy', description: 'Legacy writer tuned for quick drafts.' },
    { id: 'tura-2.5', name: 'Tura 2.5', family: 'Tura', context: '64K', tier: 'legacy', description: 'Standalone reasoning baseline.' },
    { id: 'tagent-2-max', name: 'Tripplet Agent 2 Max', family: 'Agent', context: '256K', tier: 'agent', description: 'Agent with highest memory and tools access.' },
    { id: 'tagent-2-super', name: 'Tripplet Agent 2 Super', family: 'Agent', context: '256K', tier: 'agent', description: 'Rich agent with advanced planning.' },
    { id: 'tagent-2', name: 'Tripplet Agent 2', family: 'Agent', context: '200K', tier: 'agent', description: 'Balanced pro agent for structured workflows.' },
    { id: 'tagent-1.5-max', name: 'Tripplet Agent 1.5 Max', family: 'Agent', context: '200K', tier: 'agent', description: 'Tool-enabled agent tuned for business.' },
    { id: 'tagent-1.5-super', name: 'Tripplet Agent 1.5 Super', family: 'Agent', context: '200K', tier: 'agent', description: 'Supercharged 1.5 agent for creative teams.' },
    { id: 'tagent-1.5', name: 'Tripplet Agent 1.5', family: 'Agent', context: '128K', tier: 'agent', description: 'General purpose assistant with tool access.' },
    { id: 'tagent-1-max', name: 'Tripplet Agent 1 Max', family: 'Agent', context: '128K', tier: 'agent', description: 'Max agent for deep enterprise context.' },
    { id: 'tagent-1-super', name: 'Tripplet Agent 1 Super', family: 'Agent', context: '128K', tier: 'agent', description: 'Centered on productivity and recall.' },
    { id: 'tagent-1', name: 'Tripplet Agent 1', family: 'Agent', context: '128K', tier: 'agent', description: 'Tool-enabled assistant for daily work.' },
    { id: 'tagentbeta-pro', name: 'Tripplet Agent Beta Pro', family: 'Agent', context: '64K', tier: 'experimental', description: 'Experimental pro agent preview.' },
    { id: 'tagentbeta', name: 'Tripplet Agent Beta', family: 'Agent', context: '64K', tier: 'experimental', description: 'Early beta agent for testing new skills.' },
    { id: 'tagentbeta-lite', name: 'Tripplet Agent Beta Lite', family: 'Agent', context: '32K', tier: 'experimental', description: 'Lite preview agent.' },
    { id: 'syn8-1', name: 'Synthara 8.1', family: 'Synthara', context: '128K', tier: 'standard', description: 'Synthara-branded model for multi-modal prompts.' },
];

export const PUBLIC_API_MODELS: ModelCatalogEntry[] = [
    {
        id: 'tura-3',
        name: 'Taipei 3.1',
        family: 'Taipei',
        context: '200K',
        tier: 'flagship',
        apiModel: 'tripplet-4.20-beta-0309-reasoning',
        description: 'Advanced reasoning and analysis.',
    },
    {
        id: 'majuli-3',
        name: 'Majuli 3.1',
        family: 'Majuli',
        context: '200K',
        tier: 'standard',
        apiModel: 'tripplet-4.20-beta-0309-non-reasoning',
        description: 'Fast, concise chat completions.',
    },
    {
        id: 'suzhou-3',
        name: 'Suzhou 3.1',
        family: 'Suzhou',
        context: '200K',
        tier: 'standard',
        apiModel: 'tripplet-4.20-experimental-beta-0304-non-reasoning',
        description: 'Creative and detailed generation.',
    },
];

export function getPublicApiModel(id: string) {
    return PUBLIC_API_MODELS.find((model) => model.id === id);
}
