import { NextRequest, NextResponse } from 'next/server';
import { authenticateDeveloperApiKey } from '@/lib/developer-api/auth';
import { getPublicApiModel } from '@/lib/developer-api/catalog';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
    const auth = await authenticateDeveloperApiKey(request);
    if ('response' in auth) return auth.response;

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
        return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const modelId = typeof body.model === 'string' ? body.model : '';
    const model = getPublicApiModel(modelId);
    if (!model) {
        return NextResponse.json({ error: `Unsupported model "${modelId}".` }, { status: 400 });
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return NextResponse.json({ error: 'messages must be a non-empty array.' }, { status: 400 });
    }

    return NextResponse.json({ error: 'External AI APIs have been disabled.' }, { status: 503 });
}
