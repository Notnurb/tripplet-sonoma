/**
 * store.js — where the tokens live.
 *
 * `~/.astrocode/auth.json`, owner-readable only. Kept separate from
 * `config.json` so that file stays safe to paste into an issue, and so a
 * corrupt credential file can be deleted without losing your settings.
 */

import fs from 'node:fs';
import path from 'node:path';

import { HOME_DIR } from '../core/config.js';
import { DEFAULT_BASE_URL, discover, refreshTokens, AuthError } from './oauth.js';

export const AUTH_PATH = path.join(HOME_DIR, 'auth.json');

/** Refresh this long before actual expiry, so a turn never dies mid-request. */
const REFRESH_SKEW_MS = 60_000;

/**
 * @typedef {object} AuthRecord
 * @property {string} baseUrl
 * @property {string} clientId
 * @property {string} accessToken
 * @property {string|null} refreshToken
 * @property {number} expiresAt   epoch ms
 * @property {string} scope
 * @property {string|null} email
 * @property {number} signedInAt
 */

export function loadAuth({ file = AUTH_PATH } = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || !data.accessToken) return null;
    return data;
  } catch {
    return null;   // missing or unreadable means "not signed in", never a crash
  }
}

export function saveAuth(record, { file = AUTH_PATH } = {}) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    // Write via a temp file so an interrupted write cannot leave a half record.
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Some filesystems ignore chmod; the file is still written.
    }
    return { ok: true, path: file };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function clearAuth({ file = AUTH_PATH } = {}) {
  try {
    fs.rmSync(file, { force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export const isExpired = (auth, skew = REFRESH_SKEW_MS) =>
  !auth?.expiresAt || auth.expiresAt - skew <= Date.now();

/** Signed in at all, regardless of whether the access token is still fresh. */
export const isSignedIn = (auth) => !!(auth?.accessToken && (auth.refreshToken || !isExpired(auth, 0)));

export function describeAuth(auth) {
  if (!auth) return 'not signed in';
  const who = auth.email || 'signed in';
  const where = auth.baseUrl || DEFAULT_BASE_URL;
  return `${who} · ${where}`;
}

/**
 * A usable access token, refreshing first if it is close to expiry.
 *
 * `forceRefresh` skips the local expiry check and refreshes unconditionally —
 * used when a request comes back 401 even though our own clock thought the
 * token was still good (clock skew, an early server-side revocation, or a
 * token minted just before a restart). Without this, a rejected-but-locally-
 * fresh-looking token would surface as "you're signed out" and demand a full
 * re-login even though a perfectly good refresh token is sitting right there.
 * @returns {Promise<{token: string|null, auth: AuthRecord|null, refreshed: boolean, error?: string}>}
 */
export async function getAccessToken({ file = AUTH_PATH, forceRefresh = false } = {}) {
  const auth = loadAuth({ file });
  if (!auth) return { token: null, auth: null, refreshed: false, error: 'not signed in' };
  if (!forceRefresh && !isExpired(auth)) return { token: auth.accessToken, auth, refreshed: false };

  if (!auth.refreshToken) {
    return { token: null, auth, refreshed: false, error: 'session expired — run /login again' };
  }
  try {
    const meta = await discover(auth.baseUrl);
    const tokens = await refreshTokens({
      meta,
      clientId: auth.clientId,
      refreshToken: auth.refreshToken,
    });
    const next = {
      ...auth,
      accessToken: tokens.accessToken,
      // The server rotates refresh tokens; keep the new one or we lock ourselves out.
      refreshToken: tokens.refreshToken || auth.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
      refreshedAt: Date.now(),
    };
    saveAuth(next, { file });
    return { token: next.accessToken, auth: next, refreshed: true };
  } catch (err) {
    const message = err instanceof AuthError ? err.message : `refresh failed: ${err.message}`;
    // A rejected refresh token is dead — clear it so the UI says "sign in"
    // rather than retrying a token the server has already revoked.
    if (err?.code === 'invalid_grant') clearAuth({ file });
    return { token: null, auth, refreshed: false, error: message };
  }
}

/** Remember the registered client so every login does not create a new one. */
export function rememberClient({ baseUrl, clientId, redirectUris }, { file = AUTH_PATH } = {}) {
  const existing = loadAuth({ file }) || {};
  return saveAuth({ ...existing, baseUrl, clientId, redirectUris, accessToken: existing.accessToken ?? null }, { file });
}

export function knownClient(baseUrl, { file = AUTH_PATH } = {}) {
  const auth = loadAuth({ file }) || readRaw(file);
  if (!auth?.clientId) return null;
  if (auth.baseUrl && auth.baseUrl !== baseUrl) return null;   // different deployment
  return auth.clientId;
}

/** loadAuth() insists on a token; client reuse only needs the client_id. */
function readRaw(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
