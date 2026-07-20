import { NextRequest, NextResponse } from 'next/server';
import { titleLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';
import { auth } from '@/lib/auth/session';
import {
    LLM_API_URL, LLM_API_KEY, LLM_DEFAULT_MODEL,
    OPENCODE_ZEN_API_URL, OPENCODE_ZEN_API_KEY,
} from '@/lib/ai/llm';
import { parseBody, chatTitleSchema } from '@/lib/validation';

// Conversation naming runs on big-pickle (OpenCode Zen) — fast and cheap, and
// the same model that powers the Memory skill's fact extraction. Groq remains
// the fallback when no Zen key is configured.
const TITLE_MODEL = process.env.TITLE_MODEL || 'big-pickle';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
    try {
        const { userId } = await auth();
        const token = getRateLimitToken(request, userId);

        try {
            await titleLimiter.check(LIMITS.title, token);
        } catch {
            return rateLimitResponse();
        }

        const { data, error: validationError } = await parseBody(request, chatTitleSchema);
        if (validationError) return validationError;
        const { message, reply } = data;

        const useZen = !!OPENCODE_ZEN_API_KEY;
        const response = await fetch(useZen ? OPENCODE_ZEN_API_URL : LLM_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${useZen ? OPENCODE_ZEN_API_KEY : LLM_API_KEY}`,
            },
            body: JSON.stringify({
                messages: [
                    {
                        role: 'system',
                        content: 'Name this conversation based on what it is actually about. Return a short title (3-6 words), plain text only — no quotes, labels, or punctuation at the end.'
                    },
                    {
                        role: 'user',
                        content:
                            `User's message:\n${message.slice(0, 500)}` +
                            (reply ? `\n\nAssistant's reply (excerpt):\n${reply.slice(0, 500)}` : ''),
                    }
                ],
                model: useZen ? TITLE_MODEL : LLM_DEFAULT_MODEL,
                stream: false,
                temperature: 0.5,
                max_tokens: 15,
            }),
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            return NextResponse.json({ title: 'New Chat' }, { status: 200 });
        }

        const responseJson = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        const raw = responseJson.choices?.[0]?.message?.content?.trim() || 'New Chat';
        const title = raw.replace(/^["']|["']$/g, '');

        return NextResponse.json({ title });
    } catch {
        return NextResponse.json({ title: 'New Chat' }, { status: 200 });
    }
}
