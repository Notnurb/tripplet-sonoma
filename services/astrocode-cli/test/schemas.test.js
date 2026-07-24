/**
 * schemas.test.js — keeps `schemas.js` honest about `index.js`.
 *
 * A JSON Schema that describes a parameter the tool does not read, or omits one
 * it requires, fails silently at runtime: the model passes something sensible
 * and the tool ignores it. These tests read the tool source and compare, so the
 * two files cannot drift apart without a red test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOL_SCHEMAS, toolSchemas, schemaNames, unknownSchemas } from '../src/tools/schemas.js';
import { TOOLS, runTool } from '../src/tools/index.js';
import { withTempDir, writeFiles } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolSource = await fs.readFile(path.join(here, '../src/tools/index.js'), 'utf8');

test('every tool has a schema and every schema has a tool', () => {
  assert.deepEqual(unknownSchemas(), [], 'no schema names a tool that does not exist');
  const missing = Object.keys(TOOLS).filter((n) => !schemaNames().includes(n));
  assert.deepEqual(missing, [], 'no tool is hidden from the model');
});

test('each schema is a well-formed OpenAI function definition', () => {
  for (const s of TOOL_SCHEMAS) {
    assert.equal(s.type, 'function', `${s.function?.name}: type`);
    const f = s.function;
    assert.ok(f.name && typeof f.name === 'string', 'has a name');
    assert.ok(f.description && f.description.length > 20, `${f.name}: describes itself`);
    assert.equal(f.parameters.type, 'object', `${f.name}: parameters is an object schema`);
    assert.ok(f.parameters.properties, `${f.name}: has properties`);
    for (const req of f.parameters.required ?? []) {
      assert.ok(f.parameters.properties[req], `${f.name}: required "${req}" is a declared property`);
    }
    for (const [key, prop] of Object.entries(f.parameters.properties)) {
      assert.ok(prop.type, `${f.name}.${key}: has a type`);
      assert.ok(prop.description || prop.items, `${f.name}.${key}: has a description`);
    }
  }
});

/**
 * The tools read their inputs as `input.<field>`, so the source is the record
 * of what they actually accept. `edit` is the exception: it forwards to
 * `multiedit` and its fields are destructured in `applyEdit`.
 */
test('declared properties are fields the tool really reads', () => {
  const read = new Set([...toolSource.matchAll(/input\.(\w+)/g)].map((m) => m[1]));
  // applyEdit destructures these rather than reading input.* directly.
  for (const extra of ['old_string', 'new_string', 'replace_all']) read.add(extra);

  for (const s of TOOL_SCHEMAS) {
    for (const key of Object.keys(s.function.parameters.properties)) {
      assert.ok(read.has(key), `${s.function.name}.${key} is never read by any tool`);
    }
  }
});

test('toolSchemas filters by name and ignores unknown ones', () => {
  const some = toolSchemas(['read', 'bash', 'nope']);
  assert.deepEqual(some.map((s) => s.function.name), ['read', 'bash']);
  assert.equal(toolSchemas().length, TOOL_SCHEMAS.length, 'no argument means all of them');
});

test('the mutating tools are exactly the ones that need approval', () => {
  const mutating = Object.entries(TOOLS).filter(([, t]) => t.mutating).map(([n]) => n).sort();
  assert.deepEqual(mutating, ['bash', 'edit', 'multiedit', 'write'].sort());
});

/** A schema is only useful if a call built from it actually runs. */
test('a call shaped by the read schema succeeds', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'x.js': 'one\ntwo\nthree\n' });
  const res = await runTool('read', { path: 'x.js', offset: 2, limit: 1 }, { cwd: dir });
  assert.equal(res.ok, true);
  assert.equal(res.meta.content, 'two');
}));

test('a call shaped by the grep schema succeeds', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'a.js': 'const NEEDLE = 1\n', 'b.txt': 'needle\n' });
  const res = await runTool('grep', { pattern: 'needle', ignoreCase: true, glob: '*.js' }, { cwd: dir });
  assert.equal(res.ok, true);
  assert.match(JSON.stringify(res.meta), /a\.js/);
}));

test('a call shaped by the multiedit schema succeeds', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'c.js': 'alpha\nbeta\n' });
  const res = await runTool('multiedit', {
    path: 'c.js',
    edits: [
      { old_string: 'alpha', new_string: 'ALPHA' },
      { old_string: 'beta', new_string: 'BETA' },
    ],
  }, { cwd: dir });
  assert.equal(res.ok, true);
  assert.equal(await fs.readFile(path.join(dir, 'c.js'), 'utf8'), 'ALPHA\nBETA\n');
}));
