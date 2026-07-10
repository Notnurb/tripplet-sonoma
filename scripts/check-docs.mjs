#!/usr/bin/env node
/**
 * Documentation freshness gate.
 *
 * Cold-read reviewers keep finding the same class of doc rot: a markdown file
 * confidently references a source path (`src/lib/ai/models.ts`) that has since
 * moved or been renamed. This script scans the human-maintained docs for
 * backtick-wrapped repo paths and fails if any of them no longer exist — so the
 * docs can't silently drift out of sync with the tree.
 *
 * Scope is deliberately conservative to avoid false positives: a token is only
 * checked when it is inside an inline-code span, contains a path separator, uses
 * only safe path characters, and either ends in `/` (a directory) or carries a
 * recognized file extension. Anything with glob/brace/paren/space characters
 * (route groups like `(auth)/[[...slug]]`, brace-expansions like `{a,b}.ts`) is
 * skipped — those can't be resolved to a single real path.
 *
 * Run: `npm run check:docs` (also runs in CI).
 */

import { existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

// Only tokens whose FIRST path segment is a real top-level repo entry are
// checked. This is what keeps the gate precise: it validates fully-qualified
// references (`src/lib/ai/models.ts`, `docs/audits/review.txt`) while ignoring
// the two big false-positive classes — indented tree-diagram fragments
// (`app/`, `ai/`) and prefix-less partials in prose (`hooks/useChat.ts`), whose
// first segment is not a repo root.
const TOP_LEVEL = new Set(readdirSync(ROOT));

// Index of every file basename in the repo (minus heavy/generated trees) so a
// bare, slash-less reference like `review.txt` can be caught when no file of
// that name exists anywhere — the path-separator rule alone silently skips it.
const IGNORE_WALK = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage']);
const REPO_BASENAMES = new Set();
(function indexBasenames(dir) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory()) {
            if (!IGNORE_WALK.has(ent.name)) indexBasenames(path.join(dir, ent.name));
        } else {
            REPO_BASENAMES.add(ent.name);
        }
    }
})(ROOT);

// Bare (slash-less) filenames are only checked for extensions that, inside a
// doc's backticks, almost always name a specific repo artifact rather than a
// generic example — avoids false positives on prose like `route.ts`.
const BARE_EXT = new Set(['txt', 'sql', 'prisma', 'mjs', 'cjs', 'toml', 'yml', 'yaml', 'sh']);

// Human-maintained docs. Generated/vendored/legacy trees are intentionally out
// of scope.
const DOC_GLOBS = [
    'README.md',
    'CLAUDE.md',
    'AGENTS.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'CHANGELOG.md',
    'tests/README.md',
    'docs/**/*.md',
];

// Historical / snapshot trees are out of scope: a dated audit or a past UI
// changelog intentionally references files that were since deleted or renamed,
// so "freshness" doesn't apply to them.
const EXCLUDE_DIRS = [
    path.join('docs', 'legacy'),
    path.join('docs', 'planning'),
    path.join('docs', 'audits'),
];

// A line that documents a past state ("Deleted: `x`", "removed", "renamed
// from") is allowed to reference a now-absent path — that's a correct changelog,
// not rot. Kept narrow (whole words) so it doesn't mask live references.
const HISTORY_MARKER = /\b(deleted|removed|renamed|now-deleted|superseded|formerly|no longer exists?)\b/i;

const RECOGNIZED_EXT = new Set([
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'md', 'json', 'sql',
    'css', 'scss', 'yml', 'yaml', 'sh', 'txt', 'png', 'jpg', 'jpeg',
    'svg', 'mp4', 'ico', 'webp', 'prisma',
]);

// Characters that mean "this is a pattern/expression, not a concrete path".
const UNSAFE = /[*?<>(){}\[\]\s`|]/;

/** Collect markdown files matching the doc globs, minus excluded dirs. */
async function collectDocs() {
    const { glob } = await import('node:fs/promises').then((m) => ({ glob: m.glob })).catch(() => ({ glob: null }));
    const files = new Set();

    if (glob) {
        for (const pattern of DOC_GLOBS) {
            for await (const entry of glob(pattern)) {
                files.add(path.resolve(ROOT, entry));
            }
        }
    } else {
        // Fallback for older Node without fs.glob: walk docs/ manually.
        const { readdirSync } = await import('node:fs');
        for (const p of DOC_GLOBS) {
            if (!p.includes('*')) {
                const abs = path.resolve(ROOT, p);
                if (existsSync(abs)) files.add(abs);
            }
        }
        const walk = (dir) => {
            if (!existsSync(dir)) return;
            for (const name of readdirSync(dir)) {
                const abs = path.join(dir, name);
                const st = statSync(abs);
                if (st.isDirectory()) walk(abs);
                else if (name.endsWith('.md')) files.add(abs);
            }
        };
        walk(path.resolve(ROOT, 'docs'));
    }

    return [...files].filter((abs) => {
        const rel = path.relative(ROOT, abs);
        return !EXCLUDE_DIRS.some((d) => rel.startsWith(d + path.sep) || rel.startsWith(d + '/'));
    });
}

/** Extract candidate repo paths from a single doc's text (line by line, so the
 *  history-marker guard has line context and code fences don't span spans). */
function extractPaths(text) {
    const found = [];
    for (const line of text.split(/\r?\n/)) {
        if (HISTORY_MARKER.test(line)) continue;
        // Inline-code spans: `...`
        const spanRe = /`([^`]+)`/g;
        let m;
        while ((m = spanRe.exec(line)) !== null) {
            for (const rawTok of m[1].split(/[\s,]+/)) {
                // Trim trailing prose punctuation and a :line / #anchor suffix.
                let tok = rawTok.replace(/[.,;:]+$/, '').replace(/:\d+(?::\d+)?$/, '').replace(/#.*$/, '');
                if (UNSAFE.test(tok)) continue;
                if (tok.includes('/')) {
                    // Fully-qualified path: first segment must be a real repo root.
                    if (!TOP_LEVEL.has(tok.split('/')[0])) continue;
                    const isDir = tok.endsWith('/');
                    const ext = isDir ? null : tok.split('.').pop().toLowerCase();
                    if (!isDir && !RECOGNIZED_EXT.has(ext)) continue;
                    found.push({ tok, isDir, bare: false });
                } else {
                    // Bare filename (name.ext) with a "specific artifact" extension.
                    if (!/^[\w.-]+\.\w+$/.test(tok)) continue;
                    if (!BARE_EXT.has(tok.split('.').pop().toLowerCase())) continue;
                    found.push({ tok, isDir: false, bare: true });
                }
            }
        }
    }
    return found;
}

const docs = await collectDocs();
const missing = [];

for (const abs of docs) {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(abs, 'utf8');
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    const seen = new Set();
    for (const { tok, isDir, bare } of extractPaths(text)) {
        if (seen.has(tok)) continue;
        seen.add(tok);
        if (bare) {
            if (!REPO_BASENAMES.has(tok)) {
                missing.push({ doc: rel, ref: tok, note: 'no file with this name exists anywhere in the repo' });
            }
            continue;
        }
        const target = path.resolve(ROOT, tok);
        if (!existsSync(target)) {
            missing.push({ doc: rel, ref: tok });
        } else if (isDir && !statSync(target).isDirectory()) {
            missing.push({ doc: rel, ref: tok, note: 'referenced as a directory but is a file' });
        }
    }
}

if (missing.length > 0) {
    console.error(
        `\n❌ [check-docs] ${missing.length} documentation reference(s) point at paths that don't exist:\n`,
    );
    for (const { doc, ref, note } of missing) {
        console.error(`  ✗ ${doc} → ${ref}${note ? `  (${note})` : ''}`);
    }
    console.error(
        '\nUpdate the docs to the new path, or fix the typo. This gate exists so ' +
            'a rename never silently rots the documentation.\n',
    );
    process.exit(1);
}

console.log(`[check-docs] ✓ Verified repo-path references across ${docs.length} doc file(s); all resolve.`);
process.exit(0);
