/**
 * remote.test.js — the real-model engine, without a real model.
 *
 * `RemoteEngine` is only useful if it emits exactly what `app.js` already
 * knows how to render, so these tests assert on the event stream itself: the
 * order, the tool-permission handshake, and what goes back to the model after
 * a tool runs. The network is stubbed at `fetch`, one scripted SSE response
 * per round, which is also how the multi-round loop gets exercised.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { RemoteEngine, personaFor } from '../src/engine/remote.js';
import { Session } from '../src/core/session.js';
import { Permissions } from '../src/tools/permissions.js';
import { TOOLS } from '../src/tools/index.js';
import { getModel } from '../src/core/models.js';
import { withTempDir, writeFiles } from './helpers.js';

async function authFile(dir) {
  const file = path.join(dir, 'auth.json');
  await fs.writeFile(file, JSON.stringify({
    baseUrl: 'https://example.test',
    clientId: 'mcp_test',
    accessToken: 'tok_abc',
    refreshToken: 'ref_abc',
    expiresAt: Date.now() + 3_600_000,
    scope: 'mcp offline_access',
  }), 'utf8');
  return file;
}

const sse = (events) => {
  const enc = new TextEncoder();
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode(text));
        controller.close();
      },
    }),
  };
};

/**
 * Run a turn against a scripted list of rounds. Returns the events the engine
 * produced and the request bodies it sent, so a test can assert on both halves
 * of the conversation.
 */
async function runTurn(dir, rounds, { mode = 'yolo', prompt = 'do the thing', onPermission } = {}) {
  const file = await authFile(dir);
  const session = new Session({ cwd: dir, model: 'astro-5-code', effort: 'medium' });
  const permissions = new Permissions({ mode, cwd: dir });
  const engine = new RemoteEngine({ session, tools: TOOLS, permissions, theme: null, authFile: file });

  const realFetch = globalThis.fetch;
  const bodies = [];
  let round = 0;
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    const script = rounds[Math.min(round++, rounds.length - 1)];
    if (typeof script === 'function') return script();
    return sse(script);
  };

  const events = [];
  try {
    for await (const ev of engine.send(prompt, {})) {
      events.push(ev);
      if (ev.type === 'tool-permission') ev.resolve(onPermission ? onPermission(ev) : 'once');
    }
  } finally {
    globalThis.fetch = realFetch;
    await fs.rm(file, { force: true });
  }
  return { events, bodies, session };
}

const types = (events) => events.map((e) => e.type);

test('personaFor maps every CLI model to a deployment persona', () => {
  assert.equal(personaFor(getModel('astro-5-code')), 'astro-5-code');
  assert.equal(personaFor(getModel('taipei-4')), 'tura-3');
  assert.equal(personaFor(getModel('majuli-4')), 'majuli-3');
  assert.equal(personaFor(getModel('suzhou-4')), 'suzhou-3');
  assert.equal(personaFor(undefined), 'astro-5-code', 'falls back rather than sending undefined');
});

test('a text-only turn streams thinking then prose then usage', () => withTempDir(async (dir) => {
  const { events } = await runTurn(dir, [[
    { type: 'thinking', delta: 'weighing it up' },
    { type: 'content', delta: 'Here is ' },
    { type: 'content', delta: 'the answer.' },
    { type: 'done', finish: 'stop' },
  ]]);

  assert.deepEqual(types(events), [
    'start', 'thinking-delta', 'thinking-end', 'text-delta', 'text-delta', 'usage', 'done',
  ]);
  assert.equal(events.at(-1).reason, 'end');
  assert.ok(events.find((e) => e.type === 'usage').output > 0, 'output tokens were counted');
}));

test('a tool call is executed locally and its result posted back', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'a.js': 'export const a = 1\n' });
  const { events, bodies } = await runTurn(dir, [
    [
      { type: 'tool_call', id: 'call_1', name: 'read', args: { path: 'a.js' } },
      { type: 'done', finish: 'tool_calls' },
    ],
    [
      { type: 'content', delta: 'a.js exports a.' },
      { type: 'done', finish: 'stop' },
    ],
  ]);

  assert.deepEqual(types(events), [
    'start', 'tool-start', 'tool-end', 'text-delta', 'usage', 'done',
  ]);
  const end = events.find((e) => e.type === 'tool-end');
  assert.equal(end.ok, true);

  // Second request must carry the assistant/tool pair the model expects.
  assert.equal(bodies.length, 2, 'the loop made a second request');
  const sent = bodies[1].messages;
  const assistant = sent.find((m) => m.role === 'assistant' && m.tool_calls);
  assert.ok(assistant, 'an assistant message carried the tool_calls');
  assert.equal(assistant.tool_calls[0].id, 'call_1');
  assert.equal(assistant.tool_calls[0].function.name, 'read');
  assert.equal(typeof assistant.tool_calls[0].function.arguments, 'string', 'arguments is JSON text');

  const toolMsg = sent.find((m) => m.role === 'tool');
  assert.equal(toolMsg.tool_call_id, 'call_1', 'the result is tied to the call');
  assert.match(toolMsg.content, /export const a = 1/, 'the file contents went back to the model');
}));

test('a denied mutating tool stops the turn and tells the model why', () => withTempDir(async (dir) => {
  const { events, bodies } = await runTurn(dir, [
    [
      { type: 'tool_call', id: 'call_w', name: 'write', args: { path: 'new.js', content: 'x' } },
      { type: 'done', finish: 'tool_calls' },
    ],
  ], { mode: 'ask', onPermission: () => 'deny' });

  assert.deepEqual(types(events), [
    'start', 'tool-start', 'tool-permission', 'tool-end', 'text-delta', 'usage', 'done',
  ]);
  const end = events.find((e) => e.type === 'tool-end');
  assert.equal(end.ok, false);
  assert.equal(end.denied, true);
  assert.match(events.find((e) => e.type === 'text-delta').text, /not permitted/i);
  assert.equal(bodies.length, 1, 'the loop stopped instead of asking the model again');

  const written = await fs.readFile(path.join(dir, 'new.js'), 'utf8').then(() => true, () => false);
  assert.equal(written, false, 'the denied write never touched the disk');
}));

test('approving a tool once lets it run', () => withTempDir(async (dir) => {
  const { events } = await runTurn(dir, [
    [
      { type: 'tool_call', id: 'call_w', name: 'write', args: { path: 'new.js', content: 'hello\n' } },
      { type: 'done', finish: 'tool_calls' },
    ],
    [{ type: 'content', delta: 'Written.' }, { type: 'done', finish: 'stop' }],
  ], { mode: 'ask', onPermission: () => 'once' });

  assert.ok(events.some((e) => e.type === 'tool-permission'), 'it asked first');
  assert.equal(events.find((e) => e.type === 'tool-end').ok, true);
  assert.equal(await fs.readFile(path.join(dir, 'new.js'), 'utf8'), 'hello\n');
}));

test('an unknown tool is reported to the model, not thrown', () => withTempDir(async (dir) => {
  const { events, bodies } = await runTurn(dir, [
    [
      { type: 'tool_call', id: 'call_x', name: 'teleport', args: {} },
      { type: 'done', finish: 'tool_calls' },
    ],
    [{ type: 'content', delta: 'Sorry.' }, { type: 'done', finish: 'stop' }],
  ]);
  assert.equal(events.at(-1).reason, 'end');
  const toolMsg = bodies[1].messages.find((m) => m.role === 'tool');
  assert.match(toolMsg.content, /unknown tool/i);
}));

test('a usage limit ends the turn with an actionable notice', () => withTempDir(async (dir) => {
  const { events } = await runTurn(dir, [
    () => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({
        code: 'usage_limit',
        error: "You've reached your 5-hour limit of 25 messages on the free plan.",
        scope: '5-hour',
        resetsAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
      }),
    }),
  ]);

  const notice = events.find((e) => e.type === 'notice');
  assert.ok(notice, 'the user was told');
  assert.equal(notice.level, 'warn', 'a limit is not an error state');
  assert.match(notice.text, /5-hour limit/);
  assert.match(notice.text, /resets in 2h|resets in 1h/);
  assert.match(notice.text, /\/usage/);
  assert.equal(events.at(-1).type, 'done');
  assert.equal(events.at(-1).reason, 'error');
}));

test('a mid-stream error event reaches the user', () => withTempDir(async (dir) => {
  const { events } = await runTurn(dir, [[
    { type: 'error', message: 'The model backend returned an error (502).' },
    { type: 'done', finish: 'stop' },
  ]]);
  const notice = events.find((e) => e.type === 'notice');
  assert.match(notice.text, /502/);
  assert.equal(notice.level, 'error');
}));

test('the request carries a system prompt, the cwd and the tool schemas', () => withTempDir(async (dir) => {
  const { bodies } = await runTurn(dir, [[{ type: 'content', delta: 'ok' }, { type: 'done', finish: 'stop' }]]);
  const body = bodies[0];
  assert.equal(body.model, 'astro-5-code');
  assert.equal(body.messages[0].role, 'system');
  assert.ok(body.messages[0].content.includes(dir), 'the model is told where it is working');
  assert.equal(body.messages.at(-1).role, 'user');
  assert.ok(body.tools.length >= 9, 'every tool was offered');
  assert.ok(body.tools.every((t) => t.type === 'function' && t.function?.name), 'tools are OpenAI-shaped');
}));

test('prior turns are replayed as history', () => withTempDir(async (dir) => {
  const file = await authFile(dir);
  const session = new Session({ cwd: dir, model: 'taipei-4' });
  session.user('first question');
  const answer = session.assistant();
  answer.text = 'first answer';

  const engine = new RemoteEngine({
    session, tools: TOOLS, permissions: new Permissions({ mode: 'yolo', cwd: dir }), theme: null, authFile: file,
  });

  const realFetch = globalThis.fetch;
  let body = null;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return sse([{ type: 'content', delta: 'second answer' }, { type: 'done', finish: 'stop' }]);
  };
  try {
    for await (const _ of engine.send('second question', {})) { /* drain */ }
  } finally {
    globalThis.fetch = realFetch;
    await fs.rm(file, { force: true });
  }

  const roles = body.messages.map((m) => `${m.role}:${m.content}`);
  assert.deepEqual(roles, [
    `system:${body.messages[0].content}`,
    'user:first question',
    'assistant:first answer',
    'user:second question',
  ]);
  assert.equal(body.model, 'tura-3', 'the session model chose the persona');
}));
