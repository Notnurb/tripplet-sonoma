// ─── Code Editor (Epsilon) ────────────────────────────────────────────────────

export type EpsilonTierId = 'fast' | 'pro' | 'max';

export interface CodeFile {
    path: string;        // e.g. "src/App.tsx"
    content: string;
    language: string;    // e.g. "typescript", "html", "css"
}

export interface FileOperation {
    type: 'create' | 'modify' | 'delete';
    path: string;
    content?: string;
    language?: string;
}

export interface CodeChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    fileOps?: FileOperation[];
    timestamp: Date;
}

export interface CodeProject {
    id: string;
    name: string;
    files: CodeFile[];
    chatHistory: CodeChatMessage[];
    tier: EpsilonTierId;
    createdAt: Date;
    updatedAt: Date;
}

export type CodeAiProvider = 'builtin' | 'openai' | 'claude';

export interface CodeCloudConfig {
    provider: CodeAiProvider;
    apiKey?: string;
    model?: string;
    supabaseUrl?: string;
    supabaseAnonKey?: string;
    supabaseServiceRoleKey?: string;
}

export interface CodeDesignConfig {
    reactLibrary: 'none' | 'shadcn' | 'mui' | 'chakra' | 'mantine' | 'ant';
    mainColor: string;
    accentColor: string;
    buttonTheme: 'rounded' | 'pill' | 'sharp' | 'soft';
    compactSpacing: boolean;
    highContrast: boolean;
    enableAnimations: boolean;
    strongShadows: boolean;
}

export interface CodePublishMetadata {
    slug: string;
    title: string;
    description?: string;
    favicon?: string;
    image?: string;
    ownerUserId?: string;
}

export interface CodeGenerationMetrics {
    generationCount: number;
    successCount: number;
    failedCount: number;
    totalOperations: number;
    avgGenerationMs: number;
    lastGenerationMs: number;
    lastGeneratedAt?: string;
}
