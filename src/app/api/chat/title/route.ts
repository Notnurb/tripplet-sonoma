import { NextRequest, NextResponse } from 'next/server';
import { titleLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';
import { auth } from '@/lib/auth/session';
import { LLM_API_URL, LLM_API_KEY, LLM_DEFAULT_MODEL } from '@/lib/ai/llm';
import { parseBody, chatTitleSchema } from '@/lib/validation';

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
        const { message } = data;

        const response = await fetch(LLM_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LLM_API_KEY}`,
            },
            body: JSON.stringify({
                messages: [
                    {
                        role: 'system',
                        content: 'Generate a short, concise title (3-6 words) for a conversation starting with the user\'s message. Return only the plain text title with no quotes or labels.'
                    },
                    {
                        role: 'user',
                        content: message.slice(0, 500), // cap input length
                    }
                ],
                model: LLM_DEFAULT_MODEL,
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
