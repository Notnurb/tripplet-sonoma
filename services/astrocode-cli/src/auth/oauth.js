/**
 * oauth.js — OAuth 2.1 authorization-code + PKCE against the Tripplet ChatUI.
 *
 * Tripplet already runs a standards-compliant authorization server (RFC 8414
 * discovery, RFC 7591 dynamic client registration, PKCE S256, refresh-token
 * rotation), so this module is a plain client: no bespoke protocol, no secrets
 * to embed, and nothing here that a generic OAuth library would do differently.
 *
 * Two ways in, because a CLI cannot assume a browser on the same machine:
 *   1. Loopback — we listen on 127.0.0.1 and the browser delivers the code.
 *   2. Manual   — the user opens the link themselves and pastes back the code
 *                 (or the whole redirected URL, which is easier to copy).
 *
 * Only `node:` builtins and global fetch are used.
 */

import crypto from 'node:crypto';
import http from 'node:http';

/** The Tripplet deployments Astrocode knows about — same models, same account. */
export const DEPLOYMENTS = [
  { url: 'https://tripplet.lol', label: 'Tripplet', desc: 'tripplet.lol' },
  { url: 'https://trippletspark.com', label: 'Tripplet Spark', desc: 'trippletspark.com' },
  { url: 'https://getsonoma.lol', label: 'Sonoma', desc: 'getsonoma.lol' },
];

export const DEFAULT_BASE_URL =
  process.env.ASTROCODE_AUTH_URL || DEPLOYMENTS[0].url;
export const SCOPES = 'mcp offline_access';
export const CLIENT_NAME = 'Astrocode CLI';

/** Loopback ports we register up front, so one client_id serves every login. */
export const LOOPBACK_PORTS = [9271, 9272, 9273, 9274, 9275, 9276, 9277, 9278, 9279, 9280];

export const redirectUriFor = (port) => `http://127.0.0.1:${port}/callback`;
export const ALL_REDIRECT_URIS = LOOPBACK_PORTS.map(redirectUriFor);

const trimSlash = (u) => String(u).replace(/\/+$/, '');

class AuthError extends Error {
  constructor(message, { code = 'auth_error', hint } = {}) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

const TIMEOUT_MS = 20_000;

async function request(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeout ?? TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new AuthError(`${url} timed out`, { code: 'timeout', hint: 'Is the Tripplet server running?' });
    }
    throw new AuthError(`Cannot reach ${url}: ${err.message}`, {
      code: 'unreachable',
      hint: 'Check the URL with /login --url <base>, or start the ChatUI (npm run dev).',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res, what) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new AuthError(
      `${what} returned ${res.status} but not JSON`,
      { code: 'bad_response', hint: text.slice(0, 180) },
    );
  }
}

// ── discovery ───────────────────────────────────────────────────────────────

/**
 * RFC 8414 metadata. Falls back to the documented paths when a deployment does
 * not serve discovery, so a slightly older server still works.
 */
export async function discover(baseUrl = DEFAULT_BASE_URL) {
  const base = trimSlash(baseUrl);
  const url = `${base}/.well-known/oauth-authorization-server`;
  const res = await request(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    return {
      issuer: base,
      authorization_endpoint: `${base}/api/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      _fallback: true,
    };
  }
  const meta = await readJson(res, 'Discovery');
  for (const key of ['authorization_endpoint', 'token_endpoint']) {
    if (!meta[key]) throw new AuthError(`Discovery document is missing ${key}`, { code: 'bad_metadata' });
  }
  meta.issuer ||= base;
  meta.registration_endpoint ||= `${base}/api/oauth/register`;
  return meta;
}

// ── dynamic client registration ─────────────────────────────────────────────

export async function registerClient(meta, { redirectUris = ALL_REDIRECT_URIS, clientName = CLIENT_NAME } = {}) {
  const res = await request(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
    }),
  });
  const body = await readJson(res, 'Client registration');
  if (!res.ok || !body.client_id) {
    throw new AuthError(
      body.error_description || body.error || `Client registration failed (${res.status})`,
      {
        code: 'registration_failed',
        hint: res.status === 503
          ? 'The Tripplet server has no database configured — set DATABASE_URL and restart it.'
          : undefined,
      },
    );
  }
  return { clientId: body.client_id, registeredAt: Date.now(), redirectUris };
}

/**
 * Is a previously-registered client_id still accepted by this deployment?
 *
 * Registration is stateless on the server: the client_id is a JWT signed with
 * the deployment's secret, so a secret rotation (or a client_id saved against a
 * different deployment) silently invalidates every stored client_id. The user
 * then sees "Unknown client_id. Register the client first." in the browser, and
 * nothing in the CLI ever notices — re-running /login reuses the same dead id
 * forever. Probing the authorization endpoint is the only check that tests
 * exactly what the browser is about to do: a live client redirects to consent,
 * a stale one (or an unregistered redirect_uri) answers 4xx.
 *
 * Network failures answer `true`: a probe that could not reach the server is no
 * evidence the client is bad, and re-registering costs a rate-limit slot.
 */
export async function clientIsValid(meta, { clientId, redirectUri = ALL_REDIRECT_URIS[0] }) {
  const url = authorizeUrl({
    meta,
    clientId,
    redirectUri,
    challenge: makePkce().challenge,
    state: 'probe',
  });
  // Manual redirects: a live client answers with a redirect (to the consent
  // page), and following it is pointless here — worse, an auto-approving server
  // would send us on to the loopback callback and burn a code nobody is waiting
  // for. Only a host-canonicalising hop (same path, e.g. apex → www) is worth
  // following, or a stale client_id would be mistaken for that redirect.
  let target = url;
  for (let hop = 0; hop < 3; hop++) {
    let res;
    try {
      res = await request(target, { headers: { accept: 'text/html' }, redirect: 'manual', timeout: 8000 });
    } catch {
      return true;   // unreachable is not evidence of a bad client
    }
    if (res.status >= 400) return false;
    const location = res.status >= 300 ? res.headers.get('location') : null;
    if (!location) return true;
    const next = new URL(location, target);
    if (next.pathname !== new URL(target).pathname) return true;   // reached consent
    target = next.toString();
  }
  return true;
}

// ── PKCE ────────────────────────────────────────────────────────────────────

export function makePkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, method: 'S256' };
}

export const makeState = () => crypto.randomBytes(16).toString('base64url');

export function authorizeUrl({ meta, clientId, redirectUri, challenge, state, scope = SCOPES }) {
  const url = new URL(meta.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  return url.toString();
}

// ── token exchange ──────────────────────────────────────────────────────────

async function postToken(meta, params) {
  const res = await request(meta.token_endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams(params).toString(),
  });
  const body = await readJson(res, 'Token endpoint');
  if (!res.ok || !body.access_token) {
    const detail = body.error_description || body.error || `HTTP ${res.status}`;
    throw new AuthError(`Token exchange failed: ${detail}`, {
      code: body.error || 'token_failed',
      hint: body.error === 'invalid_grant'
        ? 'The code was already used or expired — codes last 60 seconds. Run /login again.'
        : undefined,
    });
  }
  return normaliseTokens(body);
}

function normaliseTokens(body) {
  const expiresIn = Number(body.expires_in) || 3600;
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    tokenType: body.token_type || 'Bearer',
    scope: body.scope || SCOPES,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export function exchangeCode({ meta, clientId, code, redirectUri, verifier }) {
  return postToken(meta, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
}

export function refreshTokens({ meta, clientId, refreshToken }) {
  return postToken(meta, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
}

// ── identity ────────────────────────────────────────────────────────────────

/**
 * Who the token belongs to. The userinfo endpoint is optional — if the
 * deployment does not have one yet, sign-in still succeeds, we just cannot
 * show an email.
 */
export async function fetchUserInfo({ baseUrl, accessToken }) {
  const base = trimSlash(baseUrl);
  try {
    const res = await request(`${base}/api/oauth/userinfo`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      timeout: 8000,
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!body) return null;
    return { email: body.email || body.sub || null, name: body.name || null, scope: body.scope || null };
  } catch {
    return null;   // identity is a nicety, never a reason to fail a login
  }
}

// ── loopback listener ───────────────────────────────────────────────────────

const PAGE = (title, body, accent) => `<!doctype html><meta charset="utf-8">
<title>${title}</title>
<style>
  :root{color-scheme:dark light}
  body{font:16px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
       display:grid;place-items:center;min-height:100vh;margin:0;background:#0b0e14;color:#d5dbe5}
  .card{max-width:26rem;padding:2.5rem;text-align:center}
  h1{font-size:1.35rem;margin:0 0 .5rem;color:${accent}}
  p{margin:0;color:#6e7681}
  .dot{width:.6rem;height:.6rem;border-radius:50%;background:${accent};display:inline-block;margin-right:.5rem}
</style>
<div class="card"><h1><span class="dot"></span>${title}</h1><p>${body}</p></div>`;

/**
 * Listen on the first free loopback port.
 *
 * The browser request is deliberately left open (not answered) once we have
 * a code: exchanging that code for real tokens and writing them to disk
 * still has to happen, and if the page tells the user "you're signed in"
 * before that work is done, a user who takes it at its word and closes the
 * terminal loses the session with no error ever shown to them. `respond()`
 * lets the caller answer the browser only once it actually knows whether
 * sign-in succeeded.
 *
 * @returns {Promise<{port, redirectUri, result: Promise<{code,state}>, close(): void, respond(ok: boolean, detail?: string): void}>}
 */
export async function startLoopback(ports = LOOPBACK_PORTS) {
  let resolveResult;
  let rejectResult;
  const result = new Promise((res, rej) => { resolveResult = res; rejectResult = rej; });

  /** The browser's still-open response, once we have a code to exchange. */
  let pendingRes = null;

  const server = http.createServer((req, res) => {
    // This server exists to answer exactly one real browser request in its
    // whole life; keep-alive just delays the socket (and the port) actually
    // freeing up after that, for no benefit.
    res.setHeader('Connection', 'close');
    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }
    if (url.pathname !== '/callback') {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE('Not found', 'Nothing to see here.', '#6e7681'));
      return;
    }
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (error || !code) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE('Sign-in failed', error || 'No authorization code was returned.', '#f87171'));
      rejectResult(new AuthError(`Authorization failed: ${error || 'no code returned'}`, { code: error || 'no_code' }));
    } else {
      // Do not answer yet — hold the connection until respond() is called
      // with the real outcome of the token exchange.
      pendingRes = res;
      resolveResult({ code, state });
    }
  });

  server.on('error', (err) => rejectResult(new AuthError(`Loopback server error: ${err.message}`)));

  const port = await new Promise((resolve, reject) => {
    let i = 0;
    const tryNext = () => {
      if (i >= ports.length) {
        reject(new AuthError(
          `No free port in ${ports[0]}-${ports[ports.length - 1]}`,
          { code: 'no_port', hint: 'Close whatever is using those ports, or use the paste flow.' },
        ));
        return;
      }
      const p = ports[i++];
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') tryNext();
        else reject(new AuthError(`Cannot listen on ${p}: ${err.message}`));
      });
      server.listen(p, '127.0.0.1', () => resolve(p));
    };
    tryNext();
  });

  const close = () => { try { server.close(); } catch { /* already closed */ } };
  // Never let a forgotten listener hold the process open.
  server.unref?.();

  /** Tell the browser tab what actually happened. A no-op if it never connected
   *  (manual-paste flow on a machine the browser can't reach) or already got
   *  an answer (a malformed callback fails fast, above, without a pending res). */
  const respond = (ok, detail) => {
    if (!pendingRes) return;
    const res = pendingRes;
    pendingRes = null;
    try {
      res.writeHead(ok ? 200 : 500, { 'content-type': 'text/html; charset=utf-8' });
      res.end(ok
        ? PAGE('You are signed in', 'You can close this tab and return to your terminal.', '#4ade80')
        : PAGE('Sign-in did not finish', detail || 'Something went wrong saving your session — check your terminal.', '#f87171'));
    } catch { /* the browser already gave up on the connection */ }
  };

  return { port, redirectUri: redirectUriFor(port), result, close, respond };
}

// ── manual paste ────────────────────────────────────────────────────────────

/**
 * Accept whatever the user managed to copy: the full redirected URL, a bare
 * `code=…&state=…` query, or just the code.
 * @returns {{code: string, state: string|null}}
 */
export function parsePastedCode(input) {
  const raw = String(input ?? '').trim().replace(/^["'<]|[">']$/g, '');
  if (!raw) throw new AuthError('Nothing pasted.', { code: 'empty' });

  const fromQuery = (params) => {
    const error = params.get('error');
    if (error) {
      throw new AuthError(`Authorization was refused: ${error}`, { code: error });
    }
    const code = params.get('code');
    if (!code) throw new AuthError('That link has no ?code= in it.', { code: 'no_code' });
    return { code, state: params.get('state') };
  };

  if (/^https?:\/\//i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new AuthError('That does not look like a valid URL.', { code: 'bad_url' });
    }
    return fromQuery(url.searchParams);
  }
  if (raw.includes('code=') || raw.includes('error=')) {
    return fromQuery(new URLSearchParams(raw.replace(/^[?#]/, '')));
  }
  if (/\s/.test(raw)) throw new AuthError('That has spaces in it — paste the code or the whole URL.', { code: 'bad_code' });
  return { code: raw, state: null };
}

/** Guard against a code that came back for somebody else's request. */
export function checkState(expected, received) {
  // A manual paste may legitimately have no state (bare code) — only compare
  // when the caller actually got one back.
  if (received == null) return;
  if (received !== expected) {
    throw new AuthError('State mismatch — that code came from a different sign-in attempt.', {
      code: 'state_mismatch',
      hint: 'Run /login again and use the freshest link.',
    });
  }
}

export { AuthError };
