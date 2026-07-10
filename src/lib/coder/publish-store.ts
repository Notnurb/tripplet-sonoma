import path from 'path';
import { promises as fs } from 'fs';
import { CodeFile, CodePublishMetadata } from '@/types';

export interface PublishedSite {
    metadata: CodePublishMetadata;
    html: string;
    files: CodeFile[];
    publishedAt: string;
}

type PublishedMap = Record<string, PublishedSite>;

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'published-sites.json');

async function ensureStoreFile() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
        await fs.access(STORE_PATH);
    } catch {
        await fs.writeFile(STORE_PATH, JSON.stringify({}, null, 2), 'utf8');
    }
}

async function readStore(): Promise<PublishedMap> {
    await ensureStoreFile();
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
        return {};
    }
}

async function writeStore(data: PublishedMap) {
    await ensureStoreFile();
    await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export function normalizeSlug(input: string): string {
    return input
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '');
}

export async function savePublishedSite(site: PublishedSite) {
    const map = await readStore();
    map[site.metadata.slug] = site;
    await writeStore(map);
}

export async function getPublishedSite(slug: string): Promise<PublishedSite | null> {
    const map = await readStore();
    return map[slug] || null;
}

export async function listPublishedSites(): Promise<PublishedSite[]> {
    const map = await readStore();
    return Object.values(map).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
