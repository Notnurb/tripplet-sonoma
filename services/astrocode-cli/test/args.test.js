import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, helpText, versionText, FLAGS } from '../src/cli/args.js';
import { stripAnsi } from '../src/ui/text.js';

const p = (...argv) => parseArgs(argv);

test('long and short forms both work', () => {
  assert.equal(p('--model', 'taipei').flags.model, 'taipei-4');
  assert.equal(p('-m', 'taipei').flags.model, 'taipei-4');
  assert.equal(p('--model=taipei').flags.model, 'taipei-4');
  assert.equal(p('--effort', 'high').flags.effort, 'high');
  assert.equal(p('-e', 'xhigh').flags.effort, 'xhigh');
});

test('model and effort values are validated against the registries', () => {
  assert.equal(p('--model', 'nonsense').errors.length, 1);
  assert.match(p('--model', 'nonsense').errors[0], /model/i);
  assert.equal(p('--effort', 'gigantic').errors.length, 1);
  assert.equal(p('--model', 'Astro 5 Code').flags.model, 'astro-5-code');
});

test('boolean shorts cluster', () => {
  const r = p('-qv');
  assert.equal(r.flags.quiet, true);
  assert.equal(r.flags.verbose, true);
  assert.deepEqual(r.errors, []);
});

test('-- stops flag parsing', () => {
  const r = p('--model', 'astro', '--', '--not-a-flag', 'text');
  assert.deepEqual(r.positionals, ['--not-a-flag', 'text']);
  assert.deepEqual(r.errors, []);
});

test('positionals become the prompt', () => {
  assert.deepEqual(p('fix', 'the', 'bug').positionals, ['fix', 'the', 'bug']);
});

test('unknown flags suggest the nearest real one', () => {
  const r = p('--modle', 'x');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /--modle/);
  assert.match(r.errors[0], /--model/);
});

test('a flag that needs a value reports when it is missing', () => {
  const r = p('--model');
  assert.ok(r.errors.length >= 1);
  assert.match(r.errors.join(' '), /model/);
});

test('numeric flags are parsed as numbers', () => {
  assert.equal(p('--seed', '42').flags.seed, 42);
  assert.equal(typeof p('--seed', '42').flags.seed, 'number');
  assert.equal(p('--max-turns', '3').flags.maxTurns, 3);
  assert.ok(p('--seed', 'abc').errors.length >= 1);
});

test('permission mode is validated', () => {
  assert.equal(p('--permission-mode', 'plan').flags.permissionMode, 'plan');
  assert.equal(p('--yolo').flags.yolo, true);
  assert.ok(p('--permission-mode', 'whatever').errors.length >= 1);
});

test('theme is validated against the real palettes', () => {
  assert.equal(p('--theme', 'crush').flags.theme, 'crush');
  assert.ok(p('--theme', 'neon').errors.length >= 1);
});

test('--rainbow parses but is never advertised', () => {
  assert.equal(p('--rainbow').flags.rainbow, true);
  assert.deepEqual(p('--rainbow').errors, []);

  const help = stripAnsi(helpText());
  assert.ok(!/rainbow/i.test(help), 'the secret flag must not appear in --help');

  const flag = FLAGS.find((f) => f.long === 'rainbow');
  assert.ok(flag, 'the flag is still registered');
  assert.equal(flag.hidden, true);
});

test('help text covers the documented flags and the four models', () => {
  const help = stripAnsi(helpText());
  for (const f of FLAGS.filter((x) => !x.hidden)) {
    assert.ok(help.includes(`--${f.long}`), `--${f.long} documented`);
  }
  assert.match(help, /USAGE/i);
  assert.match(help, /EXAMPLES/i);
  assert.match(help, /Astro 5 Code|astro-5-code/);
});

test('version text names the product', () => {
  assert.match(versionText('9.9.9'), /Astrocode/);
  assert.match(versionText('9.9.9'), /9\.9\.9/);
});

test('an empty argv is valid', () => {
  const r = p();
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.positionals, []);
});

test('flags after positionals are still parsed', () => {
  const r = p('do', 'a', 'thing', '--model', 'suzhou');
  assert.equal(r.flags.model, 'suzhou-4');
  assert.deepEqual(r.positionals, ['do', 'a', 'thing']);
});
