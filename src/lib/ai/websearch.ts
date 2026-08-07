import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage, RequestOptions } from 'node:http';
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
    // Keyless, best-effort search. DDG serves two JS-free interfaces and either
    // can soft-fail — a hard 403 when the caller's IP is blocked (common from
    // datacenter hosts), or a 202/200 bot-challenge page with no results. Try
    // both endpoints and only give up if neither yields anything, so one
    // blocked interface doesn't sink the whole search.
    const engines: Array<{ url: string; parse: (html: string, n: number) => SearchResult[] }> = [
        { url: 'https://html.duckduckgo.com/html/', parse: parseDuckDuckGoHtml },
        { url: 'https://lite.duckduckgo.com/lite/', parse: parseDuckDuckGoLite },
    ];
    let lastError: Error | null = null;
    for (const engine of engines) {
        try {
            const results = await ddgFetch(engine.url, query, engine.parse, maxResults);
            if (results.length > 0) return results;
            // A 2xx with nothing parseable is the bot-challenge/anomaly page,
            // not a genuine "no results" — treat it as a soft failure so the
            // caller sees an error (and the model falls back to its knowledge)
            // instead of a silently empty result set.
            lastError = new Error('Search responded with a challenge page (no results)');
        } catch (e) {
            lastError = e instanceof Error ? e : new Error('search failed');
        }
    }
    throw lastError ?? new Error('search failed');
}

async function ddgFetch(
    endpoint: string,
    query: string,
    parse: (html: string, maxResults: number) => SearchResult[],
    maxResults: number,
): Promise<SearchResult[]> {
    const resp = await fetch(endpoint, {
        // POST with a form body is exactly what the DDG search form submits —
        // marginally more block-resistant than the equivalent GET query string.
        method: 'POST',
        headers: {
            // DDG answers bot-ish UAs with an empty challenge; a plain browser
            // UA (plus a normal Accept-Language) gets the real result page.
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            Accept: 'text/html',
            'Accept-Language': 'en-US,en;q=0.9',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `q=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
        throw new Error(`Search responded ${resp.status}`);
    }
    return parse(await resp.text(), maxResults);
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

// Pure parser over the DDG *lite* result page — exported for unit tests. Lite
// markup differs from the html interface: result anchors carry class
// "result-link" (attribute order varies, so match the tag then pull href out),
// and each snippet lives in a following <td class="result-snippet">.
export function parseDuckDuckGoLite(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];
    const anchorRe = /<a\b([^>]*result-link[^>]*)>([\s\S]*?)<\/a>/gi;
    const hrefRe = /href=["']([^"']+)["']/i;
    const snippetRe = /result-snippet[^>]*>([\s\S]*?)<\/td>/i;
    let m: RegExpExecArray | null;
    while ((m = anchorRe.exec(html)) !== null && results.length < maxResults) {
        const href = hrefRe.exec(m[1]);
        if (!href) continue;
        const url = decodeResultUrl(href[1]);
        if (!url) continue; // ads and internal DDG links
        const title = stripTags(m[2]);
        if (!title) continue;
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

export type ResolvedAddress = { address: string; family: number };

// Resolve a URL's hostname and reject it if ANY answer is a private/loopback/
// link-local address. Returns the validated addresses so the caller can pin
// the connect to them (see fetchPinnedPage) — otherwise the DNS lookups here
// and the one fetch() does internally are separate, which is the DNS-rebinding
// TOCTOU window.
async function resolvePublicAddresses(url: URL): Promise<ResolvedAddress[]> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Only http(s) URLs can be fetched.');
    }
    if (isPrivateHost(url.hostname)) {
        throw new Error('This host cannot be fetched.');
    }
    if (!/[a-z]/.test(url.hostname.toLowerCase())) {
        // Letterless host = an IPv4 literal (IPv6 literals are blocked above by
        // isPrivateHost). It connects to the literal itself — no DNS involved,
        // so no rebinding window. Return it so the pinned connect uses it.
        return [{ address: url.hostname, family: 4 }];
    }
    let addrs: ResolvedAddress[];
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
    return addrs;
}

export async function assertFetchableUrl(url: URL): Promise<void> {
    await resolvePublicAddresses(url);
}

// Cap how much of a page body we read — the URL comes from untrusted web
// content, so an attacker-controlled page must not be able to balloon memory.
const MAX_BODY_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;

export interface PinnedPage {
    status: number;
    headers: IncomingHttpHeaders;
    body: string;
}

// Fetch a URL by connecting DIRECTLY to an address that passed the SSRF guard.
// The hostname is only sent in the Host header / TLS SNI, so the socket
// address is fixed at resolution time: a DNS answer that flips between the
// guard and the connect can no longer redirect the request to a private host.
// This closes the DNS-rebinding TOCTOU that plain fetch() (which re-resolves
// for the connect) is subject to.
export async function fetchPinnedPage(
    target: URL,
    opts: { maxBytes: number; timeoutMs?: number; headers?: Record<string, string> },
): Promise<PinnedPage> {
    const addresses = await resolvePublicAddresses(target);
    const connectAddress = addresses[0];
    const isTls = target.protocol === 'https:';
    const requestFn = isTls ? httpsRequest : httpRequest;

    const baseOptions: RequestOptions = {
        host: connectAddress.address,
        port: target.port ? Number(target.port) : isTls ? 443 : 80,
        path: target.pathname + target.search,
        headers: {
            Host: target.host,
            'User-Agent': 'Mozilla/5.0 (compatible; TrippletBot/1.0)',
            ...opts.headers,
        },
        timeout: opts.timeoutMs ?? 10_000,
    };

    const handleResponse = (res: IncomingMessage, req: ReturnType<typeof httpsRequest>): void => {
        let body = '';
        let bytes = 0;
        res.on('data', (chunk: Buffer | string) => {
            bytes += Buffer.byteLength(chunk);
            if (bytes > opts.maxBytes) {
                req.destroy(new Error('Response too large.'));
                return;
            }
            body += chunk;
        });
        res.on('error', (err: Error) => req.destroy(err));
        res.on('end', () => {
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
    };

    return new Promise<PinnedPage>((resolve, reject) => {
        let req: ReturnType<typeof httpsRequest>;
        if (isTls) {
            req = httpsRequest(
                { ...baseOptions, servername: target.hostname, rejectUnauthorized: true },
                (res) => handleResponse(res, req),
            );
        } else {
            req = httpRequest(baseOptions as RequestOptions, (res) => handleResponse(res, req));
        }
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Request timed out.')));
        req.end();
    });
}

export async function fetchPageText(url: string, maxChars = 8000): Promise<string> {
    // Follow redirects manually so every hop is re-checked against the
    // private-host guard (a public URL 302-ing to an internal one is the
    // classic SSRF bypass).
    let target = new URL(url);
    let html = '';
    let status = 0;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const resp = await fetchPinnedPage(target, { maxBytes: MAX_BODY_BYTES, timeoutMs: 10_000 });
        if (resp.status >= 300 && resp.status < 400) {
            const locRaw = resp.headers.location;
            const loc = Array.isArray(locRaw) ? locRaw[0] : locRaw;
            if (!loc || hop === MAX_REDIRECTS) throw new Error('Too many redirects.');
            target = new URL(loc, target);
            continue;
        }
        if (resp.status >= 200 && resp.status < 300) {
            html = resp.body;
            status = resp.status;
            break;
        }
        throw new Error(`Page fetch failed with status ${resp.status}`);
    }
    if (status < 200 || status >= 300) {
        throw new Error(`Page fetch failed with status ${status || 'unknown'}`);
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
