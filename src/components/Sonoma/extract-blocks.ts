import type { WebBlock } from './message-context';

const WEB_LANGS = new Set([
    'html', 'htm', 'xhtml',
    'css', 'scss',
    'js', 'javascript', 'mjs', 'cjs',
    'ts', 'typescript',
    'jsx', 'tsx',
]);

/**
 * Pull all fenced code blocks out of a markdown string and normalize their
 * language tags. Returns the blocks that belong to a web-runnable bundle
 * (HTML / CSS / JS / TS). Order is preserved as it appears in the message.
 */
export function extractWebBlocks(markdown: string): WebBlock[] {
    if (!markdown) return [];
    const re = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
    const out: WebBlock[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(markdown)) !== null) {
        const rawLang = (m[1] || '').toLowerCase();
        const lang = normalizeLang(rawLang);
        if (!WEB_LANGS.has(lang)) continue;
        out.push({ lang, code: m[2] });
    }
    return out;
}

export function normalizeLang(lang: string): string {
    const l = lang.toLowerCase();
    if (l === 'htm' || l === 'xhtml') return 'html';
    if (l === 'javascript' || l === 'mjs' || l === 'cjs') return 'js';
    if (l === 'typescript') return 'ts';
    if (l === 'scss') return 'css';
    return l;
}

export function hasRunnableBundle(blocks: WebBlock[]): boolean {
    if (blocks.length === 0) return false;
    return blocks.some((b) => b.lang === 'html' || b.lang === 'js' || b.lang === 'ts' || b.lang === 'jsx' || b.lang === 'tsx');
}
