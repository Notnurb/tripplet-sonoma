import { NextRequest, NextResponse } from 'next/server';
import { authenticateDeveloperApiKey } from '@/lib/developer-api/auth';
import { PUBLIC_API_MODELS } from '@/lib/developer-api/catalog';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
    const auth = await authenticateDeveloperApiKey(request);
    if ('response' in auth) return auth.response;

    return NextResponse.json({
        object: 'list',
        data: PUBLIC_API_MODELS.map((model) => ({
            id: model.id,
            object: 'model',
            created: 0,
            owned_by: 'tripplet',
            name: model.name,
            family: model.family,
            context_window: model.context,
            description: model.description,
        })),
    }, {
        // The catalog is identical for every valid key and changes only on
        // deploy — `private` because the endpoint is key-authenticated, so
        // shared caches must not store it; the client may reuse it for an hour.
        headers: { 'Cache-Control': 'private, max-age=3600' },
    });
}
