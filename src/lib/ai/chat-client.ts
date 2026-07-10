import { resolveBackend } from '@/lib/ai/llm';

export interface ChatToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

export interface ChatToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | { type: string; text?: string; image_url?: { url: string } }[];
    tool_call_id?: string;
    tool_calls?: ChatToolCall[];
}

export type StreamChatEvent =
    | {
        type: 'content';
        content: string;
    }
    | {
        type: 'tool_calls';
        toolCalls: ChatToolCall[];
    };

interface StreamChatOptions {
    messages: ChatMessage[];
    modelId: string;
    apiKey?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: ChatToolDefinition[];
}

function flattenContent(content: ChatMessage['content']): string {
    if (typeof content === 'string') return content;
    return content
        .map((part) => (part.type === 'text' ? part.text ?? '' : ''))
        .join('');
}

function toOpenAIMessages(messages: ChatMessage[]): unknown[] {
    return messages.map((m) => {
        const base: Record<string, unknown> = {
            role: m.role,
            content: flattenContent(m.content),
        };
        if (m.tool_call_id) base.tool_call_id = m.tool_call_id;
        if (m.tool_calls && m.tool_calls.length > 0) base.tool_calls = m.tool_calls;
        return base;
    });
}

interface ToolCallAccumulator {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

export async function* streamChatEvents({
    messages,
    modelId,
    apiKey,
    temperature = 0.7,
    maxTokens,
    tools,
}: StreamChatOptions): AsyncGenerator<StreamChatEvent> {
    // Per-persona backend: Astro 5 → OpenCode Zen (glm-5.2), everything else → Groq.
    const target = resolveBackend(modelId);
    const key = apiKey || target.apiKey;
    if (!key) {
        const envVar = target.provider === 'opencode-zen' ? 'OPENCODE_ZEN_API_KEY' : 'GROQ_API_KEY';
        throw new Error(
            `${envVar} is not configured. Set it in your environment to enable ${target.provider} inference.`
        );
    }

    const body: Record<string, unknown> = {
        model: target.model,
        messages: toOpenAIMessages(messages),
        stream: true,
        temperature,
    };
    if (typeof maxTokens === 'number') body.max_tokens = maxTokens;
    if (tools && tools.length > 0) body.tools = tools;

    const resp = await fetch(target.url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
    });

    if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`${target.provider} upstream error ${resp.status}: ${errText.slice(0, 300)}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolCalls: Map<number, ToolCallAccumulator> = new Map();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, sep).trim();
            buffer = buffer.slice(sep + 1);
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') {
                if (toolCalls.size > 0) {
                    yield {
                        type: 'tool_calls',
                        toolCalls: [...toolCalls.values()].map((t) => ({
                            id: t.id,
                            type: 'function' as const,
                            function: { name: t.function.name, arguments: t.function.arguments },
                        })),
                    };
                }
                return;
            }
            let chunk: {
                choices?: Array<{
                    delta?: {
                        content?: string | null;
                        tool_calls?: Array<{
                            index?: number;
                            id?: string;
                            type?: 'function';
                            function?: { name?: string; arguments?: string };
                        }>;
                    };
                }>;
            };
            try {
                chunk = JSON.parse(payload);
            } catch {
                continue;
            }
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;

            if (typeof delta.content === 'string' && delta.content.length > 0) {
                yield { type: 'content', content: delta.content };
            }
            if (Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    const existing = toolCalls.get(idx) ?? {
                        id: tc.id ?? `call_${idx}`,
                        type: 'function' as const,
                        function: { name: '', arguments: '' },
                    };
                    if (tc.id) existing.id = tc.id;
                    if (tc.function?.name) existing.function.name = tc.function.name;
                    if (typeof tc.function?.arguments === 'string') {
                        existing.function.arguments += tc.function.arguments;
                    }
                    toolCalls.set(idx, existing);
                }
            }
        }
    }

    if (toolCalls.size > 0) {
        yield {
            type: 'tool_calls',
            toolCalls: [...toolCalls.values()].map((t) => ({
                id: t.id,
                type: 'function' as const,
                function: { name: t.function.name, arguments: t.function.arguments },
            })),
        };
    }
}

export async function* streamChat(
    messages: ChatMessage[],
    modelId: string,
    _apiKey: string,
    temperature: number = 0.7,
    maxTokens?: number,
): AsyncGenerator<string> {
    for await (const ev of streamChatEvents({ messages, modelId, temperature, maxTokens })) {
        if (ev.type === 'content') yield ev.content;
    }
}

export async function analyzeImage(
    _imageBase64: string,
    _mimeType: string,
): Promise<string> {
    throw new Error('Vision/image analysis is not available — the current backends serve text-only models.');
}

