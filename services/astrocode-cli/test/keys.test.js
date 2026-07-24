import test from 'node:test';
import assert from 'node:assert/strict';

import { KeyDecoder, describe as describeKey, isPrintable, charOf } from '../src/ui/keys.js';

const decode = (s) => new KeyDecoder().push(s);

test('plain characters decode as themselves', () => {
  const evs = decode('abc');
  assert.equal(evs.length, 3);
  assert.deepEqual(evs.map((e) => e.name), ['a', 'b', 'c']);
  assert.ok(evs.every(isPrintable));
});

test('control characters decode with the ctrl flag', () => {
  const [c] = decode('\x03');
  assert.equal(c.name, 'c');
  assert.equal(c.ctrl, true);
  assert.equal(describeKey(c), 'ctrl+c');
  assert.equal(isPrintable(c), false);
});

test('named keys', () => {
  assert.equal(decode('\r')[0].name, 'return');
  assert.equal(decode('\n')[0].name, 'return');
  assert.equal(decode('\t')[0].name, 'tab');
  assert.equal(decode('\x7f')[0].name, 'backspace');
  assert.equal(decode(' ')[0].name, 'space');
  assert.equal(charOf(decode(' ')[0]), ' ');
});

test('arrow keys and modifiers', () => {
  assert.equal(decode('\x1b[A')[0].name, 'up');
  assert.equal(decode('\x1b[B')[0].name, 'down');
  assert.equal(decode('\x1b[C')[0].name, 'right');
  assert.equal(decode('\x1b[D')[0].name, 'left');

  const ctrlUp = decode('\x1b[1;5A')[0];
  assert.equal(ctrlUp.name, 'up');
  assert.equal(ctrlUp.ctrl, true);

  const shiftTab = decode('\x1b[Z')[0];
  assert.equal(shiftTab.name, 'tab');
  assert.equal(shiftTab.shift, true);
});

test('navigation and function keys', () => {
  assert.equal(decode('\x1b[3~')[0].name, 'delete');
  assert.equal(decode('\x1b[5~')[0].name, 'pageup');
  assert.equal(decode('\x1b[6~')[0].name, 'pagedown');
  assert.equal(decode('\x1b[H')[0].name, 'home');
  assert.equal(decode('\x1b[F')[0].name, 'end');
  assert.equal(decode('\x1b[15~')[0].name, 'f5');
});

test('alt combinations', () => {
  const ev = decode('\x1bb')[0];
  assert.equal(ev.name, 'b');
  assert.equal(ev.alt, true);
  assert.equal(describeKey(ev), 'alt+b');
});

test('bracketed paste arrives as a single event', () => {
  const evs = decode('\x1b[200~hello\nworld\x1b[201~');
  assert.equal(evs.length, 1);
  assert.equal(evs[0].type, 'paste');
  assert.equal(evs[0].text, 'hello\nworld');
});

test('a paste split across chunks is reassembled', () => {
  const d = new KeyDecoder();
  assert.deepEqual(d.push('\x1b[200~par'), []);
  assert.deepEqual(d.push('tial'), []);
  const evs = d.push(' text\x1b[201~');
  assert.equal(evs.length, 1);
  assert.equal(evs[0].text, 'partial text');
});

test('an incomplete escape sequence waits for the rest', () => {
  const d = new KeyDecoder();
  assert.deepEqual(d.push('\x1b['), []);
  const evs = d.push('A');
  assert.equal(evs.length, 1);
  assert.equal(evs[0].name, 'up');
});

test('multi-byte characters survive decoding', () => {
  const evs = decode('日🚀');
  assert.equal(evs.length, 2);
  assert.equal(evs[0].name, '日');
  assert.equal(evs[1].name, '🚀');
});
