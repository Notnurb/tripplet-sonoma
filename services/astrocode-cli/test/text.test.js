import test from 'node:test';
import assert from 'node:assert/strict';

import {
  run, width, plain, wrap, wrapText, truncate, pad, center, slice,
  strWidth, graphemes, compact, toAnsi, setDepth, getDepth, DEPTH, stripAnsi,
} from '../src/ui/text.js';

test('strWidth counts terminal cells, not code points', () => {
  assert.equal(strWidth('hello'), 5);
  assert.equal(strWidth('日本語'), 6);          // CJK is double width
  assert.equal(strWidth('🚀'), 2);              // so is emoji
  assert.equal(strWidth(''), 0);
  assert.equal(strWidth('café'), 4);
});

test('graphemes keeps combining sequences together', () => {
  assert.equal(graphemes('ábc').length, 3);   // á as a + combining acute
  assert.equal(strWidth('ábc'), 3);
});

test('width and plain operate over runs', () => {
  const line = [run('ab', { fg: '#fff' }), run('日', { bold: true })];
  assert.equal(width(line), 4);
  assert.equal(plain(line), 'ab日');
});

test('pad and center reach exactly the requested width', () => {
  assert.equal(width(pad([run('ab')], 10)), 10);
  assert.equal(width(center([run('ab')], 11)), 11);
  assert.equal(width(pad([run('日本語')], 10)), 10);
  // already wider than the target is left alone
  assert.equal(width(pad([run('abcdef')], 3)), 6);
});

test('truncate never exceeds the budget, even with wide glyphs', () => {
  for (const w of [1, 2, 3, 5, 8, 13]) {
    assert.ok(width(truncate([run('日本語テスト')], w)) <= w, `width ${w}`);
    assert.ok(width(truncate([run('hello world')], w)) <= w, `width ${w}`);
  }
  assert.equal(plain(truncate([run('hello world')], 8)), 'hello w…');
  assert.deepEqual(truncate([run('hi')], 10), [run('hi')]);
});

test('slice cuts by display column', () => {
  assert.equal(plain(slice([run('abcdef')], 2, 4)), 'cd');
  assert.equal(plain(slice([run('abcdef')], 3)), 'def');
});

test('wrap breaks on spaces and respects the width', () => {
  const lines = wrapText('the quick brown fox jumps over the lazy dog', 12);
  for (const l of lines) assert.ok(width(l) <= 12, `"${plain(l)}" is ${width(l)}`);
  assert.equal(plain(lines[0]), 'the quick');
  assert.equal(lines.join('').length > 0, true);
});

test('wrap hard-breaks a word longer than the line', () => {
  const lines = wrapText('supercalifragilistic', 8);
  assert.ok(lines.length >= 3);
  for (const l of lines) assert.ok(width(l) <= 8);
  assert.equal(lines.map(plain).join(''), 'supercalifragilistic');
});

test('wrap honours indent and hanging indent', () => {
  const lines = wrap([run('alpha beta gamma delta epsilon')], 16, { indent: 2, hanging: 2 });
  assert.ok(plain(lines[0]).startsWith('  '));
  assert.ok(plain(lines[1]).startsWith('    '));
  for (const l of lines) assert.ok(width(l) <= 16);
});

test('wrap treats an explicit newline as a break', () => {
  const lines = wrapText('one\ntwo', 40);
  assert.equal(lines.length, 2);
  assert.equal(plain(lines[0]), 'one');
  assert.equal(plain(lines[1]), 'two');
});

test('wrap of empty input still yields one line', () => {
  assert.equal(wrapText('', 10).length, 1);
});

test('compact merges runs that share a style', () => {
  const c = compact([run('a', { fg: '#fff' }), run('b', { fg: '#fff' }), run('c', { fg: '#000' })]);
  assert.equal(c.length, 2);
  assert.equal(c[0].t, 'ab');
});

test('toAnsi emits nothing when colour is disabled', () => {
  const before = getDepth();
  try {
    setDepth(DEPTH.NONE);
    assert.equal(toAnsi([run('hi', { fg: '#ff0000', bold: true })]), 'hi');
    setDepth(DEPTH.TRUECOLOR);
    const s = toAnsi([run('hi', { fg: '#ff0000' })]);
    assert.match(s, /38;2;255;0;0/);
    assert.equal(stripAnsi(s), 'hi');
  } finally {
    setDepth(before);
  }
});
