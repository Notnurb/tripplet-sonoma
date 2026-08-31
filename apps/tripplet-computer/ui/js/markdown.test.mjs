// Tests for the assistant-message renderer. Run with `node --test ui/js`.
//
// The escaping tests are the load-bearing ones: model output routinely quotes
// file contents, so anything that renders raw markup here is an injection in a
// window that also holds the user's API key.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderMarkdown, escapeHtml } from './markdown.js'

test('escapes every HTML metacharacter', () => {
    assert.equal(escapeHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;')
})

test('script tags in model output never render as markup', () => {
    const html = renderMarkdown('Here you go: <script>alert(1)</script>')
    assert.ok(!html.includes('<script>'), html)
    assert.ok(html.includes('&lt;script&gt;'))
})

test('script tags inside a code fence stay inert', () => {
    const html = renderMarkdown('```html\n<script>alert(1)</script>\n```')
    assert.ok(html.includes('<pre><code>'))
    assert.ok(!html.includes('<script>'))
    assert.ok(html.includes('&lt;script&gt;'))
})

test('img onerror payloads render as inert text, not an element', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    // The payload text survives — that is fine and correct. What must not
    // survive is a real element, so assert on the markup, not the substring.
    assert.ok(!/<img/i.test(html), html)
    assert.equal(html, '<p>&lt;img src=x onerror=alert(1)&gt;</p>')
})

test('renders paragraphs and inline emphasis', () => {
    const html = renderMarkdown('First para.\n\nSecond **bold** and *em*.')
    assert.ok(html.includes('<p>First para.</p>'))
    assert.ok(html.includes('<strong>bold</strong>'))
    assert.ok(html.includes('<em>em</em>'))
})

test('renders inline code without touching its contents', () => {
    const html = renderMarkdown('Use `a < b && c` here')
    assert.ok(html.includes('<code>a &lt; b &amp;&amp; c</code>'), html)
})

test('a bare number in prose is not mistaken for a code slot', () => {
    // Regression: a digit-keyed code placeholder rewrote ordinary numbers.
    const html = renderMarkdown('Wait `now` then 0 and 1 more')
    assert.ok(html.includes('<code>now</code>'))
    assert.ok(html.includes('then 0 and 1 more'), html)
})

test('markdown inside inline code is left alone', () => {
    const html = renderMarkdown('`**not bold**`')
    assert.ok(html.includes('<code>**not bold**</code>'), html)
    assert.ok(!html.includes('<strong>'))
})

test('renders bullet and numbered lists', () => {
    const bullets = renderMarkdown('- one\n- two')
    assert.ok(bullets.includes('<ul><li>one</li><li>two</li></ul>'), bullets)
    const numbered = renderMarkdown('1. one\n2. two')
    assert.ok(numbered.includes('<ol><li>one</li><li>two</li></ol>'), numbered)
})

test('a list followed by a paragraph closes the list', () => {
    const html = renderMarkdown('- one\n\nAfter.')
    assert.ok(html.indexOf('</ul>') < html.indexOf('<p>After.</p>'), html)
})

test('headings shift down one level so they never emit h1', () => {
    const html = renderMarkdown('# Title\n## Sub')
    assert.ok(html.includes('<h2>Title</h2>'))
    assert.ok(html.includes('<h3>Sub</h3>'))
    assert.ok(!html.includes('<h1>'))
})

test('http and https links render, other schemes do not', () => {
    const ok = renderMarkdown('[docs](https://docs.rs/serde)')
    assert.ok(ok.includes('<a href="https://docs.rs/serde"'))
    assert.ok(ok.includes('rel="noreferrer"'))

    for (const hostile of [
        '[click](javascript:alert(1))',
        '[click](data:text/html,<script>alert(1)</script>)',
        '[click](file:///etc/passwd)',
    ]) {
        const html = renderMarkdown(hostile)
        assert.ok(!html.includes('<a href'), `${hostile} -> ${html}`)
    }
})

test('bare URLs autolink but keep surrounding text', () => {
    const html = renderMarkdown('See https://example.com for more')
    assert.ok(html.includes('<a href="https://example.com"'))
    assert.ok(html.includes('for more'))
})

test('an unterminated code fence still renders as code', () => {
    const html = renderMarkdown('before\n```\nlet x = 1;')
    assert.ok(html.includes('<pre><code>'))
    assert.ok(html.includes('let x = 1;'))
})

test('a horizontal rule renders', () => {
    assert.ok(renderMarkdown('a\n\n---\n\nb').includes('<hr>'))
})

test('empty and nullish input render to nothing', () => {
    assert.equal(renderMarkdown(''), '')
    assert.equal(renderMarkdown(null), '')
    assert.equal(renderMarkdown(undefined), '')
})

test('a fenced block preserves internal blank lines', () => {
    const html = renderMarkdown('```\na\n\nb\n```')
    assert.ok(html.includes('a\n\nb'), html)
})
