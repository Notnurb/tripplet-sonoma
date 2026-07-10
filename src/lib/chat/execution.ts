// run_code execution for the legacy /api/chat path: normalizes backend
// execution payloads into the client's CodeExecution shape and streams the
// backend's SSE execution events, re-emitting them to the chat stream via the
// caller's onEvent. Extracted from the route handler.

import { randomUUID } from 'crypto';
import { CodeExecution } from '@/types';
import { backendFetch } from '@/lib/backend';

export function formatExecutionError(error: unknown): string | undefined {
    if (!error) return undefined;
    if (typeof error === 'string') return error;
    if (typeof error !== 'object') return String(error);

    const record = error as Record<string, unknown>;
    const parts = [
        typeof record.message === 'string' ? record.message : null,
        typeof record.value === 'string' ? record.value : null,
        typeof record.traceback === 'string' ? record.traceback : null,
    ].filter((value): value is string => Boolean(value));

    if (parts.length > 0) {
        return parts.join('\n');
    }

    return JSON.stringify(record);
}

export function mergeExecution(base: CodeExecution, patch: Partial<CodeExecution>): CodeExecution {
    return {
        ...base,
        ...patch,
        stdout: patch.stdout ?? base.stdout,
        stderr: patch.stderr ?? base.stderr,
        output: patch.output ?? base.output,
        error: patch.error ?? base.error,
    };
}

export function coerceExecution(raw: unknown, fallback: Pick<CodeExecution, 'id' | 'language' | 'code'> & { toolCallId?: string }): CodeExecution {
    const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const status = record.status;
    return {
        id: typeof record.id === 'string' ? record.id : fallback.id,
        toolCallId: fallback.toolCallId,
        language: record.language === 'bash' ? 'bash' : fallback.language,
        code: typeof record.code === 'string' ? record.code : fallback.code,
        status:
            status === 'queued' || status === 'running' || status === 'completed' || status === 'error'
                ? status
                : 'running',
        stdout: typeof record.stdout === 'string' ? record.stdout : undefined,
        stderr: typeof record.stderr === 'string' ? record.stderr : undefined,
        output: typeof record.output === 'string' ? record.output : undefined,
        error: formatExecutionError(record.error),
        sandboxId: typeof record.sandbox_id === 'string'
            ? record.sandbox_id
            : typeof record.sandboxId === 'string'
                ? record.sandboxId
                : undefined,
        startedAt: typeof record.started_at === 'string'
            ? record.started_at
            : typeof record.startedAt === 'string'
                ? record.startedAt
                : undefined,
        completedAt: typeof record.completed_at === 'string'
            ? record.completed_at
            : typeof record.completedAt === 'string'
                ? record.completedAt
                : undefined,
    };
}

export async function executeRunCodeTool(params: {
    sessionId: string;
    toolCallId: string;
    language: 'python' | 'bash';
    code: string;
    onEvent: (event: Record<string, unknown>) => Promise<void> | void;
}): Promise<CodeExecution> {
    const executionId = randomUUID();
    let execution: CodeExecution = {
        id: executionId,
        toolCallId: params.toolCallId,
        language: params.language,
        code: params.code,
        status: 'queued',
    };

    const resp = await backendFetch('/code/execute/stream', {
        method: 'POST',
        body: JSON.stringify({
            session_id: params.sessionId,
            execution_id: executionId,
            language: params.language,
            code: params.code,
        }),
        signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
        const errorBody = await resp.json().catch(() => ({}));
        const detail = typeof errorBody.detail === 'string' ? errorBody.detail : 'Code execution service unavailable';
        throw new Error(detail);
    }

    const reader = resp.body?.getReader();
    if (!reader) {
        throw new Error('Code execution stream was unavailable.');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);
            if (data === '[DONE]') {
                return execution;
            }

            const parsed = JSON.parse(data) as Record<string, unknown>;
            if (parsed.type === 'started') {
                execution = mergeExecution(
                    execution,
                    coerceExecution(parsed.execution, {
                        id: execution.id,
                        toolCallId: params.toolCallId,
                        language: params.language,
                        code: params.code,
                    })
                );
                await params.onEvent({ type: 'code_execution_started', execution });
                continue;
            }

            if (parsed.type === 'stdout' && typeof parsed.chunk === 'string') {
                execution = mergeExecution(execution, {
                    status: 'running',
                    stdout: `${execution.stdout || ''}${parsed.chunk}`,
                });
                await params.onEvent({
                    type: 'code_execution_stdout',
                    executionId: execution.id,
                    chunk: parsed.chunk,
                });
                continue;
            }

            if (parsed.type === 'stderr' && typeof parsed.chunk === 'string') {
                execution = mergeExecution(execution, {
                    status: 'running',
                    stderr: `${execution.stderr || ''}${parsed.chunk}`,
                });
                await params.onEvent({
                    type: 'code_execution_stderr',
                    executionId: execution.id,
                    chunk: parsed.chunk,
                });
                continue;
            }

            if (parsed.type === 'result' && typeof parsed.chunk === 'string') {
                execution = mergeExecution(execution, {
                    status: 'running',
                    output: `${execution.output || ''}${parsed.chunk}`,
                });
                continue;
            }

            if (parsed.type === 'finished') {
                execution = mergeExecution(
                    execution,
                    coerceExecution(parsed.execution, {
                        id: execution.id,
                        toolCallId: params.toolCallId,
                        language: params.language,
                        code: params.code,
                    })
                );
                await params.onEvent({ type: 'code_execution_finished', execution });
                return execution;
            }

            if (parsed.type === 'error') {
                execution = mergeExecution(execution, {
                    status: 'error',
                    error: formatExecutionError(parsed.error) || 'Code execution failed.',
                });
                await params.onEvent({ type: 'code_execution_finished', execution });
                return execution;
            }
        }
    }

    return execution;
}
