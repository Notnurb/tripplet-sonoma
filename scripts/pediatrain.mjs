#!/usr/bin/env node

import pg from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_RPS = 5;
const DEFAULT_CONCURRENCY = 8;
const RANDOM_BATCH = 50;
const QUEUE_TARGET = 300;
const USER_AGENT = 'TriplepediaTrainer/1.0 (https://tripplet.ai; contact@tripplet.ai)';

function loadEnvFile(filePath) {
    if (!existsSync(filePath)) return;
    const raw = readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        let value = trimmed.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) {
            process.env[key] = value;
        }
    }
}

function loadEnv() {
    const root = resolve(process.cwd());
    const candidates = [
        '.env.local',
        '.env',
        '.env.development.local',
        '.env.development',
    ];
    for (const file of candidates) {
        loadEnvFile(resolve(root, file));
    }
}

function parseArgs(argv) {
    const args = new Map();
    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i];
        if (!key.startsWith('--')) continue;
        const value = argv[i + 1];
        if (value && !value.startsWith('--')) {
            args.set(key.slice(2), value);
            i += 1;
        } else {
            args.set(key.slice(2), 'true');
        }
    }
    return args;
}

function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function stripHtml(html) {
    return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
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

function extractTableContent(html) {
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
            depth += 1;
            pos = openIdx + 6;
        } else {
            depth -= 1;
            if (depth === 0) {
                return html.slice(startMatch.index + startMatch[0].length, closeIdx);
            }
            pos = closeIdx + 8;
        }
    }
    return null;
}

function extractInfobox(html) {
    const tableInner = extractTableContent(html);
    if (!tableInner) return [];

    const rows = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(tableInner)) !== null) {
        const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
        if (cells.length < 2) continue;

        const label = stripHtml(cells[0][1]).trim();
        if (!label || label.length > 120) continue;

        const valueHtml = cells[cells.length - 1][1];
        const listItems = [...valueHtml.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
        const value = listItems.length > 0
            ? listItems.map(li => stripHtml(li[1]).trim()).filter(Boolean).join(', ')
            : stripHtml(valueHtml).trim();

        if (value && value.length > 0) {
            rows.push({ label, value });
        }
    }

    const seen = new Map();
    for (const row of rows) seen.set(row.label, row.value);
    return [...seen.entries()].map(([label, value]) => ({ label, value }));
}

function extractParagraphs(html) {
    const paragraphs = [];
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let m;
    while ((m = pRegex.exec(html)) !== null) {
        const text = stripHtml(m[1]).trim();
        if (text.length > 0) paragraphs.push(text);
    }
    return paragraphs.join('\n\n');
}

const SKIP_SECTIONS = new Set([
    'references', 'see also', 'external links', 'notes',
    'further reading', 'footnotes', 'bibliography',
]);

function extractSections(sections) {
    const result = [];
    for (const s of sections) {
        const heading = s.title?.trim();
        if (!heading || SKIP_SECTIONS.has(heading.toLowerCase())) continue;
        const content = extractParagraphs(s.text ?? '');
        if (content.length > 0) result.push({ heading, content });
    }
    return result;
}

async function fetchReferences(encoded) {
    try {
        const res = await fetch(
            `https://en.wikipedia.org/api/rest_v1/page/references/${encoded}`,
            { headers: { 'User-Agent': USER_AGENT } }
        );
        if (!res.ok) return [];
        const data = await res.json();
        const refs = [];
        for (const entry of Object.values(data.references_by_id ?? {})) {
            const ref = entry;
            const text = stripHtml(ref.content?.html ?? '').trim();
            if (text.length < 5) continue;
            const urlMatch = (ref.content?.html ?? '').match(/href="(https?:\/\/[^\"]+)"/i);
            const url = urlMatch?.[1];
            refs.push({ text, ...(url ? { url } : {}) });
        }
        return refs;
    } catch {
        return [];
    }
}

async function extractWikipedia(title) {
    const encoded = encodeURIComponent(title.replace(/_/g, ' '));
    const summaryRes = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}?redirect=true`,
        { headers: { 'User-Agent': USER_AGENT } }
    );
    if (!summaryRes.ok) throw new Error(`Wikipedia article not found: "${title}"`);
    const summary = await summaryRes.json();

    const resolvedTitle = summary.title ?? title;
    const resolvedEncoded = encodeURIComponent(resolvedTitle.replace(/_/g, ' '));

    const [sectionsRes, references] = await Promise.all([
        fetch(`https://en.wikipedia.org/api/rest_v1/page/mobile-sections/${resolvedEncoded}?redirect=true`, {
            headers: { 'User-Agent': USER_AGENT },
        }),
        fetchReferences(resolvedEncoded),
    ]);

    const sectionsData = sectionsRes.ok ? await sectionsRes.json() : null;
    const leadHtml = sectionsData?.lead?.sections?.[0]?.text ?? '';
    const infobox = extractInfobox(leadHtml);
    const leadContent = extractParagraphs(leadHtml);

    const rawSections = [];
    if (sectionsData?.sections) {
        rawSections.push(...extractSections(sectionsData.sections));
    }
    if (leadContent.length > 0) {
        rawSections.unshift({ heading: 'Introduction', content: leadContent });
    }

    const imageUrl = summary.originalimage?.source ?? summary.thumbnail?.source ?? null;
    const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(resolvedTitle.replace(/ /g, '_'))}`;

    return {
        title: summary.title ?? resolvedTitle,
        summary: summary.extract ?? '',
        sections: rawSections,
        infobox,
        references,
        imageUrl,
        sourceUrl: wikiUrl,
    };
}

async function fetchRandomWikipediaUrls(count) {
    const target = Math.max(1, Math.floor(count));
    const batches = Math.ceil(target / RANDOM_BATCH);

    const fetchBatch = async (limit) => {
        const baseUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit=${limit}`;
        const res = await fetch(baseUrl, { headers: { 'User-Agent': USER_AGENT } });
        if (res.ok) return res.json();

        const fallbackUrl = `https://en.wikipedia.org/w/api.php?origin=*&action=query&format=json&list=random&rnnamespace=0&rnlimit=${limit}`;
        const fallback = await fetch(fallbackUrl, { headers: { 'User-Agent': USER_AGENT } });
        if (fallback.ok) return fallback.json();

        const opensearchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&limit=${limit}&namespace=0&format=json&search=the`;
        const opensearch = await fetch(opensearchUrl, { headers: { 'User-Agent': USER_AGENT } });
        if (opensearch.ok) {
            const data = await opensearch.json();
            const titles = Array.isArray(data?.[1]) ? data[1] : [];
            return { query: { random: titles.map((title) => ({ title })) } };
        }

        throw new Error('Wikipedia API error');
    };

    const requests = Array.from({ length: batches }, (_, i) => {
        const remaining = target - i * RANDOM_BATCH;
        const limit = Math.max(1, Math.min(remaining, RANDOM_BATCH));
        return fetchBatch(limit).then((data) => {
            const titles = (data?.query?.random ?? []).map((r) => r.title);
            return titles.map((t) => `https://en.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}`);
        });
    });

    const results = await Promise.all(requests);
    const flattened = results.flat();
    return Array.from(new Set(flattened)).slice(0, target);
}

function extractTitleFromUrl(url) {
    try {
        const u = new URL(url);
        if (!u.hostname.endsWith('wikipedia.org')) return null;
        if (u.pathname.startsWith('/wiki/')) {
            return decodeURIComponent(u.pathname.replace('/wiki/', ''));
        }
        if (u.pathname === '/w/index.php') {
            const title = u.searchParams.get('title');
            return title ? decodeURIComponent(title) : null;
        }
        return null;
    } catch {
        return null;
    }
}

async function main() {
    loadEnv();
    const args = parseArgs(process.argv.slice(2));
    const rps = Number(args.get('rps') ?? DEFAULT_RPS);
    const concurrency = Number(args.get('concurrency') ?? DEFAULT_CONCURRENCY);
    const total = Number(args.get('count') ?? 0);
    const submittedBy = args.get('submitted-by') ?? process.env.SUBMITTED_BY ?? null;

    if (!Number.isFinite(rps) || rps <= 0) {
        console.error('Invalid --rps value.');
        process.exit(1);
    }
    if (!Number.isFinite(concurrency) || concurrency <= 0) {
        console.error('Invalid --concurrency value.');
        process.exit(1);
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('Missing DATABASE_URL. Set it to your Neon connection string.');
        process.exit(1);
    }

    const pool = new pg.Pool({
        connectionString,
        ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
    });

    const intervalMs = 1000 / rps;
    let nextAllowed = Date.now();
    const queue = [];
    const active = new Set();

    let processed = 0;
    let inserted = 0;
    let failed = 0;

    async function rateLimit() {
        const now = Date.now();
        if (now < nextAllowed) {
            await sleep(nextAllowed - now);
        }
        nextAllowed = Math.max(nextAllowed + intervalMs, Date.now() + intervalMs);
    }

    async function ensureQueue() {
        if (queue.length >= QUEUE_TARGET) return;
        const needed = QUEUE_TARGET - queue.length;
        const urls = await fetchRandomWikipediaUrls(needed);
        queue.push(...urls);
    }

    async function processUrl(url) {
        try {
            const title = extractTitleFromUrl(url);
            if (!title) return;
            const data = await extractWikipedia(title);
            const slug = `${slugify(data.title || 'article')}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

            const finalInfobox = [
                ...(data.imageUrl ? [{ label: '__image__', value: data.imageUrl }] : []),
                ...(data.infobox ?? []),
                { label: 'Source', value: data.sourceUrl },
            ];

            try {
                await pool.query(
                    `INSERT INTO triplepedia_articles
                        (title, slug, summary, sections, infobox, submitted_by, status)
                     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, 'published')
                     ON CONFLICT (slug) DO NOTHING`,
                    [
                        data.title,
                        slug,
                        data.summary,
                        JSON.stringify(data.sections ?? []),
                        JSON.stringify(finalInfobox),
                        submittedBy,
                    ],
                );
                inserted += 1;
            } catch {
                failed += 1;
            }
        } catch {
            failed += 1;
        } finally {
            processed += 1;
        }
    }

    async function runLoop() {
        while (true) {
            if (total > 0 && processed >= total) break;
            await ensureQueue();

            while (active.size < concurrency && queue.length > 0) {
                if (total > 0 && processed + active.size >= total) break;
                const url = queue.shift();
                if (!url) break;
                await rateLimit();
                const p = processUrl(url).finally(() => active.delete(p));
                active.add(p);
            }

            if (active.size > 0) {
                await Promise.race(active);
            } else {
                await sleep(50);
            }

            if ((processed + active.size) % 50 === 0) {
                process.stdout.write(`\rprocessed ${processed} | inserted ${inserted} | failed ${failed} | in-flight ${active.size} | queue ${queue.length}`);
            }
        }

        await Promise.all(active);
        console.log(`\nDone. processed ${processed} | inserted ${inserted} | failed ${failed}`);
    }

    console.log(`pediatrain starting | rps=${rps} | concurrency=${concurrency} | ${total > 0 ? `count=${total}` : 'count=∞'}`);
    await runLoop();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
