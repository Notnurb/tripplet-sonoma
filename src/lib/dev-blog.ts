// SERVER-ONLY: dev-mode blog authoring (src/lib/dev-mode.ts).
//
// The blog has no CMS — posts are literal objects inside three source files:
//   - src/app/blog/[slug]/page.tsx  (POSTS: full content, newest first)
//   - src/app/blog/page.tsx         (posts: listing metadata, newest first)
//   - src/lib/sitemap-data.ts       (one /blog/<slug> entry)
// createBlogPost() inserts a new entry at the top of each array by writing the
// real files, so the post is immediately live on the dev server and ships to
// GitLab/Vercel with the next commit. Only /api/dev/blog calls this, and that
// route is hard-gated to the dev server — production filesystems are never
// touched.
//
// The pure helpers are exported for tests/unit/dev-blog.test.ts.

import { promises as fs } from 'fs';
import path from 'path';

export interface DevBlogInput {
    title: string;
    category: string;
    excerpt: string;
    body: string;
}

export interface DevBlogSection {
    heading?: string;
    paragraphs: string[];
}

export const BLOG_POST_FILE = 'src/app/blog/[slug]/page.tsx';
export const BLOG_INDEX_FILE = 'src/app/blog/page.tsx';
export const SITEMAP_FILE = 'src/lib/sitemap-data.ts';

// Insertion anchors. If one of these ever disappears, createBlogPost fails
// loudly instead of writing a post nobody can see — keep them in sync with
// the files above.
export const POST_ARRAY_MARKER = 'const POSTS: PostContent[] = [';
export const INDEX_ARRAY_MARKER = 'const posts: Post[] = [';
export const SITEMAP_MARKER = "{ path: '/blog', changeFrequency: 'weekly', priority: 0.8 },";

export function slugify(title: string): string {
    const slug = title
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || 'untitled-post';
}

export function uniqueSlug(base: string, isTaken: (slug: string) => boolean): string {
    let slug = base;
    for (let i = 2; isTaken(slug); i++) slug = `${base}-${i}`;
    return slug;
}

/**
 * Body format: blank lines split paragraphs; a line starting with "## " opens
 * a new section with that heading. Text before the first "## " becomes the
 * intro section without a heading — the same shape the existing posts use.
 */
export function sectionsFromBody(body: string): DevBlogSection[] {
    const sections: DevBlogSection[] = [];
    let current: DevBlogSection = { paragraphs: [] };
    let buffer: string[] = [];

    const flushParagraph = () => {
        const text = buffer.join(' ').trim();
        if (text) current.paragraphs.push(text);
        buffer = [];
    };
    const flushSection = () => {
        flushParagraph();
        if (current.heading !== undefined || current.paragraphs.length) sections.push(current);
    };

    for (const rawLine of body.replace(/\r\n/g, '\n').split('\n')) {
        const line = rawLine.trim();
        if (line.startsWith('## ')) {
            flushSection();
            current = { heading: line.slice(3).trim(), paragraphs: [] };
        } else if (!line) {
            flushParagraph();
        } else {
            buffer.push(line);
        }
    }
    flushSection();
    return sections;
}

/** Single-quoted TS string literal, matching the blog files' style. */
export function tsString(value: string): string {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n')}'`;
}

export interface DevBlogPostMeta {
    slug: string;
    title: string;
    excerpt: string;
    date: string;
    category: string;
    readTime: string;
}

/** Entry for the POSTS array in src/app/blog/[slug]/page.tsx. */
export function buildPostEntry(meta: DevBlogPostMeta, sections: DevBlogSection[]): string {
    const lines: string[] = [];
    lines.push('    {');
    lines.push(`        slug: ${tsString(meta.slug)},`);
    lines.push(`        title: ${tsString(meta.title)},`);
    lines.push(`        excerpt: ${tsString(meta.excerpt)},`);
    lines.push(`        date: ${tsString(meta.date)},`);
    lines.push(`        category: ${tsString(meta.category)},`);
    lines.push(`        readTime: ${tsString(meta.readTime)},`);
    lines.push('        sections: [');
    for (const section of sections) {
        lines.push('            {');
        if (section.heading) lines.push(`                heading: ${tsString(section.heading)},`);
        lines.push('                paragraphs: [');
        for (const paragraph of section.paragraphs) {
            lines.push(`                    ${tsString(paragraph)},`);
        }
        lines.push('                ],');
        lines.push('            },');
    }
    lines.push('        ],');
    lines.push('    },');
    return lines.join('\n');
}

/** Entry for the posts array in src/app/blog/page.tsx. */
export function buildIndexEntry(meta: DevBlogPostMeta): string {
    return [
        '    {',
        `        slug: ${tsString(meta.slug)},`,
        `        title: ${tsString(meta.title)},`,
        `        excerpt: ${tsString(meta.excerpt)},`,
        `        date: ${tsString(meta.date)},`,
        `        category: ${tsString(meta.category)},`,
        `        readTime: ${tsString(meta.readTime)},`,
        '    },',
    ].join('\n');
}

export function buildSitemapEntry(slug: string): string {
    return `            { path: ${tsString(`/blog/${slug}`)}, changeFrequency: 'monthly', priority: 0.6 },`;
}

export function insertAfterMarker(source: string, marker: string, insertion: string, file: string): string {
    const idx = source.indexOf(marker);
    if (idx === -1) {
        throw new Error(`Insertion marker not found in ${file} — the blog file layout changed; update src/lib/dev-blog.ts markers.`);
    }
    const at = idx + marker.length;
    return `${source.slice(0, at)}\n${insertion}${source.slice(at)}`;
}

export function estimateReadTime(body: string): string {
    const words = body.split(/\s+/).filter(Boolean).length;
    return `${Math.max(1, Math.round(words / 200))} min read`;
}

export function formatPostDate(date: Date = new Date()): string {
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export async function createBlogPost(
    input: DevBlogInput,
): Promise<{ slug: string; url: string; files: string[] }> {
    const root = process.cwd();
    const postPath = path.join(root, BLOG_POST_FILE);
    const indexPath = path.join(root, BLOG_INDEX_FILE);
    const sitemapPath = path.join(root, SITEMAP_FILE);

    const [postSrc, indexSrc, sitemapSrc] = await Promise.all([
        fs.readFile(postPath, 'utf8'),
        fs.readFile(indexPath, 'utf8'),
        fs.readFile(sitemapPath, 'utf8'),
    ]);

    const sections = sectionsFromBody(input.body);
    if (!sections.length) throw new Error('Post body is empty.');

    // slugify() output is [a-z0-9-] only, so this literal probe is exact.
    const slug = uniqueSlug(
        slugify(input.title),
        (candidate) => postSrc.includes(`slug: '${candidate}'`) || indexSrc.includes(`slug: '${candidate}'`),
    );

    const meta: DevBlogPostMeta = {
        slug,
        title: input.title.trim(),
        excerpt: input.excerpt.trim(),
        date: formatPostDate(),
        category: input.category.trim() || 'Engineering',
        readTime: estimateReadTime(input.body),
    };

    // Build every new file before writing any, so a bad marker changes nothing.
    const newPostSrc = insertAfterMarker(postSrc, POST_ARRAY_MARKER, buildPostEntry(meta, sections), BLOG_POST_FILE);
    const newIndexSrc = insertAfterMarker(indexSrc, INDEX_ARRAY_MARKER, buildIndexEntry(meta), BLOG_INDEX_FILE);
    const files = [BLOG_POST_FILE, BLOG_INDEX_FILE];

    // Sitemap entry is nice-to-have — a drifted marker there shouldn't block
    // publishing the post itself.
    let newSitemapSrc: string | null = null;
    try {
        newSitemapSrc = insertAfterMarker(sitemapSrc, SITEMAP_MARKER, buildSitemapEntry(slug), SITEMAP_FILE);
        files.push(SITEMAP_FILE);
    } catch {
        newSitemapSrc = null;
    }

    await fs.writeFile(postPath, newPostSrc, 'utf8');
    await fs.writeFile(indexPath, newIndexSrc, 'utf8');
    if (newSitemapSrc !== null) await fs.writeFile(sitemapPath, newSitemapSrc, 'utf8');

    return { slug, url: `/blog/${slug}`, files };
}
