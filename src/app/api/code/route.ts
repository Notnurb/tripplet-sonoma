import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth/session';
import { getEpsilonTier, TEXT_MODEL_SYSTEM_PROMPT, CODE_MODEL_SYSTEM_PROMPT } from '@/lib/ai/epsilon';
import { LLM_API_KEY, resolveOpenCodeZenModel } from '@/lib/ai/llm';
import { chatLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';
import {
    EpsilonTierId,
    CodeFile,
    CodeCloudConfig,
    CodeDesignConfig,
} from '@/types';


type Provider = 'builtin' | 'openai' | 'claude';

interface RequestBody {
    message: string;
    tier: EpsilonTierId;
    chatHistory: { role: 'user' | 'assistant'; content: string }[];
    files: CodeFile[];
    planMode?: boolean;
    cloudConfig?: CodeCloudConfig;
    designConfig?: CodeDesignConfig;
    selectedModelId?: string;
    extendedThinking?: boolean;
}

interface ParsedFileOp {
    type: 'create' | 'modify' | 'delete';
    path: string;
    description: string;
}

interface GeneratedFileOp {
    type: string;
    path: string;
    content: string;
    language: string;
}

interface ProviderConfig {
    provider: Provider;
    apiKey: string;
    textModel: string;
    codeModel: string;
}

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

function parseFileOps(text: string): ParsedFileOp[] {
    const ops: ParsedFileOp[] = [];
    const regex = /<<<FILE_OP>>>([\s\S]*?)<<<END_FILE_OP>>>/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        const block = match[1];
        const typeMatch = block.match(/TYPE:\s*(CREATE|MODIFY|DELETE)/i);
        const pathMatch = block.match(/PATH:\s*(.+)/);
        const descMatch = block.match(/DESCRIPTION:\s*([\s\S]*?)(?=\n(?:TYPE:|PATH:|$))/i);

        if (!typeMatch || !pathMatch) continue;

        ops.push({
            type: typeMatch[1].toLowerCase() as ParsedFileOp['type'],
            path: pathMatch[1].trim(),
            description: descMatch ? descMatch[1].trim() : '',
        });
    }

    return ops;
}

function getLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        html: 'html',
        css: 'css',
        json: 'json',
        md: 'markdown',
        py: 'python',
        svg: 'xml',
    };
    return map[ext] || 'text';
}

function getDesignContext(designConfig?: CodeDesignConfig): string {
    if (!designConfig) return '';

    return [
        'Design requirements from user settings:',
        `- React library: ${designConfig.reactLibrary}`,
        `- Main color: ${designConfig.mainColor}`,
        `- Accent color: ${designConfig.accentColor}`,
        `- Button theme: ${designConfig.buttonTheme}`,
        `- Compact spacing: ${designConfig.compactSpacing ? 'enabled' : 'disabled'}`,
        `- High contrast: ${designConfig.highContrast ? 'enabled' : 'disabled'}`,
        `- Animations: ${designConfig.enableAnimations ? 'enabled' : 'disabled'}`,
        `- Strong shadows: ${designConfig.strongShadows ? 'enabled' : 'disabled'}`,
    ].join('\n');
}

function getCloudContext(cloudConfig?: CodeCloudConfig): string {
    if (!cloudConfig) return '';

    const lines: string[] = [`Cloud provider preference: ${cloudConfig.provider}`];
    if (cloudConfig.model?.trim()) {
        lines.push(`Preferred model override: ${cloudConfig.model.trim()}`);
    }

    if (cloudConfig.supabaseUrl?.trim() && cloudConfig.supabaseAnonKey?.trim()) {
        lines.push('Supabase is connected for this project.');
        lines.push(`Supabase URL: ${cloudConfig.supabaseUrl.trim()}`);
        lines.push('Use env vars for keys; do not hardcode secrets in source files.');
    } else {
        lines.push('Supabase is not configured.');
    }

    return lines.join('\n');
}

function getProviderConfig(
    tierId: EpsilonTierId,
    cloudConfig?: CodeCloudConfig,
    selectedModelId?: string
): ProviderConfig {
    const epsilonTier = getEpsilonTier(tierId || 'pro');
    const provider = (cloudConfig?.provider || 'builtin') as Provider;
    let selectedModelApiModel: string | null = null;

    if (selectedModelId) {
        selectedModelApiModel = resolveOpenCodeZenModel(selectedModelId);
    }

    if (provider === 'builtin') {
        const apiKey = cloudConfig?.apiKey?.trim() || LLM_API_KEY;
        return {
            provider,
            apiKey,
            textModel: cloudConfig?.model?.trim() || selectedModelApiModel || epsilonTier.textModel,
            codeModel: cloudConfig?.model?.trim() || epsilonTier.codeModel,
        };
    }

    if (provider === 'openai') {
        const apiKey = cloudConfig?.apiKey?.trim() || process.env.OPENAI_API_KEY || '';
        if (!apiKey) {
            throw new Error('OpenAI key missing. Add it in Cloud settings or OPENAI_API_KEY.');
        }
        return {
            provider,
            apiKey,
            textModel: cloudConfig?.model?.trim() || 'gpt-4.1-mini',
            codeModel: cloudConfig?.model?.trim() || 'gpt-4.1',
        };
    }

    if (provider === 'claude') {
        const apiKey = cloudConfig?.apiKey?.trim() || process.env.ANTHROPIC_API_KEY || '';
        if (!apiKey) {
            throw new Error('Anthropic key missing. Add it in Cloud settings or ANTHROPIC_API_KEY.');
        }
        return {
            provider,
            apiKey,
            textModel: cloudConfig?.model?.trim() || 'claude-3-5-sonnet-latest',
            codeModel: cloudConfig?.model?.trim() || 'claude-3-5-sonnet-latest',
        };
    }

    throw new Error(`Unsupported provider: ${provider}`);
}

async function callProviderChat(params: {
    provider: Provider;
    apiKey: string;
    model: string;
    messages: ChatMessage[];
    temperature: number;
    maxTokens: number;
}): Promise<string> {
    throw new Error('External AI APIs have been disabled.');
}

async function generateCode(params: {
    provider: Provider;
    apiKey: string;
    codeModel: string;
    filePath: string;
    description: string;
    existingContent?: string;
    generationContext?: string;
}): Promise<string> {
    const { provider, apiKey, codeModel, filePath, description, existingContent, generationContext } = params;
    const messages: ChatMessage[] = [{ role: 'system', content: CODE_MODEL_SYSTEM_PROMPT }];

    let userMsg = [
        `Generate the complete contents for: ${filePath}`,
        '',
        `Description: ${description || 'Implement based on request context.'}`,
    ];

    if (generationContext) {
        userMsg.push('', generationContext);
    }

    if (existingContent) {
        userMsg.push(
            '',
            'Existing file contents:',
            '```',
            existingContent,
            '```',
            '',
            'Modify the above file according to the description. Output the COMPLETE modified file.'
        );
    }

    messages.push({ role: 'user', content: userMsg.join('\n') });

    const raw = await callProviderChat({
        provider,
        apiKey,
        model: codeModel,
        messages,
        temperature: 0.2,
        maxTokens: 16000,
    });

    return raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
}

export async function POST(request: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return new Response(
            JSON.stringify({ error: 'Authentication required.' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
    }
    const limitToken = getRateLimitToken(request, userId);
    try {
        await chatLimiter.check(LIMITS.chat, limitToken);
    } catch {
        return rateLimitResponse();
    }
    try {
        const body: RequestBody = await request.json();
        const {
            message,
            tier,
            chatHistory,
            files,
            planMode = false,
            cloudConfig,
            designConfig,
            selectedModelId,
            extendedThinking = false,
        } = body;

        if (!message?.trim()) {
            return Response.json({ error: 'Message is required' }, { status: 400 });
        }

        const providerConfig = getProviderConfig(tier || 'pro', cloudConfig, selectedModelId);
        const designContext = getDesignContext(designConfig);
        const cloudContext = getCloudContext(cloudConfig);
        const selectedModelContext = selectedModelId
            ? `\n\nSelected reasoning model preference: ${selectedModelId}`
            : '';

        const fileContext = files.length > 0
            ? `\n\nCurrent project files:\n${files.map((f) => `- ${f.path} (${f.language})`).join('\n')}`
            : '\n\nCurrent project files: none';

        const executionModePrompt = planMode
            ? '\n\nExecution mode: PLAN ON. Provide concise plan text plus FILE_OP blocks.'
            : '\n\nExecution mode: PLAN OFF. Prioritize immediate execution. Include FILE_OP blocks and only one short status line.';
        const thinkingPrompt = extendedThinking
            ? '\n\nExtended thinking is ON. Prioritize robustness, architecture quality, and edge cases before writing operations.'
            : '';

        const textMessages: ChatMessage[] = [
            {
                role: 'system',
                content:
                    TEXT_MODEL_SYSTEM_PROMPT +
                    fileContext +
                    executionModePrompt +
                    thinkingPrompt +
                    selectedModelContext +
                    (designContext ? `\n\n${designContext}` : '') +
                    (cloudContext ? `\n\n${cloudContext}` : ''),
            },
            ...chatHistory.slice(-10).map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: message },
        ];

        const planText = await callProviderChat({
            provider: providerConfig.provider,
            apiKey: providerConfig.apiKey,
            model: providerConfig.textModel,
            messages: textMessages,
            temperature: 0.45,
            maxTokens: 4000,
        });

        const fileOps = parseFileOps(planText);
        const cleanPlan = planText.replace(/<<<FILE_OP>>>[\s\S]*?<<<END_FILE_OP>>>/g, '').trim();
        const generationContext = [designContext, cloudContext].filter(Boolean).join('\n\n');

        const generatedOps: GeneratedFileOp[] = [];
        for (const op of fileOps) {
            if (op.type === 'delete') {
                generatedOps.push({ type: 'delete', path: op.path, content: '', language: '' });
                continue;
            }

            const existingFile = files.find((f) => f.path === op.path);
            const code = await generateCode({
                provider: providerConfig.provider,
                apiKey: providerConfig.apiKey,
                codeModel: providerConfig.codeModel,
                filePath: op.path,
                description: op.description,
                existingContent: existingFile?.content,
                generationContext,
            });

            generatedOps.push({
                type: op.type,
                path: op.path,
                content: code,
                language: getLanguage(op.path),
            });
        }

        const quickMessage = generatedOps.length > 0
            ? `Implemented ${generatedOps.length} file update${generatedOps.length === 1 ? '' : 's'}.`
            : 'No file changes were needed.';

        return Response.json({
            plan: cleanPlan,
            message: quickMessage,
            operations: generatedOps,
            tier: getEpsilonTier(tier || 'pro').name,
            provider: providerConfig.provider,
            planMode,
        });
    } catch (error: unknown) {
        console.error('Code generation error:', error);
        return Response.json(
            { error: error instanceof Error ? error.message : 'Code generation failed' },
            { status: 500 }
        );
    }
}
