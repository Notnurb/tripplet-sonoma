/**
 * login.js — the sign-in flow, independent of how it is presented.
 *
 * The UI supplies two callbacks and gets a signed-in record back. That keeps
 * the TUI overlay, the headless `astrocode login` path and the tests all
 * driving exactly the same code.
 *
 * The loopback listener and the manual paste race each other: whichever
 * produces a code first wins, so a user who gives up waiting and pastes the
 * URL by hand is never blocked by a listener that will never fire.
 */

import {
  DEFAULT_BASE_URL, SCOPES, discover, registerClient, makePkce, makeState,
  authorizeUrl, exchangeCode, startLoopback, parsePastedCode, checkState,
  fetchUserInfo, AuthError,
} from './oauth.js';
import { openUrl } from './browser.js';
import { loadAuth, saveAuth, rememberClient, knownClient } from './store.js';

/**
 * @param {object} o
 *   baseUrl        which Tripplet deployment to sign in to
 *   onReady        ({url, opened, openReason, port}) => void
 *   waitForManual  () => Promise<string|null>   text the user pasted
 *   signal         AbortSignal
 *   file           credential file (tests)
 * @returns {Promise<{auth: object, method: 'loopback'|'manual', user: object|null}>}
 */
export async function login({
  baseUrl = DEFAULT_BASE_URL,
  onReady = () => {},
  waitForManual = null,
  signal,
  file,
  openBrowser = true,
} = {}) {
  const meta = await discover(baseUrl);

  // Reuse the client_id we registered last time for this deployment; the
  // redirect URIs are fixed, so there is nothing to re-register.
  let clientId = knownClient(baseUrl, file ? { file } : undefined);
  if (!clientId) {
    const reg = await registerClient(meta);
    clientId = reg.clientId;
    rememberClient({ baseUrl, clientId, redirectUris: reg.redirectUris }, file ? { file } : undefined);
  }

  const loopback = await startLoopback();
  const pkce = makePkce();
  const state = makeState();
  const url = authorizeUrl({
    meta,
    clientId,
    redirectUri: loopback.redirectUri,
    challenge: pkce.challenge,
    state,
    scope: SCOPES,
  });

  const opened = openBrowser ? await openUrl(url) : { opened: false, reason: 'disabled' };
  onReady({ url, opened: opened.opened, openReason: opened.reason, port: loopback.port });

  let got;
  let method = 'loopback';
  try {
    const races = [loopback.result.then((r) => ({ ...r, _via: 'loopback' }))];

    if (waitForManual) {
      races.push(
        Promise.resolve(waitForManual()).then((text) => {
          if (text == null) return new Promise(() => {});   // cancelled: never win the race
          return { ...parsePastedCode(text), _via: 'manual' };
        }),
      );
    }
    if (signal) {
      races.push(new Promise((_, reject) => {
        if (signal.aborted) reject(new AuthError('Sign-in cancelled.', { code: 'cancelled' }));
        signal.addEventListener('abort', () => reject(new AuthError('Sign-in cancelled.', { code: 'cancelled' })), { once: true });
      }));
    }

    got = await Promise.race(races);
    method = got._via;
    checkState(state, got.state);
  } catch (err) {
    // The browser may already be showing our loopback page waiting for an
    // answer (it got a code; the race just lost it, e.g. a state mismatch)
    // — tell it sign-in did not finish rather than leaving it hanging on
    // whatever it last rendered.
    loopback.respond(false, err.message);
    throw err;
  } finally {
    loopback.close();
  }

  // From here on on the browser tab is holding its response open, waiting to
  // hear whether this actually worked — see startLoopback()'s `respond`.
  // Nothing may claim "you're signed in" to the user until saveAuth() below
  // has actually run: that page is the only signal an unattended terminal
  // gives them, and a user who trusts it and closes the terminal early must
  // not lose the session it promised.
  try {
    const tokens = await exchangeCode({
      meta,
      clientId,
      code: got.code,
      redirectUri: loopback.redirectUri,
      verifier: pkce.verifier,
    });

    const user = await fetchUserInfo({ baseUrl, accessToken: tokens.accessToken });

    const record = {
      baseUrl,
      issuer: meta.issuer,
      clientId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
      email: user?.email ?? null,
      name: user?.name ?? null,
      signedInAt: Date.now(),
    };
    const saved = saveAuth(record, file ? { file } : undefined);
    if (!saved.ok) {
      throw new AuthError(`Signed in, but could not save credentials: ${saved.error}`, { code: 'save_failed' });
    }
    loopback.respond(true);
    return { auth: record, method, user };
  } catch (err) {
    loopback.respond(false, err.message);
    throw err;
  }
}

/** Current sign-in, if any. */
export function currentUser(opts) {
  const auth = loadAuth(opts);
  if (!auth?.accessToken) return null;
  return { email: auth.email, name: auth.name, baseUrl: auth.baseUrl, expiresAt: auth.expiresAt, scope: auth.scope };
}

export { AuthError };
