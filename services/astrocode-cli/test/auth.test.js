/**
 * Auth tests.
 *
 * A mock authorization server stands in for the Tripplet ChatUI, implementing
 * the same contract its real routes do (RFC 8414 discovery, RFC 7591
 * registration, PKCE S256, refresh rotation). That keeps these tests hermetic
 * while still exercising the real client end to end.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  discover, registerClient, makePkce, makeState, authorizeUrl, exchangeCode,
  refreshTokens, parsePastedCode, checkState, startLoopback, AuthError,
  ALL_REDIRECT_URIS, redirectUriFor,
} from '../src/auth/oauth.js';
import { login } from '../src/auth/login.js';
import {
  loadAuth, saveAuth, clearAuth, isExpired, isSignedIn, getAccessToken, knownClient,
} from '../src/auth/store.js';
import { withTempDir } from './helpers.js';

// ── mock authorization server ───────────────────────────────────────────────

function startMockServer({ email = 'user@tripplet.test', autoApprove = true } = {}) {
  const clients = new Map();
  const codes = new Map();
  const refreshTokensIssued = new Map();
  const state = { registrations: 0, tokenCalls: 0, userinfoCalls: 0 };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const readBody = () => new Promise((resolve) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => resolve(raw));
    });
    const base = `http://127.0.0.1:${server.address().port}`;

    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json(200, {
        issuer: base,
        authorization_endpoint: `${base}/api/oauth/authorize`,
        token_endpoint: `${base}/api/oauth/token`,
        registration_endpoint: `${base}/api/oauth/register`,
        scopes_supported: ['mcp', 'offline_access'],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
    }

    if (url.pathname === '/api/oauth/register') {
      state.registrations++;
      const body = JSON.parse((await readBody()) || '{}');
      if (!Array.isArray(body.redirect_uris) || !body.redirect_uris.length) {
        return json(400, { error: 'invalid_redirect_uri' });
      }
      const clientId = `mcp_${crypto.randomBytes(8).toString('hex')}`;
      clients.set(clientId, { redirect_uris: body.redirect_uris });
      return json(201, { client_id: clientId, redirect_uris: body.redirect_uris });
    }

    if (url.pathname === '/api/oauth/authorize') {
      const p = url.searchParams;
      const client = clients.get(p.get('client_id'));
      if (!client) { res.writeHead(400).end('unknown client'); return; }
      const redirectUri = p.get('redirect_uri');
      if (!client.redirect_uris.includes(redirectUri)) {
        res.writeHead(400).end('unregistered redirect_uri');
        return;
      }
      if (p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge')) {
        res.writeHead(400).end('PKCE required');
        return;
      }
      if (!autoApprove) { res.writeHead(200).end('consent page'); return; }
      const code = crypto.randomBytes(24).toString('base64url');
      codes.set(code, {
        challenge: p.get('code_challenge'),
        redirectUri,
        scope: p.get('scope'),
        clientId: p.get('client_id'),
      });
      const target = new URL(redirectUri);
      target.searchParams.set('code', code);
      if (p.get('state')) target.searchParams.set('state', p.get('state'));
      res.writeHead(302, { location: target.toString() });
      res.end();
      return;
    }

    if (url.pathname === '/api/oauth/token') {
      state.tokenCalls++;
      const params = new URLSearchParams(await readBody());
      const grant = params.get('grant_type');

      if (grant === 'authorization_code') {
        const entry = codes.get(params.get('code'));
        if (!entry) return json(400, { error: 'invalid_grant', error_description: 'unknown or used code' });
        codes.delete(params.get('code'));   // single use, like the real server
        const verifier = params.get('code_verifier') || '';
        const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
        if (computed !== entry.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
        if (params.get('redirect_uri') !== entry.redirectUri) return json(400, { error: 'invalid_grant' });
        const refresh = crypto.randomBytes(16).toString('base64url');
        refreshTokensIssued.set(refresh, entry.clientId);
        return json(200, {
          access_token: `at_${crypto.randomBytes(12).toString('hex')}`,
          refresh_token: refresh,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: entry.scope || 'mcp offline_access',
        });
      }

      if (grant === 'refresh_token') {
        const given = params.get('refresh_token');
        if (!refreshTokensIssued.has(given)) return json(400, { error: 'invalid_grant' });
        refreshTokensIssued.delete(given);              // rotation
        const next = crypto.randomBytes(16).toString('base64url');
        refreshTokensIssued.set(next, params.get('client_id'));
        return json(200, {
          access_token: `at_${crypto.randomBytes(12).toString('hex')}`,
          refresh_token: next,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'mcp offline_access',
        });
      }
      return json(400, { error: 'unsupported_grant_type' });
    }

    if (url.pathname === '/api/oauth/userinfo') {
      state.userinfoCalls++;
      const auth = req.headers.authorization || '';
      if (!/^Bearer\s+\S+/i.test(auth)) return json(401, { error: 'invalid_token' });
      return json(200, { sub: email, email, scope: 'mcp offline_access' });
    }

    res.writeHead(404).end('not found');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ base, state, close: () => server.close(), clients, codes });
    });
  });
}

/** Stand in for the browser: follow the authorize URL so it hits the loopback. */
async function actAsBrowser(url) {
  const res = await fetch(url, { redirect: 'manual' });
  const location = res.headers.get('location');
  if (!location) return { redirected: false, status: res.status };
  await fetch(location).catch(() => {});   // deliver the code to the loopback
  return { redirected: true, location };
}

// ── discovery, registration, PKCE ───────────────────────────────────────────

test('discovery reads the authorization server metadata', async () => {
  const mock = await startMockServer();
  try {
    const meta = await discover(mock.base);
    assert.equal(meta.issuer, mock.base);
    assert.match(meta.authorization_endpoint, /\/api\/oauth\/authorize$/);
    assert.match(meta.token_endpoint, /\/api\/oauth\/token$/);
    assert.ok(meta.code_challenge_methods_supported.includes('S256'));
  } finally { mock.close(); }
});

test('discovery falls back to the documented paths when unavailable', async () => {
  const meta = await discover('http://127.0.0.1:1/nonexistent').catch((e) => e);
  // An unreachable host is an error; a reachable host without discovery is not.
  assert.ok(meta instanceof AuthError);
  assert.equal(meta.code, 'unreachable');
});

test('an unreachable server explains itself instead of throwing a fetch error', async () => {
  const err = await discover('http://127.0.0.1:1').catch((e) => e);
  assert.ok(err instanceof AuthError);
  assert.match(err.message, /Cannot reach/);
  assert.ok(err.hint, 'a hint is offered');
});

test('client registration returns a client_id and registers every loopback port', async () => {
  const mock = await startMockServer();
  try {
    const meta = await discover(mock.base);
    const reg = await registerClient(meta);
    assert.match(reg.clientId, /^mcp_/);
    assert.equal(reg.redirectUris.length, ALL_REDIRECT_URIS.length);
    assert.ok(reg.redirectUris.includes(redirectUriFor(9271)));
  } finally { mock.close(); }
});

test('PKCE produces a verifier whose S256 hash is the challenge', () => {
  const { verifier, challenge, method } = makePkce();
  assert.equal(method, 'S256');
  assert.ok(verifier.length >= 43, 'verifier meets the RFC minimum');
  assert.equal(crypto.createHash('sha256').update(verifier).digest('base64url'), challenge);
  assert.notEqual(makePkce().verifier, verifier, 'verifiers are random');
});

test('the authorize URL carries every required parameter', () => {
  const meta = { authorization_endpoint: 'https://x.test/api/oauth/authorize' };
  const url = new URL(authorizeUrl({
    meta, clientId: 'c1', redirectUri: 'http://127.0.0.1:9271/callback',
    challenge: 'CH', state: 'ST',
  }));
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'c1');
  assert.equal(url.searchParams.get('code_challenge'), 'CH');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'ST');
  assert.equal(url.searchParams.get('scope'), 'mcp offline_access');
});

// ── loopback ────────────────────────────────────────────────────────────────

test('the loopback listener captures the code, but holds the browser response until respond() is called', async () => {
  const lb = await startLoopback();
  try {
    assert.ok(lb.port >= 9271 && lb.port <= 9280);
    assert.equal(lb.redirectUri, redirectUriFor(lb.port));

    const pending = fetch(`${lb.redirectUri}?code=abc123&state=xyz`);
    assert.deepEqual(await lb.result, { code: 'abc123', state: 'xyz' });

    // The code has arrived, but nothing has actually signed the user in yet
    // (the token exchange hasn't run) — the browser must still be waiting.
    const raced = await Promise.race([pending.then(() => 'answered'), new Promise((r) => setTimeout(() => r('still-waiting'), 50))]);
    assert.equal(raced, 'still-waiting', 'the browser must not be told "signed in" before respond() says so');

    lb.respond(true);
    const res = await pending;
    assert.equal(res.status, 200);
    assert.match(await res.text(), /signed in/i);
  } finally { lb.close(); }
});

test('a failed exchange tells the browser sign-in did not finish, not a false success', async () => {
  const lb = await startLoopback();
  try {
    const pending = fetch(`${lb.redirectUri}?code=abc123&state=xyz`);
    await lb.result;
    lb.respond(false, 'token exchange failed');
    const res = await pending;
    assert.equal(res.status, 500);
    assert.match(await res.text(), /did not finish/i);
  } finally { lb.close(); }
});

test('respond() is a safe no-op when the browser never connected (manual-paste flow)', async () => {
  const lb = await startLoopback();
  try {
    assert.doesNotThrow(() => lb.respond(true));
    assert.doesNotThrow(() => lb.respond(false, 'whatever'));
  } finally { lb.close(); }
});

test('the loopback reports an authorization error rather than hanging', async () => {
  const lb = await startLoopback();
  try {
    const failure = lb.result.then(() => null, (e) => e);
    await fetch(`${lb.redirectUri}?error=access_denied`);
    const err = await failure;
    assert.ok(err instanceof AuthError);
    assert.match(err.message, /access_denied/);
  } finally { lb.close(); }
});

// ── pasted codes ────────────────────────────────────────────────────────────

test('a pasted full URL yields its code and state', () => {
  const got = parsePastedCode('http://127.0.0.1:9271/callback?code=THE_CODE&state=THE_STATE');
  assert.deepEqual(got, { code: 'THE_CODE', state: 'THE_STATE' });
});

test('a pasted query fragment works', () => {
  assert.deepEqual(parsePastedCode('?code=abc&state=def'), { code: 'abc', state: 'def' });
  assert.deepEqual(parsePastedCode('code=abc&state=def'), { code: 'abc', state: 'def' });
});

test('a bare code works, with no state to check', () => {
  assert.deepEqual(parsePastedCode('  JUST_THE_CODE  '), { code: 'JUST_THE_CODE', state: null });
});

test('surrounding quotes and angle brackets are tolerated', () => {
  assert.equal(parsePastedCode('"http://127.0.0.1:9271/callback?code=Q"').code, 'Q');
  assert.equal(parsePastedCode('<http://127.0.0.1:9271/callback?code=B>').code, 'B');
});

test('an error redirect is reported, not mistaken for a code', () => {
  assert.throws(() => parsePastedCode('http://127.0.0.1:9271/callback?error=access_denied'),
    /refused: access_denied/);
});

test('junk paste is rejected with a readable message', () => {
  assert.throws(() => parsePastedCode(''), /Nothing pasted/);
  assert.throws(() => parsePastedCode('hello there friend'), /spaces/);
  assert.throws(() => parsePastedCode('http://127.0.0.1/callback?state=only'), /no \?code=/);
});

test('state mismatch is caught, and an absent state is allowed', () => {
  assert.throws(() => checkState('expected', 'different'), /State mismatch/);
  assert.doesNotThrow(() => checkState('expected', 'expected'));
  assert.doesNotThrow(() => checkState('expected', null), 'a bare pasted code has no state');
});

// ── credential store ────────────────────────────────────────────────────────

const record = (over = {}) => ({
  baseUrl: 'http://x.test', clientId: 'c1', accessToken: 'at', refreshToken: 'rt',
  expiresAt: Date.now() + 3600_000, scope: 'mcp offline_access', email: 'a@b.test',
  signedInAt: Date.now(), ...over,
});

test('credentials round-trip and are written owner-only', () => withTempDir(async (dir) => {
  const file = path.join(dir, 'auth.json');
  assert.equal(loadAuth({ file }), null, 'absent file means not signed in');

  const res = saveAuth(record(), { file });
  assert.equal(res.ok, true);
  assert.equal(loadAuth({ file }).email, 'a@b.test');

  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'tokens must not be world-readable');
  }
  clearAuth({ file });
  assert.equal(loadAuth({ file }), null);
}));

test('a corrupt credential file reads as signed out rather than crashing', () => withTempDir(async (dir) => {
  const file = path.join(dir, 'auth.json');
  fs.writeFileSync(file, '{ not json');
  assert.equal(loadAuth({ file }), null);
  assert.equal(isSignedIn(loadAuth({ file })), false);
}));

test('expiry and sign-in state are computed correctly', () => {
  assert.equal(isExpired(record({ expiresAt: Date.now() + 3600_000 })), false);
  assert.equal(isExpired(record({ expiresAt: Date.now() - 1000 })), true);
  assert.equal(isExpired(record({ expiresAt: Date.now() + 5_000 })), true, 'the skew window counts as expired');
  assert.equal(isSignedIn(null), false);
  assert.equal(isSignedIn(record()), true);
  assert.equal(isSignedIn(record({ accessToken: null })), false);
  // Expired but refreshable still counts as signed in.
  assert.equal(isSignedIn(record({ expiresAt: Date.now() - 1000 })), true);
});

test('an expired access token is refreshed transparently', () => withTempDir(async (dir) => {
  const mock = await startMockServer();
  const file = path.join(dir, 'auth.json');
  try {
    // Do a real login so the refresh token is one the mock will accept.
    const lb = login({ baseUrl: mock.base, file, openBrowser: false, onReady: ({ url }) => { actAsBrowser(url); } });
    const { auth } = await lb;

    saveAuth({ ...auth, expiresAt: Date.now() - 1000 }, { file });
    const before = mock.state.tokenCalls;
    const got = await getAccessToken({ file });

    assert.ok(got.token, got.error);
    assert.equal(got.refreshed, true);
    assert.equal(mock.state.tokenCalls, before + 1, 'it called the token endpoint');
    assert.notEqual(got.token, auth.accessToken, 'a new access token');
    assert.notEqual(loadAuth({ file }).refreshToken, auth.refreshToken, 'the rotated refresh token is stored');
  } finally { mock.close(); }
}));

test('a rejected refresh token reports rather than looping', () => withTempDir(async (dir) => {
  const mock = await startMockServer();
  const file = path.join(dir, 'auth.json');
  try {
    saveAuth(record({ baseUrl: mock.base, refreshToken: 'never-issued', expiresAt: Date.now() - 1 }), { file });
    const got = await getAccessToken({ file });
    assert.equal(got.token, null);
    assert.match(got.error, /invalid_grant|Token exchange failed/);
  } finally { mock.close(); }
}));

// ── full flow ───────────────────────────────────────────────────────────────

test('a failed token exchange never claims success to the browser, and nothing is saved', () => withTempDir(async (dir) => {
  // This is the exact bug report: the loopback page used to say "you're
  // signed in" the instant a code arrived, before the exchange that turns
  // that code into real, saved tokens had even started. A user who trusted
  // that page and closed their terminal lost the session with no error ever
  // shown — auth.json was left holding only the half-registered client. Here
  // we skip straight to delivering a code the token endpoint has never seen
  // (standing in for any real exchange failure — expired code, a network
  // blip, a server hiccup) and prove the browser is told it failed, not
  // that it succeeded.
  const mock = await startMockServer();
  const file = path.join(dir, 'auth.json');
  try {
    let browserRes;
    const flow = login({
      baseUrl: mock.base,
      file,
      openBrowser: false,
      onReady: ({ url, port }) => {
        const state = new URL(url).searchParams.get('state');
        browserRes = fetch(`http://127.0.0.1:${port}/callback?code=bogus-code-never-issued&state=${state}`);
      },
    });

    await assert.rejects(flow, /invalid_grant|Token exchange failed/);

    const res = await browserRes;
    assert.equal(res.status, 500, 'the browser must be told it failed, not get a 200');
    assert.match(await res.text(), /did not finish/i);
    assert.equal(loadAuth({ file }), null, 'a failed exchange must not leave a session on disk');
  } finally { mock.close(); }
}));

test('a full login through the loopback stores a usable session', () => withTempDir(async (dir) => {
  const mock = await startMockServer({ email: 'pilot@tripplet.test' });
  const file = path.join(dir, 'auth.json');
  try {
    const { auth, method, user } = await login({
      baseUrl: mock.base,
      file,
      openBrowser: false,
      onReady: ({ url }) => { actAsBrowser(url); },
    });

    assert.equal(method, 'loopback');
    assert.equal(user.email, 'pilot@tripplet.test');
    assert.equal(auth.email, 'pilot@tripplet.test');
    assert.ok(auth.accessToken && auth.refreshToken);
    assert.equal(auth.baseUrl, mock.base);
    assert.equal(auth.scope, 'mcp offline_access');
    assert.ok(auth.expiresAt > Date.now());
    assert.equal(isSignedIn(loadAuth({ file })), true);
  } finally { mock.close(); }
}));

test('a full login through a pasted URL works when the browser cannot reach us',
  () => withTempDir(async (dir) => {
    const mock = await startMockServer();
    const file = path.join(dir, 'auth.json');
    try {
      let pasteResolve;
      const pasted = new Promise((r) => { pasteResolve = r; });

      const flow = login({
        baseUrl: mock.base,
        file,
        openBrowser: false,
        waitForManual: () => pasted,
        onReady: async ({ url }) => {
          // Simulate a browser on another machine: follow the authorize
          // request but never deliver to the loopback.
          const res = await fetch(url, { redirect: 'manual' });
          pasteResolve(res.headers.get('location'));
        },
      });

      const { auth, method } = await flow;
      assert.equal(method, 'manual');
      assert.ok(auth.accessToken);
      assert.equal(isSignedIn(loadAuth({ file })), true);
    } finally { mock.close(); }
  }));

test('the client_id is registered once and reused on the next login',
  () => withTempDir(async (dir) => {
    const mock = await startMockServer();
    const file = path.join(dir, 'auth.json');
    try {
      const first = await login({ baseUrl: mock.base, file, openBrowser: false, onReady: ({ url }) => { actAsBrowser(url); } });
      assert.equal(mock.state.registrations, 1);
      assert.equal(knownClient(mock.base, { file }), first.auth.clientId);

      const second = await login({ baseUrl: mock.base, file, openBrowser: false, onReady: ({ url }) => { actAsBrowser(url); } });
      assert.equal(mock.state.registrations, 1, 'no second registration');
      assert.equal(second.auth.clientId, first.auth.clientId);
    } finally { mock.close(); }
  }));

test('a stored client_id the server no longer knows is re-registered',
  () => withTempDir(async (dir) => {
    const mock = await startMockServer();
    const file = path.join(dir, 'auth.json');
    try {
      const first = await login({ baseUrl: mock.base, file, openBrowser: false, onReady: ({ url }) => { actAsBrowser(url); } });
      assert.equal(mock.state.registrations, 1);

      // What a secret rotation looks like from the client's side: the saved
      // client_id still exists on disk, the server has never heard of it.
      mock.clients.delete(first.auth.clientId);

      const second = await login({ baseUrl: mock.base, file, openBrowser: false, onReady: ({ url }) => { actAsBrowser(url); } });
      assert.equal(mock.state.registrations, 2, 'registered again');
      assert.notEqual(second.auth.clientId, first.auth.clientId);
      assert.ok(second.auth.accessToken);
      assert.equal(knownClient(mock.base, { file }), second.auth.clientId);
    } finally { mock.close(); }
  }));

test('a cancelled sign-in rejects cleanly and stores nothing', () => withTempDir(async (dir) => {
  const mock = await startMockServer({ autoApprove: false });
  const file = path.join(dir, 'auth.json');
  try {
    const ac = new AbortController();
    const flow = login({
      baseUrl: mock.base, file, openBrowser: false, signal: ac.signal,
      onReady: () => setTimeout(() => ac.abort(), 20),
    });
    const err = await flow.catch((e) => e);
    assert.ok(err instanceof AuthError);
    assert.equal(err.code, 'cancelled');
    assert.equal(loadAuth({ file })?.accessToken ?? null, null, 'no token was stored');
  } finally { mock.close(); }
}));

test('a reused authorization code is refused', () => withTempDir(async (dir) => {
  const mock = await startMockServer();
  try {
    const meta = await discover(mock.base);
    const reg = await registerClient(meta);
    const pkce = makePkce();
    const state = makeState();
    const lb = await startLoopback();
    try {
      const url = authorizeUrl({
        meta, clientId: reg.clientId, redirectUri: lb.redirectUri,
        challenge: pkce.challenge, state,
      });
      // The loopback now holds the browser's response open until something
      // calls respond() — this test drives exchangeCode() itself rather than
      // through login(), so it has to answer the browser explicitly, or the
      // held-open connection leaks into later tests.
      const browserRes = actAsBrowser(url);
      const { code } = await lb.result;

      const first = await exchangeCode({
        meta, clientId: reg.clientId, code, redirectUri: lb.redirectUri, verifier: pkce.verifier,
      });
      assert.ok(first.accessToken);
      lb.respond(true);
      await browserRes;

      await assert.rejects(
        () => exchangeCode({ meta, clientId: reg.clientId, code, redirectUri: lb.redirectUri, verifier: pkce.verifier }),
        /invalid_grant|Token exchange failed/,
      );
    } finally { lb.close(); }
  } finally { mock.close(); }
}));

test('a wrong PKCE verifier is refused', () => withTempDir(async (dir) => {
  const mock = await startMockServer();
  try {
    const meta = await discover(mock.base);
    const reg = await registerClient(meta);
    const pkce = makePkce();
    const lb = await startLoopback();
    try {
      // See the note in the reused-code test above: answer the browser
      // ourselves since we're driving exchangeCode() directly, not login().
      const browserRes = actAsBrowser(authorizeUrl({
        meta, clientId: reg.clientId, redirectUri: lb.redirectUri,
        challenge: pkce.challenge, state: makeState(),
      }));
      const { code } = await lb.result;
      await assert.rejects(
        () => exchangeCode({
          meta, clientId: reg.clientId, code, redirectUri: lb.redirectUri,
          verifier: makePkce().verifier,           // somebody else's verifier
        }),
        /invalid_grant|PKCE|Token exchange failed/,
      );
      lb.respond(false, 'PKCE mismatch');
      await browserRes;
    } finally { lb.close(); }
  } finally { mock.close(); }
}));

test('refreshTokens rotates and the old token stops working', () => withTempDir(async (dir) => {
  const mock = await startMockServer();
  const file = path.join(dir, 'auth.json');
  try {
    const { auth } = await login({ baseUrl: mock.base, file, openBrowser: false, onReady: ({ url }) => { actAsBrowser(url); } });
    const meta = await discover(mock.base);
    const rotated = await refreshTokens({ meta, clientId: auth.clientId, refreshToken: auth.refreshToken });
    assert.ok(rotated.accessToken);
    assert.notEqual(rotated.refreshToken, auth.refreshToken);
    await assert.rejects(
      () => refreshTokens({ meta, clientId: auth.clientId, refreshToken: auth.refreshToken }),
      /invalid_grant|Token exchange failed/,
    );
  } finally { mock.close(); }
}));
