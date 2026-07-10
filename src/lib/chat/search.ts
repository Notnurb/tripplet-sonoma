// Web-search injection for the legacy /api/chat path: fetches combined search
// results from the external backend, sanitizes them, and wraps them in the
// nonce-keyed untrusted-content boundary before they enter the system prompt.
// Fail-open: any failure returns { failed: true } and chat proceeds without
// search context. Extracted from the route handler.

import { sanitizeExternalContent } from '@/lib/security/sanitize';
import { wrapUntrusted } from '@/lib/security/prompt-guardrails';
import { env } from '@/lib/env';
import { backendFetch } from '@/lib/backend';

export async function fetchWebSearchResults(query: string): Promise<{ text: string; count: number; failed: boolean }> {
    if (!env.BACKEND_URL) return { text: '', count: 0, failed: true };
    try {
        const resp = await backendFetch('/search/combined', {
            method: 'POST',
            body: JSON.stringify({ query: query.slice(0, 500), num_results: 8 }),
            signal: AbortSignal.timeout(8000),
        });

        if (!resp.ok) {
            console.error(`[chat] web search backend responded ${resp.status}`);
            return { text: '', count: 0, failed: true };
        }

        const data = await resp.json() as { results?: Array<{ highlights?: string[]; raw_content?: string; source?: string; title: string; url: string }> };
        const results = data.results || [];
        const count = results.length;
        if (count === 0) return { text: '', count: 0, failed: false };

        const formatted = results.map((r, i) => {
            // Sanitize web content before embedding in system prompt
            const highlights = sanitizeExternalContent(
                r.highlights?.join(' ') || r.raw_content?.slice(0, 700) || ''
            );
            const source = r.source ? `[${r.source}] ` : '';
            return `[${i + 1}] ${source}${r.title}\n    URL: ${r.url}\n    ${highlights}`;
        }).join('\n\n');

        // Wrap search results in a structured block that explicitly marks this content as
        // external, untrusted data. This reduces prompt injection risk from malicious web
        // pages embedding instruction-like text in their content or metadata.
        return {
            text: `\n${wrapUntrusted(`Live web search results for query: "${query}"\n\n${formatted}`, 'live web search results')}\n`,
            count,
            failed: false
        };
    } catch (e) {
        console.error('[chat] web search failed:', e instanceof Error ? e.message : e);
        return { text: '', count: 0, failed: true };
    }
}
