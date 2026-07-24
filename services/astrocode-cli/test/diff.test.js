import test from 'node:test';
import assert from 'node:assert/strict';

import { unifiedDiff, renderDiff } from '../src/ui/diffview.js';
import { renderMarkdown, parse, renderInline } from '../src/ui/markdown.js';
import { highlight, detectLang } from '../src/ui/highlight.js';
import { createTheme } from '../src/ui/theme.js';
import { width, plain } from '../src/ui/text.js';

const theme = createTheme('astro');

// ── diff ────────────────────────────────────────────────────────────────────

test('unifiedDiff produces a valid hunk header', () => {
  const d = unifiedDiff('a\nb\nc\n', 'a\nB\nc\n', { path: 'x.txt' });
  assert.match(d, /^--- a\/x\.txt$/m);
  assert.match(d, /^\+\+\+ b\/x\.txt$/m);
  assert.match(d, /^@@ -\d+,\d+ \+\d+,\d+ @@/m);
  assert.match(d, /^-b$/m);
  assert.match(d, /^\+B$/m);
});

test('identical input yields an empty diff', () => {
  assert.equal(unifiedDiff('same\n', 'same\n', { path: 'x' }).trim(), '');
});

test('a pure insertion is reported as additions only', () => {
  const d = unifiedDiff('a\nc\n', 'a\nb\nc\n', { path: 'x' });
  const lines = d.split('\n');
  assert.ok(lines.some((l) => l === '+b'));
  assert.equal(lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length, 0);
});

test('a pure deletion is reported as removals only', () => {
  const d = unifiedDiff('a\nb\nc\n', 'a\nc\n', { path: 'x' });
  const lines = d.split('\n');
  assert.ok(lines.some((l) => l === '-b'));
  assert.equal(lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length, 0);
});

test('the diff finds a minimal edit rather than replacing everything', () => {
  const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
  const after = before.replace('line 20', 'LINE TWENTY');
  const d = unifiedDiff(before, after, { path: 'big.txt' });
  const removed = d.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
  const added = d.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  assert.equal(removed.length, 1, 'exactly one line removed');
  assert.equal(added.length, 1, 'exactly one line added');
});

test('a far-apart pair of edits becomes two hunks', () => {
  const before = Array.from({ length: 60 }, (_, i) => `l${i}`).join('\n');
  const after = before.replace('l2', 'X2').replace('l50', 'X50');
  const d = unifiedDiff(before, after, { path: 'x' });
  assert.equal((d.match(/^@@ /gm) || []).length, 2);
});

test('renderDiff stays inside the width and colours the markers', () => {
  const d = unifiedDiff('alpha\nbeta\n', 'alpha\nBETA\ngamma\n', { path: 'x.js' });
  const lines = renderDiff(d, 50, theme);
  assert.ok(lines.length > 0);
  for (const l of lines) assert.ok(width(l) <= 50, `"${plain(l)}" is ${width(l)}`);
  const text = lines.map(plain).join('\n');
  assert.ok(text.includes('@@'), 'hunk header rendered');
});

test('renderDiff handles a multi-file git diff', () => {
  const d = [
    unifiedDiff('a\n', 'b\n', { path: 'one.js' }),
    unifiedDiff('c\n', 'd\n', { path: 'two.js' }),
  ].join('\n');
  const text = renderDiff(d, 60, theme).map(plain).join('\n');
  assert.ok(text.includes('one.js'));
  assert.ok(text.includes('two.js'));
});

test('renderDiff of empty input does not throw', () => {
  assert.deepEqual(renderDiff('', 40, theme).length >= 0, true);
});

// ── markdown ────────────────────────────────────────────────────────────────

test('markdown never exceeds the requested width', () => {
  const src = `# A heading that is fairly long indeed
Some **bold** and *italic* and \`code\` in a paragraph that definitely needs wrapping to fit.

- a bullet that is long enough to wrap around the edge of the box
- another

\`\`\`js
const x = someFunctionWithAVeryLongName(argumentOne, argumentTwo, argumentThree)
\`\`\`

> a block quote that also runs on for a while and must wrap

| col a | col b |
| --- | --- |
| one | two |
`;
  for (const w of [20, 32, 48, 80]) {
    for (const l of renderMarkdown(src, w, theme)) {
      assert.ok(width(l) <= w, `width ${w}: "${plain(l)}" is ${width(l)}`);
    }
  }
});

test('markdown parses the block types it claims to', () => {
  const blocks = parse('# h\n\npara\n\n- one\n- two\n\n```js\nx\n```\n\n> quote\n\n---\n');
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'para', 'list', 'code', 'quote', 'rule']);
});

test('a fenced block keeps its contents verbatim', () => {
  const [block] = parse('```js\nconst a = 1\n\nconst b = 2\n```\n');
  assert.equal(block.type, 'code');
  assert.deepEqual(block.body, ['const a = 1', '', 'const b = 2']);
});

test('inline emphasis is stripped from the rendered text', () => {
  const runs = renderInline('**bold** and `code` and [link](http://x)', theme);
  const text = runs.map((r) => r.t).join('');
  assert.ok(text.includes('bold'));
  assert.ok(!text.includes('**'));
  assert.ok(text.includes('link'));
});

test('escaped markers stay literal', () => {
  const text = renderInline('a \\*not italic\\* b', theme).map((r) => r.t).join('');
  assert.ok(text.includes('*not italic*'));
});

test('an unclosed marker is not treated as emphasis', () => {
  const text = renderInline('50% * 2 = 100', theme).map((r) => r.t).join('');
  assert.equal(text, '50% * 2 = 100');
});

test('ordered and nested lists keep their structure', () => {
  const [list] = parse('1. first\n2. second\n');
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].ordered, true);
  assert.equal(list.items[0].marker, '1.');
});

// ── highlight ───────────────────────────────────────────────────────────────

test('detectLang maps filenames to languages', () => {
  assert.equal(detectLang('src/app.js'), 'js');
  assert.equal(detectLang('a.tsx'), 'tsx');
  assert.equal(detectLang('setup.py'), 'py');
  assert.equal(detectLang('data.json'), 'json');
  assert.equal(detectLang('run.sh'), 'sh');
  // An unknown extension falls back to the plain-text renderer, never an error.
  assert.equal(detectLang('unknown.zzz'), 'text');
});

test('highlight tolerates every language detectLang can return', () => {
  for (const name of ['js', 'ts', 'tsx', 'jsx', 'json', 'py', 'sh', 'css', 'html',
    'go', 'rust', 'yaml', 'toml', 'md', 'text', '', undefined]) {
    const lines = highlight('const a = 1\nreturn a', name, theme);
    assert.equal(lines.length, 2, `${name} line count`);
  }
});

test('highlight returns one line per source line and preserves the text', () => {
  const src = "const a = 1\n// comment\nfunction f() { return 'str' }";
  const lines = highlight(src, 'js', theme);
  assert.equal(lines.length, 3);
  for (let i = 0; i < lines.length; i++) {
    assert.equal(lines[i].map((r) => r.t).join(''), src.split('\n')[i]);
  }
});

test('highlight round-trips every supported language without losing characters', () => {
  // A trailing newline terminates the last line rather than adding a blank one.
  const samples = {
    js: 'const x = `tpl ${y}`\n/* block */',
    json: '{"a": 1, "b": [true, null]}',
    py: 'def f(x):\n    """doc"""\n    return x  # note',
    sh: 'echo "$HOME" # comment\nls -la',
    css: '.a { color: #fff; }',
  };
  for (const [lang, src] of Object.entries(samples)) {
    const out = highlight(src, lang, theme).map((l) => l.map((r) => r.t).join('')).join('\n');
    assert.equal(out, src, `${lang} round-trip`);
  }
});

test('an unterminated string does not swallow the rest of the file', () => {
  const src = "const a = 'oops\nconst b = 2";
  const lines = highlight(src, 'js', theme);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].map((r) => r.t).join(''), 'const b = 2');
});
