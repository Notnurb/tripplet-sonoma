import { env } from '@/lib/env';

const BACKEND_API_KEY = env.BACKEND_API_KEY || '';

export async function backendFetch(
    path: string,
    init: RequestInit = {},
): Promise<Response> {
    const headers: Record<string, string> = {
        ...(init.headers as Record<string, string> | undefined),
    };
    if (BACKEND_API_KEY) {
        headers['Authorization'] = `Bearer ${BACKEND_API_KEY}`;
    }
    if (!headers['Content-Type'] && typeof init.body === 'string') {
        headers['Content-Type'] = 'application/json';
    }
    return fetch(`${env.BACKEND_URL}${path}`, { ...init, headers });
}
