import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    BLOG_INDEX_FILE,
    BLOG_POST_FILE,
    INDEX_ARRAY_MARKER,
    POST_ARRAY_MARKER,
    SITEMAP_FILE,
    SITEMAP_MARKER,
    buildIndexEntry,
    buildPostEntry,
    buildSitemapEntry,
    estimateReadTime,
    insertAfterMarker,
    sectionsFromBody,
    slugify,
    tsString,
    uniqueSlug,
} from '@/lib/dev-blog';

describe('slugify', () => {
    it('lowercases and dashes titles', () => {
        expect(slugify('How We Built the Dev Panel!')).toBe('how-we-built-the-dev-panel');
    });
    it('strips diacritics and collapses separators', () => {
        expect(slugify('Café — déjà vu?')).toBe('cafe-deja-vu');
    });
    it('never returns an empty slug', () => {
        expect(slugify('???')).toBe('untitled-post');
    });
});

describe('uniqueSlug', () => {
    it('suffixes on collision', () => {
        const taken = new Set(['my-post', 'my-post-2']);
        expect(uniqueSlug('my-post', (s) => taken.has(s))).toBe('my-post-3');
        expect(uniqueSlug('fresh', (s) => taken.has(s))).toBe('fresh');
    });
});

describe('sectionsFromBody', () => {
    it('splits intro, headings, and paragraphs', () => {
        const body = 'Intro one.\n\nIntro two.\n\n## First heading\nPara A\ncontinued.\n\nPara B.\n\n## Second\nOnly one.';
        expect(sectionsFromBody(body)).toEqual([
            { paragraphs: ['Intro one.', 'Intro two.'] },
            { heading: 'First heading', paragraphs: ['Para A continued.', 'Para B.'] },
            { heading: 'Second', paragraphs: ['Only one.'] },
        ]);
    });
    it('handles CRLF and bodies that start with a heading', () => {
        expect(sectionsFromBody('## Top\r\nHello.\r\n')).toEqual([{ heading: 'Top', paragraphs: ['Hello.'] }]);
    });
    it('returns nothing for whitespace-only bodies', () => {
        expect(sectionsFromBody('  \n\n  ')).toEqual([]);
    });
});

describe('tsString', () => {
    it('escapes quotes, backslashes, and newlines', () => {
        expect(tsString("it's a C:\\path\nnext")).toBe("'it\\'s a C:\\\\path\\nnext'");
    });
});

describe('entry builders', () => {
    const meta = {
        slug: 'test-post',
        title: "Testing Tripplet's Panel",
        excerpt: 'A quick check.',
        date: 'July 18, 2026',
        category: 'Engineering',
        readTime: '1 min read',
    };

    it('buildPostEntry emits a valid object literal matching file style', () => {
        const entry = buildPostEntry(meta, [
            { paragraphs: ['Intro.'] },
            { heading: 'Head', paragraphs: ["It's fine."] },
        ]);
        // The literal must parse as a JS expression (same shape the page consumes).
        const parsed = new Function(`return [${entry}][0];`)() as Record<string, unknown>;
        expect(parsed.slug).toBe('test-post');
        expect(parsed.title).toBe("Testing Tripplet's Panel");
        expect(parsed.sections).toEqual([
            { paragraphs: ['Intro.'] },
            { heading: 'Head', paragraphs: ["It's fine."] },
        ]);
        expect(entry.startsWith('    {')).toBe(true);
        expect(entry.endsWith('    },')).toBe(true);
    });

    it('buildIndexEntry emits the listing shape', () => {
        const parsed = new Function(`return [${buildIndexEntry(meta)}][0];`)() as Record<string, unknown>;
        expect(parsed).toEqual({ ...meta });
    });

    it('buildSitemapEntry points at the post', () => {
        expect(buildSitemapEntry('test-post')).toContain("{ path: '/blog/test-post', changeFrequency: 'monthly', priority: 0.6 },");
    });
});

describe('insertAfterMarker', () => {
    it('inserts directly after the marker line', () => {
        const src = 'const posts: Post[] = [\n    { old: true },\n];\n';
        const out = insertAfterMarker(src, 'const posts: Post[] = [', '    { fresh: true },', 'x.ts');
        expect(out).toBe('const posts: Post[] = [\n    { fresh: true },\n    { old: true },\n];\n');
    });
    it('throws when the marker is missing', () => {
        expect(() => insertAfterMarker('nope', 'marker', 'x', 'file.ts')).toThrow(/file\.ts/);
    });
});

describe('estimateReadTime', () => {
    it('floors at one minute and rounds by ~200wpm', () => {
        expect(estimateReadTime('a few words only')).toBe('1 min read');
        expect(estimateReadTime(Array(650).fill('word').join(' '))).toBe('3 min read');
    });
});

describe('real blog files still contain the insertion markers', () => {
    // If a refactor moves/renames these arrays, dev-mode blog publishing would
    // start failing at runtime — fail fast here instead.
    it.each([
        [BLOG_POST_FILE, POST_ARRAY_MARKER],
        [BLOG_INDEX_FILE, INDEX_ARRAY_MARKER],
        [SITEMAP_FILE, SITEMAP_MARKER],
    ])('%s contains its marker', (file, marker) => {
        const source = readFileSync(path.join(process.cwd(), file), 'utf8');
        expect(source.includes(marker)).toBe(true);
    });
});
