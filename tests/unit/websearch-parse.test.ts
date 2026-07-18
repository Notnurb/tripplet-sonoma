import { describe, it, expect } from 'vitest';
import { parseDuckDuckGoHtml, parseDuckDuckGoLite, decodeResultUrl } from '@/lib/ai/websearch';

// Minimal fixture in the shape html.duckduckgo.com actually serves (verified
// live 2026-07-06): result__a title anchors with uddg redirect hrefs, each
// followed by a result__snippet anchor.
const RESULT = (href: string, title: string, snippet: string) => `
<div class="result">
  <a rel="nofollow" class="result__a" href="${href}">${title}</a>
  <a class="result__snippet" href="${href}">${snippet}</a>
</div>`;

const PAGE =
    RESULT('//duckduckgo.com/l/?uddg=https%3A%2F%2Fnextjs.org%2Fdocs&rut=abc', '<b>Next.js</b> Docs', 'The React framework docs.') +
    RESULT('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=def', 'Example Page', 'A &amp; B &lt;test&gt;.') +
    // Internal DDG link with no uddg — must be skipped (ad slot shape).
    RESULT('//duckduckgo.com/y.js?ad_provider=x', 'Sponsored Junk', 'Buy things.');

describe('parseDuckDuckGoHtml', () => {
    it('extracts titles, real URLs, and snippets', () => {
        const r = parseDuckDuckGoHtml(PAGE, 8);
        expect(r).toHaveLength(2);
        expect(r[0]).toEqual({
            title: 'Next.js Docs',
            url: 'https://nextjs.org/docs',
            snippet: 'The React framework docs.',
        });
        expect(r[1].url).toBe('https://example.com/page');
        // Entities decoded, tags stripped.
        expect(r[1].snippet).toBe('A & B <test>.');
    });

    it('respects maxResults', () => {
        expect(parseDuckDuckGoHtml(PAGE, 1)).toHaveLength(1);
    });

    it('returns empty for a challenge/empty page', () => {
        expect(parseDuckDuckGoHtml('', 5)).toEqual([]);
        expect(parseDuckDuckGoHtml('<html><body>anomaly</body></html>', 5)).toEqual([]);
    });
});

// Lite markup: <a ... href=".." class='result-link'> (href BEFORE class), with
// the snippet in a following <td class="result-snippet">.
const LITE_RESULT = (href: string, title: string, snippet: string) => `
<tr>
  <td valign="top">1.&nbsp;</td>
  <td>
    <a rel="nofollow" href="${href}" class='result-link'>${title}</a>
  </td>
</tr>
<tr>
  <td class='result-snippet'>${snippet}</td>
</tr>`;

const LITE_PAGE =
    LITE_RESULT('//duckduckgo.com/l/?uddg=https%3A%2F%2Fmodrinth.com%2Fmod%2Ffabric-api&rut=abc', '<b>Fabric</b> API', 'Core library for Fabric mods.') +
    LITE_RESULT('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fx&rut=def', 'Example', 'A &amp; B.') +
    // Ad slot / internal link — no uddg target, must be skipped.
    LITE_RESULT('//duckduckgo.com/y.js?ad_provider=x', 'Sponsored', 'Buy things.');

describe('parseDuckDuckGoLite', () => {
    it('extracts titles, real URLs, and snippets despite href-before-class order', () => {
        const r = parseDuckDuckGoLite(LITE_PAGE, 8);
        expect(r).toHaveLength(2);
        expect(r[0]).toEqual({
            title: 'Fabric API',
            url: 'https://modrinth.com/mod/fabric-api',
            snippet: 'Core library for Fabric mods.',
        });
        expect(r[1].url).toBe('https://example.com/x');
        expect(r[1].snippet).toBe('A & B.');
    });

    it('respects maxResults and returns empty for a challenge page', () => {
        expect(parseDuckDuckGoLite(LITE_PAGE, 1)).toHaveLength(1);
        expect(parseDuckDuckGoLite('<html><body>anomaly</body></html>', 5)).toEqual([]);
    });
});

describe('decodeResultUrl', () => {
    it('unwraps uddg redirect links', () => {
        expect(decodeResultUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.com%2Fb%3Fc%3D1&rut=z')).toBe('https://a.com/b?c=1');
    });
    it('rejects DDG-internal links without a target', () => {
        expect(decodeResultUrl('//duckduckgo.com/y.js?ad=1')).toBeNull();
    });
    it('rejects non-http(s) targets', () => {
        expect(decodeResultUrl('//duckduckgo.com/l/?uddg=javascript%3Aalert(1)')).toBeNull();
    });
    it('passes through already-direct external URLs', () => {
        expect(decodeResultUrl('https://direct.example.com/x')).toBe('https://direct.example.com/x');
    });
});
