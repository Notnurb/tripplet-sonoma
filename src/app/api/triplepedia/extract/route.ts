import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import { searchLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';
import { fetchPinnedPage } from '@/lib/ai/websearch';

function validateExternalUrl(raw: string): URL | null {
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return null;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed;
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

// The URL is user-supplied, so this fetch must never reach internal
// infrastructure: the pinned fetch resolves + validates every address of every
// hop (including each redirect target) and connects directly to the validated
// IP, closing the DNS-rebinding TOCTOU of a plain fetch(). Redirects are
// followed manually so a public URL 302-ing to an internal host is caught
// before the connect.
async function fetchBounded(input: string, headers: Record<string, string>, maxBytes = MAX_RESPONSE_BYTES) {
    let target = new URL(input);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const res = await fetchPinnedPage(target, { maxBytes, timeoutMs: 10_000, headers });
        if (res.status >= 300 && res.status < 400) {
            const locRaw = res.headers.location;
            const loc = Array.isArray(locRaw) ? locRaw[0] : locRaw;
            if (!loc || hop === MAX_REDIRECTS) throw new Error('Too many redirects.');
            target = new URL(loc, target);
            continue;
        }
        return {
            res: new Response(res.body, { status: res.status, headers: res.headers as HeadersInit }),
            text: res.body,
        };
    }
    throw new Error('Too many redirects.');
}

interface ExtractedArticle {
    title: string;
    summary: string;
    sections: Array<{ heading: string; content: string }>;
    infobox: Array<{ label: string; value: string }>;
    references: Array<{ text: string; url?: string }>;
    imageUrl: string | null;
    sourceUrl: string;
    sourceLabel: string;
    license: string;
    attribution: string;
}

function extractWikipediaTitleFromUrl(rawUrl: string): string | null {
    try {
        const url = new URL(rawUrl);
        if (!url.hostname.endsWith('wikipedia.org')) return null;

        if (url.pathname.startsWith('/wiki/')) {
            const title = url.pathname.replace('/wiki/', '');
            return title ? decodeURIComponent(title) : null;
        }

        if (url.pathname === '/w/index.php') {
            const title = url.searchParams.get('title');
            return title ? decodeURIComponent(title) : null;
        }

        return null;
    } catch {
        return null;
    }
}

// ── HTML stripping ────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
    return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')   // remove citation superscripts
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&#\d+;/g, '')
        .trim();
}

// ── Nested-table-aware table content extractor ────────────────────────────────
// Regex alone can't handle nested <table>s, so we track depth manually.

function extractTableContent(html: string): string | null {
    // Match any infobox-class table
    const startRe = /<table[^>]*class="[^"]*infobox[^"]*"[^>]*>/i;
    const startMatch = startRe.exec(html);
    if (!startMatch) return null;

    let pos = startMatch.index + startMatch[0].length;
    let depth = 1;

    while (pos < html.length && depth > 0) {
        const openIdx = html.indexOf('<table', pos);
        const closeIdx = html.indexOf('</table>', pos);

        if (closeIdx === -1) break;

        if (openIdx !== -1 && openIdx < closeIdx) {
            depth++;
            pos = openIdx + 6;
        } else {
            depth--;
            if (depth === 0) {
                return html.slice(startMatch.index + startMatch[0].length, closeIdx);
            }
            pos = closeIdx + 8;
        }
    }
    return null;
}

// ── Infobox extraction ────────────────────────────────────────────────────────

function extractInfobox(html: string): Array<{ label: string; value: string }> {
    const tableInner = extractTableContent(html);
    if (!tableInner) return [];

    const rows: Array<{ label: string; value: string }> = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowRegex.exec(tableInner)) !== null) {
        const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
        if (cells.length < 2) continue;

        const label = stripHtml(cells[0][1]).trim();
        if (!label || label.length > 120) continue;

        // For value cells: expand list items into comma-separated text
        const valueHtml = cells[cells.length - 1][1];
        const listItems = [...valueHtml.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
        const value = listItems.length > 0
            ? listItems.map(li => stripHtml(li[1]).trim()).filter(Boolean).join(', ')
            : stripHtml(valueHtml).trim();

        if (value && value.length > 0) {
            rows.push({ label, value });
        }
    }

    // Deduplicate by label (keep last occurrence — typically more complete)
    const seen = new Map<string, string>();
    for (const row of rows) seen.set(row.label, row.value);
    return [...seen.entries()].map(([label, value]) => ({ label, value }));
}

// ── Paragraph extraction from section HTML ────────────────────────────────────

function extractParagraphs(html: string): string {
    const paragraphs: string[] = [];
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let m: RegExpExecArray | null;
    while ((m = pRegex.exec(html)) !== null) {
        const text = stripHtml(m[1]).trim();
        if (text.length > 0) paragraphs.push(text);
    }
    return paragraphs.join('\n\n');
}

// ── Sections extraction from Wikipedia mobile-sections ────────────────────────

const SKIP_SECTIONS = new Set([
    'references', 'see also', 'external links', 'notes',
    'further reading', 'footnotes', 'bibliography',
]);

function extractSections(
    sections: Array<{ title?: string; text?: string; depth?: number }>
): Array<{ heading: string; content: string }> {
    const result: Array<{ heading: string; content: string }> = [];

    for (const s of sections) {
        const heading = s.title?.trim();
        if (!heading || SKIP_SECTIONS.has(heading.toLowerCase())) continue;

        const content = extractParagraphs(s.text ?? '');
        if (content.length > 0) result.push({ heading, content });
    }

    return result;
}

// ── References extraction ─────────────────────────────────────────────────────

async function fetchReferences(
    encoded: string
): Promise<Array<{ text: string; url?: string }>> {
    try {
        const res = await fetch(
            `https://en.wikipedia.org/api/rest_v1/page/references/${encoded}`,
            { headers: { 'User-Agent': 'Triplepedia/1.0 (https://tripplet.ai; contact@tripplet.ai)' } }
        );
        if (!res.ok) return [];

        const data = await res.json();
        const refs: Array<{ text: string; url?: string }> = [];

        for (const entry of Object.values(data.references_by_id ?? {})) {
            const ref = entry as {
                content?: { html?: string };
                urls?: string[];
            };
            const text = stripHtml(ref.content?.html ?? '').trim();
            if (text.length < 5) continue;

            // Pull first URL found in the HTML as a convenience link
            const urlMatch = (ref.content?.html ?? '').match(/href="(https?:\/\/[^"]+)"/i);
            const url = urlMatch?.[1];

            refs.push({ text, ...(url ? { url } : {}) });
        }

        return refs;
    } catch {
        return [];
    }
}

// ── Wikipedia extractor ───────────────────────────────────────────────────────

async function extractWikipedia(title: string, _originalUrl: string): Promise<ExtractedArticle> {
    const encoded = encodeURIComponent(title.replace(/_/g, ' '));

    const summaryRes = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}?redirect=true`,
        {
            headers: { 'User-Agent': 'Triplepedia/1.0 (https://tripplet.ai; contact@tripplet.ai)' },
            signal: AbortSignal.timeout(10_000),
        }
    );

    if (!summaryRes.ok) {
        throw new Error(`Wikipedia article not found: "${title}"`);
    }

    const summary = await summaryRes.json();
    const resolvedTitle: string = summary.title ?? title;
    const resolvedEncoded = encodeURIComponent(resolvedTitle.replace(/_/g, ' '));

    const [sectionsRes, references] = await Promise.all([
        fetch(`https://en.wikipedia.org/api/rest_v1/page/mobile-sections/${resolvedEncoded}?redirect=true`, {
            headers: { 'User-Agent': 'Triplepedia/1.0 (https://tripplet.ai; contact@tripplet.ai)' },
            signal: AbortSignal.timeout(10_000),
        }),
        fetchReferences(resolvedEncoded),
    ]);

    const sectionsData = sectionsRes.ok ? await sectionsRes.json() : null;

    // Extract infobox from lead section HTML
    const leadHtml = sectionsData?.lead?.sections?.[0]?.text ?? '';
    const infobox = extractInfobox(leadHtml);

    // Lead intro paragraphs as the first "section"
    const leadContent = extractParagraphs(leadHtml);

    const rawSections: Array<{ heading: string; content: string }> = [];

    // Include a lead "Introduction" section if we got paragraphs from the lead
    // (the summary from the REST summary endpoint is usually shorter/cleaner though)
    if (sectionsData?.sections) {
        rawSections.push(...extractSections(sectionsData.sections));
    }

    // Always include lead HTML as an Introduction section if available
    if (leadContent.length > 0) {
        rawSections.unshift({ heading: 'Introduction', content: leadContent });
    }

    const imageUrl: string | null =
        summary.originalimage?.source ??
        summary.thumbnail?.source ??
        null;

    const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(resolvedTitle.replace(/ /g, '_'))}`;

    return {
        title: summary.title ?? resolvedTitle,
        summary: summary.extract ?? '',
        sections: rawSections,
        infobox,
        references,
        imageUrl,
        sourceUrl: wikiUrl,
        sourceLabel: 'Wikipedia',
        license: 'CC BY-SA 4.0',
        attribution: `This article uses content from Wikipedia (${wikiUrl}), available under the Creative Commons Attribution-ShareAlike 4.0 International License.`,
    };
}

// ── Generic URL extractor (best-effort) ──────────────────────────────────────

async function extractGeneric(url: string): Promise<ExtractedArticle> {
    const { res, text: html } = await fetchBounded(url, {
        'User-Agent': 'Mozilla/5.0 (compatible; Triplepedia/1.0)',
        'Accept': 'text/html',
    });

    if (!res.ok) throw new Error(`Could not fetch the page (HTTP ${res.status}).`);

    const titleMatch =
        html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ??
        html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descMatch =
        html.match(/<meta[^>]+(?:property="og:description"|name="description")[^>]+content="([^"]+)"/i);
    const imageMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);

    const rawTitle = titleMatch?.[1] ?? new URL(url).hostname;
    const rawDesc = descMatch?.[1] ?? '';

    // Extract h2 sections with all their paragraphs
    const sections: Array<{ heading: string; content: string }> = [];
    const h2Regex = /<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2|$)/gi;
    let hMatch: RegExpExecArray | null;
    while ((hMatch = h2Regex.exec(html)) !== null && sections.length < 20) {
        const heading = stripHtml(hMatch[1]).trim();
        const body = extractParagraphs(hMatch[2]);
        if (heading && body.length > 40) sections.push({ heading, content: body });
    }

    const hostname = new URL(url).hostname.replace('www.', '');

    return {
        title: stripHtml(rawTitle),
        summary: stripHtml(rawDesc),
        sections,
        infobox: [],
        references: [],
        imageUrl: imageMatch?.[1] ?? null,
        sourceUrl: url,
        sourceLabel: hostname,
        license: 'All rights reserved — verify permissions before publishing',
        attribution: `Source: ${url}`,
    };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const token = getRateLimitToken(req, userId);
    try {
        await searchLimiter.check(LIMITS.search, token);
    } catch {
        return rateLimitResponse();
    }

    let url: string;
    try {
        const body = await req.json();
        url = body.url?.trim();
        if (!url || typeof url !== 'string') {
            return NextResponse.json({ error: 'A valid URL is required.' }, { status: 400 });
        }
    } catch {
        return NextResponse.json({ error: 'A valid URL is required.' }, { status: 400 });
    }

    const parsed = validateExternalUrl(url);
    if (!parsed) {
        return NextResponse.json(
            { error: 'URL must be a public http(s) URL — internal hosts are not allowed.' },
            { status: 400 },
        );
    }

    try {
        let result: ExtractedArticle;

        const wikiTitle = extractWikipediaTitleFromUrl(parsed.toString());

        if (wikiTitle) {
            result = await extractWikipedia(wikiTitle, parsed.toString());
        } else {
            result = await extractGeneric(parsed.toString());
        }

        return NextResponse.json(result);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Extraction failed.';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
