/**
 * api.test.js — the client half of the Tripplet integration.
 *
 * Every test here stubs `globalThis.fetch` and points the credential store at a
 * temp file, so nothing ever reaches a real deployment. What is being checked is
 * the translation layer: statuses into `ApiError.code`, and a byte stream into
 * events — including the byte stream arriving in awkward pieces, which is the
 * case that breaks naive SSE parsers in production and never in a happy-path
 * test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ApiError, apiFetch, streamChat, fetchUsage } from '../src/core/api.js';
import { withTempDir } from './helpers.js';

/** A credential file the store will accept, valid for an hour. */
async function authFile(dir, patch = {}) {
  const file = path.join(dir, 'auth.json');
  await fs.writeFile(file, JSON.stringify({
    baseUrl: 'https://example.test',
    clientId: 'mcp_test',
    accessToken: 'tok_abc',
    refreshToken: 'ref_abc',
    expiresAt: Date.now() + 3_600_000,
    scope: 'mcp offline_access',
    email: 'user@example.test',
    signedInAt: Date.now(),
    ...patch,
  }), 'utf8');
  return file;
}

/** Swap in a fetch, restore it whatever happens. */
async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const jsonResponse = (status, body, ok = status < 400) => ({
  ok,
  status,
  text: async () => JSON.stringify(body),
});

/** A real ReadableStream of bytes, so the parser is exercised the way undici
 *  actually delivers a response body. */
function sseResponse(chunks) {
  const enc = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    }),
  };
}

test('apiFetch sends the bearer to the recorded deployment', () => withTempDir(async (dir) => {
  const file = await authFile(dir);
  let seen = null;
  await withFetch(async (url, init) => { seen = { url, init }; return jsonResponse(200, { ok: true }); }, async () => {
    await apiFetch('/api/usage', { file });
  });
  assert.equal(seen.url, 'https://example.test/api/usage');
  assert.equal(seen.init.headers.authorization, 'Bearer tok_abc');
}));

test('apiFetch without credentials is not_signed_in, not a crash', () => withTempDir(async (dir) => {
  const err = await apiFetch('/api/usage', { file: path.join(dir, 'nothing.json') }).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof ApiError);
  assert.equal(err.code, 'not_signed_in');
}));

test('apiFetch maps each failure status to a distinct code', () => withTempDir(async (dir) => {
  const file = await authFile(dir);
  const cases = [
    [401, {}, 'unauthorized'],
    [429, { code: 'usage_limit', error: 'out of messages', scope: '5-hour', resetsAt: '2026-01-01T00:00:00.000Z' }, 'usage_limit'],
    [429, { error: 'slow down' }, 'rate_limited'],
    [503, { error_description: 'no key' }, 'backend_unconfigured'],
    [500, { error: 'boom' }, 'http_error'],
  ];
  for (const [status, body, code] of cases) {
    const err = await withFetch(async () => jsonResponse(status, body), () =>
      apiFetch('/api/cli/chat', { file }).then(() => null, (e) => e));
    assert.ok(err instanceof ApiError, `${status} threw an ApiError`);
    assert.equal(err.code, code, `${status} -> ${code}`);
  }
}));

test('a usage_limit error carries the scope and reset time', () => withTempDir(async (dir) => {
  const file = await authFile(dir);
  const err = await withFetch(
    async () => jsonResponse(429, {
      code: 'usage_limit', error: 'out of messages',
      scope: 'weekly', resetsAt: '2026-01-01T00:00:00.000Z',
    }),
    () => apiFetch('/api/cli/chat', { file }).then(() => null, (e) => e),
  );
  assert.equal(err.scope, 'weekly');
  assert.equal(err.resetsAt, '2026-01-01T00:00:00.000Z');
}));

test('an unreachable server is unreachable, not an HTTP error', () => withTempDir(async (dir) => {
  const file = await authFile(dir);
  const err = await withFetch(
    async () => { throw new TypeError('fetch failed'); },
    () => apiFetch('/api/usage', { file }).then(() => null, (e) => e),
  );
  assert.equal(err.code, 'unreachable');
}));

test('streamChat parses events split across arbitrary chunks', () => withTempDir(async (dir) => {
  const file = await authFile(dir);
  // The JSON of the first event is deliberately torn in half mid-token.
  const chunks = [
    'data: {"type":"thin',
    'king","delta":"hm"}\n\ndata: {"type":"content","delta":"He',
    'llo"}\n',
    '\ndata: {"type":"done","finish":"stop"}\n\n',
  ];
  const events = await withFetch(async () => sseResponse(chunks), async () => {
    const out = [];
    for await (const ev of streamChat({ messages: [{ role: 'user', content: 'hi' }], file })) out.push(ev);
    return out;
  });
  assert.deepEqual(events, [
    { type: 'thinking', delta: 'hm' },
    { type: 'content', delta: 'Hello' },
    { type: 'done', finish: 'stop' },
  ]);
}));

test('streamChat tolerates CRLF, blank frames, [DONE] and junk', () => withTempDir(async (dir) => {
  const file = await authFile(dir);
  const chunks = [
    'data: {"type":"content","delta":"a"}\r\n',
    '\r\n',
    ': a comment line\n',
    'data: not json at all\n',
    'data: [DONE]\n',
    'data: {"type":"done","finish":"stop"}\n\n',
  ];
  const events = await withFetch(async () => sseResponse(chunks), async () => {
    const out = [];
    for await (const ev of streamChat({ messages: [{ role: 'user', content: 'hi' }], file })) out.push(ev);
    return out;
  });
  assert.deepEqual(events, [
    { type: 'content', delta: 'a' },
    { type: 'done', finish: 'stop' },
  ]);
}));

test('streamChat surfaces tool_call events with parsed args', () => withTempDir(async (dir) => {
  const file = await authFile(dir);
  const chunks = [
    'data: {"type":"tool_call","id":"c1","name":"read","args":{"path":"a.js"}}\n\n',
    'data: {"type":"done","finish":"tool_calls"}\n\n',
  ];
  const events = await withFetch(async () => sseResponse(chunks), async () => {
    const out = [];
    for await (const ev of streamChat({ messages: [{ role: 'user', content: 'hi' }], file })) out.push(ev);
    return out;
  });
  assert.equal(events[0].type, 'tool_call');
  assert.deepEqual(events[0].args, { path: 'a.js' });
  assert.equal(events[1].finish, 'tool_calls');
}));

test('streamChat only sends tools when there are some', () => withTempDir(async (dir) => {
  const file = await authFile(dir);
  const bodies = [];
  await withFetch(async (_url, init) => { bodies.push(JSON.parse(init.body)); return sseResponse([]); }, async () => {
    for await (const _ of streamChat({ messages: [{ role: 'user', content: 'x' }], file })) { /* drain */ }
    for await (const _ of streamChat({ messages: [{ role: 'user', content: 'x' }], tools: [], file })) { /* drain */ }
  });
  assert.equal('tools' in bodies[0], false, 'omitted when undefined');
  assert.equal('tools' in bodies[1], false, 'omitted when empty');
}));

// ── redirects ───────────────────────────────────────────────────────────────
// The deployments redirect their apex to `www`, and fetch drops Authorization
// on a cross-host redirect. That is what made every authenticated request
// arrive with no bearer and the CLI report "your session expired".

const redirectTo = (location, status = 307) => ({
  ok: false,
  status,
  headers: new Headers({ location }),
  text: async () => '',
});

test('the bearer survives an apex to www redirect', () => withTempDir(async (dir) => {
  const file = await authFile(dir, { baseUrl: 'https://example.test' });
  const seen = [];
  await withFetch(async (url, init) => {
    seen.push({ url, auth: init.headers?.authorization ?? null });
    if (new URL(url).host === 'example.test') return redirectTo('https://www.example.test/api/usage');
    return jsonResponse(200, {
      plan: 'free',
      fiveHour: { used: 0, limit: 25, remaining: 25, percent: 0, resetsAt: 'x', tokens: 0 },
      weekly: { used: 0, limit: 250, remaining: 250, percent: 0, resetsAt: 'x', tokens: 0 },
    });
  }, () => fetchUsage({ file }));

  assert.equal(seen.length, 2, 'it followed the redirect itself');
  assert.equal(seen[1].url, 'https://www.example.test/api/usage');
  assert.equal(seen[1].auth, 'Bearer tok_abc', 'the token reached the canonical host');
}));

test('the bearer is NOT handed to a different site', () => withTempDir(async (dir) => {
  const file = await authFile(dir, { baseUrl: 'https://offsite.test' });
  const seen = [];
  await withFetch(async (url, init) => {
    seen.push({ url, auth: init.headers?.authorization ?? null });
    if (new URL(url).host === 'offsite.test') return redirectTo('https://evil.test/api/usage');
    return jsonResponse(200, { plan: 'free' });
  }, () => fetchUsage({ file }).catch(() => null));

  const offSite = seen.find((s) => s.url.includes('evil.test'));
  assert.ok(offSite, 'the redirect was followed');
  assert.ok(!offSite.auth, 'no credential was sent to the other host');
}));

test('a redirect loop fails instead of hanging', () => withTempDir(async (dir) => {
  const file = await authFile(dir, { baseUrl: 'https://loop.test' });
  const err = await withFetch(
    async () => redirectTo('https://www.loop.test/api/usage'),
    () => fetchUsage({ file }).then(() => null, (e) => e),
  );
  assert.ok(err instanceof ApiError);
  assert.match(err.message, /too many redirects/i);
}));

test('fetchUsage rejects a summary it cannot read', () => withTempDir(async (dir) => {
  const file = await authFile(dir);
  const err = await withFetch(async () => jsonResponse(200, { plan: 'free' }), () =>
    fetchUsage({ file }).then(() => null, (e) => e));
  assert.equal(err.code, 'bad_response');
}));

test('fetchUsage returns the summary as sent', () => withTempDir(async (dir) => {
  const file = await authFile(dir);
  const summary = {
    plan: 'free',
    fiveHour: { used: 3, limit: 25, remaining: 22, percent: 12, resetsAt: '2026-01-01T00:00:00.000Z', tokens: 900 },
    weekly: { used: 3, limit: 250, remaining: 247, percent: 1, resetsAt: '2026-01-05T00:00:00.000Z', tokens: 900 },
  };
  const got = await withFetch(async () => jsonResponse(200, summary), () => fetchUsage({ file }));
  assert.deepEqual(got, summary);
}));
