import { z, ZodTypeAny, ZodError } from 'zod';
import { NextResponse } from 'next/server';

// ─── Parse Helper ─────────────────────────────────────────────────────────────

/**
 * Parse and validate a request body against a Zod schema.
 * Returns the validated data or a 400 NextResponse with error details.
 */
export async function parseBody<S extends ZodTypeAny>(
    request: Request,
    schema: S
): Promise<{ data: z.output<S>; error: null } | { data: null; error: NextResponse }> {
    let raw: unknown;
    try {
        raw = await request.json();
    } catch {
        return {
            data: null,
            error: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }),
        };
    }

    const result = schema.safeParse(raw);
    if (!result.success) {
        const issues = (result.error as ZodError).issues
            .map(i => `${i.path.join('.')}: ${i.message}`)
            .join('; ');
        return {
            data: null,
            error: NextResponse.json({ error: `Validation failed: ${issues}` }, { status: 400 }),
        };
    }

    return { data: result.data as z.output<S>, error: null };
}

// ─── Shared field schemas ─────────────────────────────────────────────────────

// Normalize to lowercase so the server (the real trust boundary) treats
// `Alex@x.com` and `alex@x.com` as the same account. Postgres' unique index on
// User.email is case-sensitive, so without this, register/login/forgot-password
// could silently split one person across duplicate rows.
export const emailSchema = z
    .string()
    .trim()
    .toLowerCase()
    .email('Invalid email address')
    .max(254);

// Password policy follows NIST SP 800-63B: length + a breached/common-password
// blocklist beat composition rules (which push users toward "Password1!").
// This is the top slice of every breach corpus's leaderboard, normalized to
// lowercase for the comparison.
const COMMON_PASSWORDS = new Set([
    'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
    'qwerty123', 'qwertyuiop', '11111111', '00000000', 'iloveyou', 'sunshine',
    'princess', 'football', 'baseball', 'superman', 'trustno1', 'welcome1',
    'admin123', 'letmein1', 'dragon123', 'monkey123', 'abc12345', 'passw0rd',
    'p@ssw0rd', 'qwerty12', '12341234', '87654321', 'asdfghjkl', 'zxcvbnm1',
]);

export const passwordSchema = z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long')
    .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), {
        message: 'That password is too common — pick something less guessable',
    });

export const promptSchema = z
    .string()
    .trim()
    .min(1, 'Prompt is required')
    .max(2000, 'Prompt too long (max 2000 characters)');

export const modelIdSchema = z
    .string()
    .trim()
    .max(100, 'Model ID too long')
    .default('suzhou-3');

const VALID_ROLES = ['user', 'assistant', 'system', 'data'] as const;
const VALID_MODES = [
    'think', 'deep-research', 'web-search', 'study', 'code',
    'creative', 'summarize', 'eli5', 'brainstorm', 'roleplay',
    'debate', 'translate', 'fact-check', 'freestyle',
] as const;
const VALID_TONES = ['formal', 'concise', 'detailed', 'minimal'] as const;

// ─── Route-specific schemas ───────────────────────────────────────────────────

export const loginSchema = z.object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required').max(128),
});

export const registerSchema = z.object({
    email: emailSchema,
    password: passwordSchema,
    name: z.string().trim().max(100).optional(),
});

export const forgotPasswordSchema = z.object({
    email: emailSchema,
});

export const resetPasswordSchema = z.object({
    token: z.string().min(1, 'Token is required').max(256),
    password: passwordSchema,
});

export const chatSchema = z.object({
    messages: z
        .array(
            z.object({
                role: z.enum(VALID_ROLES),
                content: z.string().max(100_000, 'Message content too long'),
            })
        )
        .min(1, 'At least one message is required')
        .max(200, 'Too many messages'),
    model: modelIdSchema,
    extendedThinking: z.boolean().default(false),
    tone: z.string().max(50).optional(),
    activeModes: z.array(z.enum(VALID_MODES)).max(10).default([]),
    activeTone: z.enum(VALID_TONES).nullable().default(null),
    anura: z.boolean().default(false),
    imageDescription: z.string().max(5000).optional(),
    conversationId: z.string().uuid().optional(),
    isHivemind: z.boolean().default(false),
    systemPromptOverride: z.string().max(10_000).optional(),
    autoSkillSetting: z.enum(['off', 'ask', 'auto']).default('off'),
});

export const executeSchema = z.object({
    code: z.string().min(1, 'Code is required').max(50_000, 'Code too long'),
    stdin: z.string().max(10_000).optional(),
});

export const planSchema = z.object({
    prompt: promptSchema,
    modelId: modelIdSchema,
});

export const chatTitleSchema = z.object({
    message: z.string().min(1, 'Message is required').max(10_000),
    conversationId: z.string().uuid().optional(),
});

// ─── Conversation cloud sync (Sonoma chat) ────────────────────────────────────

const syncMessageSchema = z.object({
    id: z.string().min(1).max(64).regex(/^[\w.-]+$/, 'Invalid message id').optional(),
    role: z.enum(['user', 'assistant']),
    content: z.string().max(200_000),
    timestamp: z.union([z.string(), z.number(), z.date()]).optional(),
    model: z.string().max(64).optional(),
    // Display metadata (file chips, sandbox run badges) — re-validated by
    // parseMessageMetadata on read, so structurally loose here.
    attachments: z.array(z.unknown()).max(20).optional(),
    codeExecutions: z.array(z.unknown()).max(50).optional(),
});

export const conversationSyncSchema = z.object({
    conversations: z
        .array(
            z.object({
                id: z.string().uuid('Conversation id must be a UUID'),
                title: z.string().max(200).optional(),
                model: z.string().max(64).optional(),
                createdAt: z.union([z.string(), z.number(), z.date()]).optional(),
                messages: z.array(syncMessageSchema).min(1).max(400),
            }),
        )
        .min(1)
        .max(10),
});

export const conversationDeleteSchema = z.object({
    id: z.string().uuid('Conversation id must be a UUID'),
});

// Re-export ZodError for convenience
export { ZodError };
