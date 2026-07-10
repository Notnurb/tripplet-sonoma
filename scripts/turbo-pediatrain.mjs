#!/usr/bin/env node
/**
 * TURBO Pediatrain v2 — Self-sufficient worker architecture
 *
 * Each worker independently:
 *   1. Fetches 500 random Wikipedia titles
 *   2. Chunks them into groups of 20
 *   3. Fetches extracts + images for each chunk
 *   4. Batch-inserts into Supabase
 *   5. Repeats until target is reached
 *
 * Usage:
 *   node scripts/turbo-pediatrain.mjs --count 400000 --workers 25
 */

import pg from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_COUNT = 400_000;
const DEFAULT_WORKERS = 25;
const RANDOM_BATCH = 500;
const EXTRACT_BATCH = 20;
const DB_BATCH = 50;
const USER_AGENT = 'TriplepediaTrainer/2.0 (https://tripplet.ai; contact@tripplet.ai)';
const MIN_EXTRACT = 40;
const STATS_MS = 5000;
const RETRY_DELAY = 2000;
const MAX_RETRIES = 3;

// ── Env ──────────────────────────────────────────────────────────────────────

function loadEnvFile(fp) {
    if (!existsSync(fp)) return;
    for (const line of readFileSync(fp, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i === -1) continue;
        const k = t.slice(0, i).trim();
        let v = t.slice(i + 1).trim();
        if ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'")) v = v.slice(1, -1);
        if (!(k in process.env)) process.env[k] = v;
    }
}

function loadEnv() {
    const root = resolve(process.cwd());
    for (const f of ['.env.local', '.env']) loadEnvFile(resolve(root, f));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const m = new Map();
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) continue;
        const v = argv[i + 1];
        if (v && !v.startsWith('--')) { m.set(argv[i].slice(2), v); i++; }
        else m.set(argv[i].slice(2), 'true');
    }
    return m;
}

function slugify(t) {
    return t.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function chunk(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
}

// ── Wikipedia ────────────────────────────────────────────────────────────────

async function fetchWithRetry(url, retries = MAX_RETRIES) {
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': USER_AGENT },
                signal: AbortSignal.timeout(15000),
            });
            if (res.ok) return await res.json();
            if (res.status === 429) {
                // Rate limited — back off
                await sleep(RETRY_DELAY * (i + 1));
                continue;
            }
            throw new Error(`HTTP ${res.status}`);
        } catch (e) {
            if (i === retries) throw e;
            await sleep(RETRY_DELAY * (i + 1));
        }
    }
}

async function getRandomTitles() {
    const data = await fetchWithRetry(
        `https://en.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit=${RANDOM_BATCH}`
    );
    return (data?.query?.random ?? []).map(r => r.title);
}

async function getExtracts(titles) {
    const joined = titles.map(t => encodeURIComponent(t)).join('|');
    const data = await fetchWithRetry(
        `https://en.wikipedia.org/w/api.php?action=query&format=json&titles=${joined}&prop=extracts|pageimages&exintro=true&explaintext=true&exlimit=${titles.length}&pithumbsize=800&pilimit=${titles.length}`
    );
    const pages = data?.query?.pages ?? {};
    const articles = [];
    for (const p of Object.values(pages)) {
        if (p.missing !== undefined) continue;
        const ext = p.extract?.trim();
        if (!ext || ext.length < MIN_EXTRACT) continue;
        if (ext.includes('may refer to:') || ext.includes('can refer to:')) continue;
        articles.push({
            title: p.title,
            summary: ext.slice(0, 500),
            sections: [{ heading: 'Introduction', content: ext }],
            imageUrl: p.thumbnail?.source ?? null,
        });
    }
    return articles;
}

// ── Shared state ─────────────────────────────────────────────────────────────

let inserted = 0;
let failed = 0;
let skipped = 0;
let wikiCalls = 0;
const startTime = Date.now();

function totalProcessed() { return inserted + failed; }

// ── Worker ───────────────────────────────────────────────────────────────────

async function worker(id, pool, submittedBy, target) {
    while (totalProcessed() < target) {
        try {
            // 1. Get random titles
            wikiCalls++;
            const titles = await getRandomTitles();
            if (titles.length === 0) { await sleep(500); continue; }

            // 2. Chunk titles and fetch extracts
            const chunks = chunk(titles, EXTRACT_BATCH);
            for (const ch of chunks) {
                if (totalProcessed() >= target) break;

                try {
                    wikiCalls++;
                    const articles = await getExtracts(ch);
                    skipped += ch.length - articles.length;

                    if (articles.length === 0) continue;

                    // 3. Batch insert
                    const rows = articles.map(a => ({
                        title: a.title,
                        slug: `${slugify(a.title)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                        summary: a.summary,
                        sections: a.sections,
                        infobox: [
                            ...(a.imageUrl ? [{ label: '__image__', value: a.imageUrl }] : []),
                            { label: 'Source', value: `https://en.wikipedia.org/wiki/${encodeURIComponent(a.title.replace(/ /g, '_'))}` },
                        ],
                        submitted_by: submittedBy,
                        fact_checked_at: new Date().toISOString(),
                        status: 'published',
                    }));

                    // Insert in sub-batches
                    for (const dbChunk of chunk(rows, DB_BATCH)) {
                        try {
                            const values = [];
                            const tuples = dbChunk.map((r, i) => {
                                const o = i * 6;
                                values.push(
                                    r.title,
                                    r.slug,
                                    r.summary,
                                    JSON.stringify(r.sections ?? []),
                                    JSON.stringify(r.infobox ?? []),
                                    r.submitted_by,
                                );
                                return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}::jsonb, $${o + 5}::jsonb, $${o + 6}, 'published')`;
                            });
                            await pool.query(
                                `INSERT INTO triplepedia_articles
                                    (title, slug, summary, sections, infobox, submitted_by, status)
                                 VALUES ${tuples.join(', ')}
                                 ON CONFLICT (slug) DO NOTHING`,
                                values,
                            );
                            inserted += dbChunk.length;
                        } catch {
                            failed += dbChunk.length;
                        }
                    }
                } catch {
                    failed += ch.length;
                }
            }
        } catch (e) {
            // Title fetch failed — back off and retry
            await sleep(RETRY_DELAY);
        }
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    loadEnv();
    const args = parseArgs(process.argv.slice(2));
    const target = Number(args.get('count') ?? DEFAULT_COUNT);
    const numWorkers = Number(args.get('workers') ?? DEFAULT_WORKERS);
    const submittedBy = args.get('submitted-by') ?? 'turbo-pediatrain';

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) { console.error('Missing DATABASE_URL env var'); process.exit(1); }

    const pool = new pg.Pool({
        connectionString,
        ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
    });

    console.log(`\n  TURBO PEDIATRAIN v2`);
    console.log(`  Target: ${target.toLocaleString()} articles`);
    console.log(`  Workers: ${numWorkers}`);
    console.log(`  Each worker: fetch 500 titles → extract 20 at a time → batch insert`);
    console.log(`  Starting...\n`);

    // Stats reporter
    const timer = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = inserted / elapsed;
        const remaining = target - totalProcessed();
        const eta = rate > 0 ? Math.ceil(remaining / rate) : 0;
        const etaStr = eta > 0 ? `${Math.floor(eta / 60)}m${eta % 60}s` : '...';
        process.stdout.write(
            `\r  [${Math.floor(elapsed)}s] ` +
            `inserted: ${inserted.toLocaleString()} | ` +
            `failed: ${failed.toLocaleString()} | ` +
            `skipped: ${skipped.toLocaleString()} | ` +
            `wiki-calls: ${wikiCalls} | ` +
            `rate: ${rate.toFixed(1)}/s | ` +
            `ETA: ${etaStr}       `
        );
    }, STATS_MS);

    // Launch workers
    const workers = Array.from({ length: numWorkers }, (_, i) =>
        worker(i, pool, submittedBy, target)
    );
    await Promise.all(workers);

    clearInterval(timer);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n\n  Done in ${elapsed}s`);
    console.log(`  Inserted: ${inserted.toLocaleString()}`);
    console.log(`  Failed: ${failed.toLocaleString()}`);
    console.log(`  Skipped: ${skipped.toLocaleString()}`);
    console.log(`  Wikipedia API calls: ${wikiCalls.toLocaleString()}`);
    console.log(`  Rate: ${(inserted / Number(elapsed)).toFixed(1)} articles/sec\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
