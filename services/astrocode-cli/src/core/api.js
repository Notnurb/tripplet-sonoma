/**
 * api.js — the only place Astrocode talks to Tripplet.
 *
 * Every request carries the OAuth access token from `~/.astrocode/auth.json`,
 * refreshed transparently by `getAccessToken`. The deployment comes from the
 * same record, so a user signed in to trippletspark.com never silently hits
 * tripplet.lol.
 *
 * Failures are normalised into `ApiError` with a `code`, because the difference
 * between "your session expired", "you are out of messages until 6pm" and "the
 * server is down" is the whole message the user needs — and the caller should
 * not have to parse status codes to tell them apart.
 */

import { getAccessToken } from '../auth/store.js';
import { DEFAULT_BASE_URL } from '../auth/oauth.js';

const DEFAULT_TIMEOUT_MS = 120_000;
/** Long enough for a slow first token on a big prompt; the stream resets it. */
const STREAM_TIMEOUT_MS = 300_000;

export class ApiError extends Error {
  constructor(message, { code = 'http_error', status = 0, scope, resetsAt, hint } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.scope = scope ?? null;
    this.resetsAt = resetsAt ?? null;
    this.hint = hint ?? null;
  }
}

const trimSlash = (u) => String(u ?? '').replace(/\/+$/, '');

/** Origins we have already learned the canonical form of, per process. */
const canonical = new Map();

/** How many hops to follow before giving up on a redirect loop. */
const MAX_HOPS = 4;

/**
 * True when `to` is the same site as `from`, treating `example.com` and
 * `www.example.com` as one. The bearer is only ever re-attached across a
 * redirect that satisfies this: a token handed to an unrelated host is a
 * credential leak, and "the server told us to" is not a good enough reason.
 */
function sameSite(from, to) {
  let a;
  let b;
  try {
    a = new URL(from);
    b = new URL(to);
  } catch {
    return false;
  }
  if (b.protocol !== 'https:' && b.hostname !== '127.0.0.1' && b.hostname !== 'localhost') return false;
  const bare = (h) => h.toLowerCase().replace(/^www\./, '');
  return bare(a.host) === bare(b.host);
}

/**
 * fetch, but a redirect does not cost us the Authorization header.
 *
 * The deployments redirect their apex to `www`, and both fetch and curl drop
 * `Authorization` on a cross-host redirect — by design, so a token cannot be
 * replayed to whatever host a server names. The result was every authenticated
 * request arriving at the app with no bearer at all, which the CLI reported as
 * "your session expired". So follow redirects ourselves and re-attach the
 * header only when the target is the same site.
 */
async function fetchFollowing(url, init, signal) {
  let current = url;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const res = await fetch(current, { ...init, redirect: 'manual' });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return { res, url: current };

    const next = new URL(location, current).toString();
    if (!sameSite(current, next)) {
      // Follow it, but without credentials — and let the caller see the result
      // rather than pretending the redirect did not happen.
      return { res: await fetch(next, { ...init, headers: stripAuth(init.headers), redirect: 'follow' }), url: next };
    }
    // 303, and 301/302 on a POST, mean "GET the other thing" per the spec.
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && init.method === 'POST')) {
      init = { ...init, method: 'GET', body: undefined };
    }
    current = next;
    if (signal?.aborted) break;
  }
  throw new ApiError(`Too many redirects from ${url}`, { code: 'bad_response' });
}

function stripAuth(headers = {}) {
  const out = { ...headers };
  delete out.authorization;
  return out;
}

/** The deployment we would talk to, whether or not we are signed in. */
export async function apiBaseUrl({ file } = {}) {
  const { auth } = await getAccessToken(file ? { file } : undefined);
  return trimSlash(auth?.baseUrl || DEFAULT_BASE_URL);
}

async function readJsonSafe(res) {
  try {
    return JSON.parse(await res.text());
  } catch {
    return null;
  }
}

/**
 * A fetch that is already authenticated, already timed out, and already
 * translated into ApiError. Returns the raw Response on success so a caller can
 * stream it.
 */
export async function apiFetch(pathname, {
  method = 'GET',
  body,
  signal,
  timeout = DEFAULT_TIMEOUT_MS,
  accept = 'application/json',
  file,
} = {}) {
  const { token, auth, error } = await getAccessToken(file ? { file } : undefined);
  if (!token) {
    throw new ApiError(error || 'not signed in', {
      code: error && /expired/i.test(error) ? 'unauthorized' : 'not_signed_in',
      hint: 'Run /login to sign in to Tripplet.',
    });
  }

  const declared = trimSlash(auth?.baseUrl || DEFAULT_BASE_URL);
  // Once a deployment has told us its canonical origin, go straight there:
  // the redirect costs a round trip on every single request otherwise.
  const base = canonical.get(declared) || declared;
  const url = `${base}${pathname}`;

  // Two abort sources — the caller's Ctrl-C and our own timeout — folded into
  // one signal, so a cancelled turn tears the socket down immediately.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeout);

  let res;
  try {
    const landed = await fetchFollowing(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    }, signal);
    res = landed.res;
    // Remember where we actually ended up, origin only.
    if (landed.url !== url) {
      try { canonical.set(declared, trimSlash(new URL(landed.url).origin)); } catch { /* keep the declared one */ }
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (signal?.aborted) throw new ApiError('cancelled', { code: 'aborted' });
    if (err.name === 'AbortError') {
      throw new ApiError(`${url} timed out`, { code: 'timeout', hint: 'The server took too long to respond.' });
    }
    throw new ApiError(`Cannot reach ${base}: ${err.message}`, {
      code: 'unreachable',
      hint: 'Check your connection, or /login --url <base> to switch deployment.',
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  if (res.ok) return res;

  const payload = await readJsonSafe(res);
  const detail = payload?.error_description || payload?.error || `HTTP ${res.status}`;

  if (res.status === 401) {
    throw new ApiError('Your Tripplet session is no longer valid.', {
      code: 'unauthorized',
      status: 401,
      hint: 'Run /login to sign in again.',
    });
  }
  if (res.status === 429 && payload?.code === 'usage_limit') {
    throw new ApiError(detail, {
      code: 'usage_limit',
      status: 429,
      scope: payload.scope ?? null,
      resetsAt: payload.resetsAt ?? null,
      hint: 'Run /usage to see your limits.',
    });
  }
  if (res.status === 429) {
    throw new ApiError(detail, { code: 'rate_limited', status: 429, hint: 'Give it a minute and try again.' });
  }
  if (res.status === 503) {
    throw new ApiError(detail, { code: 'backend_unconfigured', status: 503 });
  }
  throw new ApiError(detail, { code: 'http_error', status: res.status });
}

/**
 * One model turn. Yields the server's SSE events in order:
 *   {type:'thinking'|'content', delta} · {type:'tool_call', id, name, args}
 *   {type:'done', finish} · {type:'error', message}
 *
 * The caller owns the agent loop: run the tool calls, append the results, call
 * again. That is why this is one request per turn and not a socket.
 */
export async function* streamChat({
  messages,
  tools,
  model,
  signal,
  timeout = STREAM_TIMEOUT_MS,
  file,
} = {}) {
  const res = await apiFetch('/api/cli/chat', {
    method: 'POST',
    accept: 'text/event-stream',
    body: {
      model,
      messages,
      ...(tools && tools.length ? { tools } : {}),
    },
    signal,
    timeout,
    file,
  });

  if (!res.body) {
    throw new ApiError('The server returned an empty stream.', { code: 'bad_response', status: res.status });
  }

  const decoder = new TextDecoder();
  let buf = '';

  // getReader() rather than `for await (… of res.body)`: async iteration of a
  // web ReadableStream is not dependable across every Node this package
  // supports (>=18.17), and a stream that silently never iterates would look
  // like a model that never answers.
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (signal?.aborted) return;
      buf += decoder.decode(value, { stream: true });

      // Events are newline-delimited `data:` lines. A chunk can split one
      // anywhere, including mid-JSON, so only whole lines are parsed.
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, '').trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let ev;
        try {
          ev = JSON.parse(payload);
        } catch {
          continue;   // a malformed frame is not worth killing a turn over
        }
        if (ev && typeof ev.type === 'string') yield ev;
      }
    }
  } finally {
    // A turn abandoned mid-stream (Ctrl-C) must not leave the socket open.
    try { await reader.cancel(); } catch { /* already closed */ }
  }
}

/** The account's plan and its 5-hour / weekly windows. */
export async function fetchUsage({ signal, file } = {}) {
  const res = await apiFetch('/api/usage', { signal, file, timeout: 20_000 });
  const body = await readJsonSafe(res);
  if (!body || !body.fiveHour || !body.weekly) {
    throw new ApiError('The server returned an unreadable usage summary.', { code: 'bad_response' });
  }
  return body;
}
