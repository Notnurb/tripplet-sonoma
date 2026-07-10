import { lookup } from 'node:dns/promises';
import { backendFetch } from '@/lib/backend';

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

export async function webSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
    const q = query.slice(0, 500);
    const max = Math.min(Math.max(maxResults, 1), 8);

    // Prefer the external backend when configured; otherwise (or on failure)
    // fall back to keyless DuckDuckGo scraping so search works with no
    // external service at all.
    if (process.env.BACKEND_URL) {
        try {
            return await backendSearch(q, max);
        } catch {
            /* fall through to DuckDuckGo */
        }
    }
    return duckDuckGoSearch(q, max);
}

async function backendSearch(query: string, maxResults: number): Promise<SearchResult[]> {
    const resp = await backendFetch('/search/combined', {
        method: 'POST',
        body: JSON.stringify({ query, num_results: maxResults }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
        throw new Error(`Search service responded ${resp.status}`);
    }
    const data = await resp.json() as {
        results?: Array<{ title?: string; url?: string; highlights?: string[]; raw_content?: string }>;
    };
    return (data.results || [])
        .filter((r): r is typeof r & { url: string } => Boolean(r.url))
        .map((r) => ({
            title: r.title || r.url,
            url: r.url,
            snippet: (r.highlights?.join(' ') || r.raw_content || '').slice(0, 700),
        }));
}

// ─── DuckDuckGo HTML search (no API key) ─────────────────────────────────────
//
// Scrapes html.duckduckgo.com — the JS-free interface DDG serves to simple
// clients. Markup is stable: each organic result is an <a class="result__a">
// (title + redirect href) paired with a .result__snippet. Result hrefs are
// DDG redirect links carrying the real URL in the `uddg` query param.

function stripTags(html: string): string {
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&(nbsp|#160);/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

// Exported for unit tests.
export function decodeResultUrl(href: string): string | null {
    try {
        // "//duckduckgo.com/l/?uddg=<encoded-url>&rut=..." → the real URL.
        const u = new URL(href, 'https://duckduckgo.com');
        const uddg = u.searchParams.get('uddg');
        const real = uddg ?? (u.hostname.endsWith('duckduckgo.com') ? null : u.toString());
        if (!real) return null;
        const parsed = new URL(real);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        return parsed.toString();
    } catch {
        return null;
    }
}

async function duckDuckGoSearch(query: string, maxResults: number): Promise<SearchResult[]> {
    const resp = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        {
            headers: {
                // DDG answers bot-ish UAs with an empty 202 challenge; a plain
                // browser UA gets the real result page.
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                Accept: 'text/html',
            },
            signal: AbortSignal.timeout(10_000),
        },
    );
    if (!resp.ok) {
        throw new Error(`Search responded ${resp.status}`);
    }
    return parseDuckDuckGoHtml(await resp.text(), maxResults);
}

// Pure parser over the DDG result page — exported for unit tests.
export function parseDuckDuckGoHtml(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];
    // Title anchor and its snippet live in the same .result block; iterate
    // title anchors and grab the snippet that follows before the next result.
    const anchorRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRe = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/;
    let m: RegExpExecArray | null;
    while ((m = anchorRe.exec(html)) !== null && results.length < maxResults) {
        const url = decodeResultUrl(m[1]);
        if (!url) continue; // ads and internal DDG links
        const title = stripTags(m[2]);
        if (!title) continue;
        // Search for the snippet only within the chunk after this anchor
        // (up to a bounded window) so snippets pair with their own result.
        const tail = html.slice(anchorRe.lastIndex, anchorRe.lastIndex + 3000);
        const snip = snippetRe.exec(tail);
        results.push({
            title,
            url,
            snippet: (snip ? stripTags(snip[1]) : '').slice(0, 700),
        });
    }
    return results;
}

// Block requests to loopback/private/link-local hosts — the model picks these
// URLs from untrusted web content, so this fetch must never reach internal
// infrastructure.
function isPrivateIpv4(address: string): boolean {
    const m = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return true; // not a clean dotted quad → treat as unsafe
    const a = Number(m[1]);
    const b = Number(m[2]);
    return (
        a === 0 || a === 10 || a === 127 || a > 223 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
    );
}

function isPrivateIpv6(address: string): boolean {
    const a = address.toLowerCase();
    if (a === '::' || a === '::1') return true; // unspecified / loopback
    if (a.startsWith('fc') || a.startsWith('fd')) return true; // ULA fc00::/7
    // Link-local fe80::/10
    if (a.startsWith('fe8') || a.startsWith('fe9') || a.startsWith('fea') || a.startsWith('feb')) return true;
    const v4 = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // v4-mapped
    if (v4) return isPrivateIpv4(v4[1]);
    return false;
}

function isPrivateHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true;
    if (host.includes(':')) return true; // IPv6 literals — block outright
    // Hostnames with no letters are IP literals in some encoding (dotted quad,
    // decimal like 2130706433, hex like 0x7f000001, or partial forms like 127.1).
    // Real DNS names always contain a letter, so anything letterless that isn't
    // a public dotted quad gets blocked below.
    if (!/[a-z]/.test(host)) {
        return isPrivateIpv4(host);
    }
    return false;
}

async function assertFetchableUrl(url: URL): Promise<void> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Only http(s) URLs can be fetched.');
    }
    if (isPrivateHost(url.hostname)) {
        throw new Error('This host cannot be fetched.');
    }
    // DNS-rebinding guard: the string checks above can't see what a NAME
    // resolves to — a public-looking hostname with an A record pointing at
    // 10.0.0.5 would pass them. Resolve every address and re-check each one.
    // (Residual TOCTOU: fetch() re-resolves for the actual connect, so a DNS
    // answer that flips between this check and the socket open is still
    // possible; closing that fully requires socket-level IP pinning.)
    if (/[a-z]/.test(url.hostname.toLowerCase())) {
        let addrs: Array<{ address: string; family: number }>;
        try {
            addrs = await lookup(url.hostname, { all: true, verbatim: true });
        } catch {
            // NXDOMAIN / resolver failure — the fetch could never succeed, and
            // proceeding unvalidated is not an option.
            throw new Error('This host cannot be fetched.');
        }
        if (addrs.length === 0) throw new Error('This host cannot be fetched.');
        for (const { address, family } of addrs) {
            const blocked = family === 6 ? isPrivateIpv6(address) : isPrivateIpv4(address);
            if (blocked) throw new Error('This host cannot be fetched.');
        }
    }
}

// Cap how much of a page body we read — the URL comes from untrusted web
// content, so an attacker-controlled page must not be able to balloon memory.
const MAX_BODY_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;

export async function fetchPageText(url: string, maxChars = 8000): Promise<string> {
    // Follow redirects manually so every hop is re-checked against the
    // private-host guard (a public URL 302-ing to an internal one is the
    // classic SSRF bypass).
    let target = new URL(url);
    let resp: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        await assertFetchableUrl(target);
        resp = await fetch(target.toString(), {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrippletBot/1.0)' },
            redirect: 'manual',
            signal: AbortSignal.timeout(10_000),
        });
        if (resp.status >= 300 && resp.status < 400) {
            const loc = resp.headers.get('location');
            if (!loc || hop === MAX_REDIRECTS) throw new Error('Too many redirects.');
            target = new URL(loc, target);
            continue;
        }
        break;
    }
    if (!resp || !resp.ok) {
        throw new Error(`Page fetch failed with status ${resp ? resp.status : 'unknown'}`);
    }

    let html = '';
    if (resp.body) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let bytes = 0;
        while (bytes < MAX_BODY_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            html += decoder.decode(value, { stream: true });
        }
        await reader.cancel().catch(() => undefined);
    }
    const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&(nbsp|#160);/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
    return text.slice(0, maxChars);
}
