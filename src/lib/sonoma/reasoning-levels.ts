// Reasoning levels for the DeepCode pipeline. Kept in its own client-safe
// module (no server-only imports) so both the API route/pipeline and the
// composer UI can share one source of truth.

export const DEEP_CODE_REASONING_LEVELS = [
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'supercode',
] as const;

export type DeepCodeReasoningLevel = (typeof DEEP_CODE_REASONING_LEVELS)[number];

export const DEEP_CODE_DEFAULT_REASONING_LEVEL: DeepCodeReasoningLevel = 'high';

export const DEEP_CODE_REASONING_LEVEL_LABELS: Record<DeepCodeReasoningLevel, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'XHigh',
    max: 'Max',
    supercode: 'Supercode',
};

export function isReasoningLevel(v: unknown): v is DeepCodeReasoningLevel {
    return typeof v === 'string' && (DEEP_CODE_REASONING_LEVELS as readonly string[]).includes(v);
}
