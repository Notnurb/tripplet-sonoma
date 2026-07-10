import { Attachment, CodeExecution } from '@/types';

interface ParsedMessageMetadata {
    attachments?: Attachment[];
    codeExecutions?: CodeExecution[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function parseAttachments(value: unknown): Attachment[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const attachments = value.filter((item): item is Attachment => {
        if (!isRecord(item)) return false;
        return (
            typeof item.id === 'string' &&
            (item.type === 'image' || item.type === 'file') &&
            typeof item.url === 'string' &&
            typeof item.name === 'string'
        );
    });
    return attachments.length > 0 ? attachments : undefined;
}

function parseCodeExecutions(value: unknown): CodeExecution[] | undefined {
    if (!Array.isArray(value)) return undefined;

    const executions = value
        .filter((item): item is Record<string, unknown> => isRecord(item))
        .map((item): CodeExecution | null => {
            if (
                typeof item.id !== 'string' ||
                (item.language !== 'python' && item.language !== 'bash') ||
                typeof item.code !== 'string' ||
                (item.status !== 'queued' &&
                    item.status !== 'running' &&
                    item.status !== 'completed' &&
                    item.status !== 'error')
            ) {
                return null;
            }

            return {
                id: item.id,
                toolCallId: typeof item.toolCallId === 'string' ? item.toolCallId : undefined,
                language: item.language,
                code: item.code,
                status: item.status,
                stdout: typeof item.stdout === 'string' ? item.stdout : undefined,
                stderr: typeof item.stderr === 'string' ? item.stderr : undefined,
                output: typeof item.output === 'string' ? item.output : undefined,
                error: typeof item.error === 'string' ? item.error : undefined,
                sandboxId: typeof item.sandboxId === 'string' ? item.sandboxId : undefined,
                startedAt: typeof item.startedAt === 'string' ? item.startedAt : undefined,
                completedAt: typeof item.completedAt === 'string' ? item.completedAt : undefined,
            };
        })
        .filter((item): item is CodeExecution => item !== null);

    return executions.length > 0 ? executions : undefined;
}

export function parseMessageMetadata(raw: unknown): ParsedMessageMetadata {
    if (Array.isArray(raw)) {
        return {
            attachments: parseAttachments(raw),
        };
    }

    if (!isRecord(raw)) {
        return {};
    }

    return {
        attachments: parseAttachments(raw.attachments),
        codeExecutions: parseCodeExecutions(raw.codeExecutions),
    };
}

export function serializeMessageMetadata(data: ParsedMessageMetadata): Record<string, unknown> | null {
    const attachments = data.attachments?.length ? data.attachments : undefined;
    const codeExecutions = data.codeExecutions?.length ? data.codeExecutions : undefined;

    if (!attachments && !codeExecutions) {
        return null;
    }

    const payload: Record<string, unknown> = {};
    if (attachments) {
        payload.attachments = attachments;
    }
    if (codeExecutions) {
        payload.codeExecutions = codeExecutions;
    }
    return payload;
}
