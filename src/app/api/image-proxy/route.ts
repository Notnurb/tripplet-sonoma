import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';

export const runtime = 'nodejs';

// Only proxy images from these trusted domains
const ALLOWED_HOSTNAMES = new Set([
    'storage.googleapis.com',
    'images.unsplash.com',
    'cdn.openai.com',
    'oaidalleapiprodscus.blob.core.windows.net',
]);

const PRIVATE_IP_PATTERNS = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^::1$/,
    /^fc00:/i,
    /^fe80:/i,
];

function isPrivateHost(hostname: string): boolean {
    return PRIVATE_IP_PATTERNS.some(pattern => pattern.test(hostname));
}

export async function GET(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return new NextResponse('Authentication required', { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const url = searchParams.get('url');

    if (!url) {
        return new NextResponse('Missing url parameter', { status: 400 });
    }

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return new NextResponse('Invalid URL', { status: 400 });
    }

    // Only allow https
    if (parsed.protocol !== 'https:') {
        return new NextResponse('Only HTTPS URLs are allowed', { status: 400 });
    }

    // Block private/internal IPs
    if (isPrivateHost(parsed.hostname)) {
        return new NextResponse('URL not allowed', { status: 403 });
    }

    // Whitelist allowed hostnames
    if (!ALLOWED_HOSTNAMES.has(parsed.hostname)) {
        return new NextResponse('URL not allowed', { status: 403 });
    }

    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(10_000),
            redirect: 'error',
        });

        if (!response.ok) {
            return new NextResponse('Failed to fetch image', { status: response.status });
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) {
            return new NextResponse('URL is not an image', { status: 400 });
        }

        // Limit response size to 20 MB
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > 20 * 1024 * 1024) {
            return new NextResponse('Image too large', { status: 413 });
        }

        const blob = await response.blob();

        return new NextResponse(blob, {
            status: 200,
            headers: {
                'Cache-Control': 'public, max-age=31536000, immutable',
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'null',
            },
        });
    } catch (error: unknown) {
        if (error instanceof Error && error.name === 'TimeoutError') {
            return new NextResponse('Request timed out', { status: 504 });
        }
        return new NextResponse('Proxy error', { status: 500 });
    }
}
