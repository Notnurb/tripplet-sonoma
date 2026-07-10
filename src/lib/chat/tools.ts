// Tool definitions for the legacy /api/chat path: the sandboxed run_code tool
// and the long-term-memory CRUD tools, plus the system-prompt section that
// teaches the model when/how to use run_code. Extracted from the route so the
// handler holds request flow, not schema literals.

import { ChatToolDefinition } from '@/lib/ai/chat-client';

export const RUN_CODE_TOOL: ChatToolDefinition = {
    type: 'function',
    function: {
        name: 'run_code',
        description: 'Execute Python or Bash in an isolated sandbox for this conversation and return real stdout/stderr/output.',
        parameters: {
            type: 'object',
            properties: {
                language: {
                    type: 'string',
                    enum: ['python', 'bash'],
                    description: 'Which interpreter to use.',
                },
                code: {
                    type: 'string',
                    description: 'Executable code only. Do not wrap it in markdown fences.',
                },
            },
            required: ['language', 'code'],
            additionalProperties: false,
        },
    },
};

export const REMEMBER_TOOL: ChatToolDefinition = {
    type: 'function',
    function: {
        name: 'remember_fact',
        description:
            'Persist a durable fact about the user to long-term memory. Only call this when the user has shared something that should be remembered across future conversations (preferences, goals, important context). Keep each fact short and self-contained.',
        parameters: {
            type: 'object',
            properties: {
                fact: {
                    type: 'string',
                    description: 'A single short fact about the user, written in third person (e.g. "User prefers TypeScript over JavaScript").',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional short tags categorizing the fact (e.g. ["preferences"], ["work"], ["project:tripplet"]).',
                },
            },
            required: ['fact'],
            additionalProperties: false,
        },
    },
};

export const FORGET_TOOL: ChatToolDefinition = {
    type: 'function',
    function: {
        name: 'forget_fact',
        description:
            'Remove a previously stored memory by its id. Use only when the user explicitly asks to forget something, OR when a memory is now factually wrong (e.g. the user updated their preference and the old version is stale).',
        parameters: {
            type: 'object',
            properties: {
                memory_id: { type: 'string', description: 'The id of the memory entry to delete (from the # Memorys # block).' },
            },
            required: ['memory_id'],
            additionalProperties: false,
        },
    },
};

export const UPDATE_TOOL: ChatToolDefinition = {
    type: 'function',
    function: {
        name: 'update_fact',
        description:
            "Revise an existing memory in place. Use this — instead of forget_fact + remember_fact — whenever a previously saved fact about the user needs to change (e.g. they switched jobs, changed their goal, refined a preference). Keeps history clean and avoids duplicates.",
        parameters: {
            type: 'object',
            properties: {
                memory_id: { type: 'string', description: 'The id of the memory to update (from the # Memorys # block).' },
                fact: { type: 'string', description: 'The new, corrected fact text. Third person, single self-contained statement.' },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional tags. If omitted, existing tags are kept.',
                },
            },
            required: ['memory_id', 'fact'],
            additionalProperties: false,
        },
    },
};

export function buildCodeExecutionToolInstructions(): string {
    return `## Code Execution Tool (Active)
You have access to a \`run_code\` tool that executes Python or Bash inside an isolated sandbox that persists for this chat session.

Use it when real execution matters:
- verifying runtime behavior
- checking stdout/stderr
- debugging code that may fail at runtime
- running shell commands safely in the sandbox
- computing results you should not guess

Rules:
- Use \`python\` for Python and \`bash\` for shell commands.
- Pass only raw executable code to the tool. No markdown fences.
- After using the tool, include the exact executed code in a fenced code block with the matching language tag.
- Then summarize the outcome briefly and mention key stdout/stderr or errors.
- If execution fails, be transparent about the failure and explain the likely cause.`;
}
