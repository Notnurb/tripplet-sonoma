/**
 * app.js — the interactive TUI.
 *
 * Owns the event loop: stdin -> key events -> state mutation -> a coalesced
 * repaint. Every render is a pure function of `this` plus the session, so the
 * only thing that ever has to be correct about redrawing is "did something
 * change", not "what exactly changed".
 */

import process from 'node:process';

import { run, width as lw, truncate, pad, wrapText } from './ui/text.js';
import { Screen } from './ui/screen.js';
import { KeyDecoder } from './ui/keys.js';
import { InputEditor } from './ui/input.js';
import { Spinner } from './ui/spinner.js';
import { drawBox } from './ui/box.js';
import { renderTranscript } from './ui/transcript.js';
import { computeLayout, composeFrame, viewport, statusBar, hints } from './ui/layout.js';
import { suggest, renderSuggestions, applySuggestion, invalidateFileIndex } from './ui/autocomplete.js';
import { isPrintable, charOf } from './ui/keys.js';

import { COMMANDS, getCommand } from './commands/index.js';
import { Engine } from './engine/engine.js';
import { RemoteEngine } from './engine/remote.js';
import { TOOLS } from './tools/index.js';
import { Permissions } from './tools/permissions.js';
import { getModel } from './core/models.js';
import { getEffort } from './core/effort.js';
import { saveConfig } from './core/config.js';
import { contextPercent, formatTokens } from './core/tokens.js';
import * as git from './git/git.js';
import { loadAuth, isSignedIn } from './auth/store.js';

const FRAME_MS = 40;
const GIT_POLL_MS = 4000;

export class App {
  constructor({ session, config, theme, version = '0.1.0', stdin = process.stdin, stdout = process.stdout }) {
    this.session = session;
    this.config = config;
    this.theme = theme;
    this.version = version;
    this.stdin = stdin;
    this.screen = new Screen(stdout);
    this.decoder = new KeyDecoder();
    this.editor = new InputEditor();
    this.spinner = new Spinner({ frames: 'dots', label: 'auto' });

    this.permissions = new Permissions({
      mode: config.permissionMode,
      allow: config.allow,
      deny: config.deny,
      cwd: session.cwd,
    });

    // Both engines exist; `get engine()` picks one per turn on auth state, so
    // /login and /logout take effect on the very next prompt without a restart.
    this._engines = {
      local: new Engine({
        session,
        tools: TOOLS,
        permissions: this.permissions,
        theme,
        seed: session.seed,
      }),
      remote: new RemoteEngine({
        session,
        tools: TOOLS,
        permissions: this.permissions,
        theme,
      }),
    };

    this.mode = 'input';        // 'input' | 'busy'
    this.overlay = null;        // { kind, ... } — permission prompt or picker
    this.scroll = 0;
    this.suggestion = null;
    this.sugIndex = 0;
    this.verbose = !!config.verbose;
    this.running = false;
    this.exitCode = 0;
    this.lastCtrlC = 0;
    this.transientHint = null;
    this.git = { branch: null, dirty: 0 };
    this.abortCtrl = null;
    this.authed = isSignedIn(loadAuth());

    this._renderQueued = false;
    this._ticker = null;
    this._gitTimer = null;
    this._resolveExit = null;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  async start() {
    if (!this.stdin.isTTY) {
      throw new Error('Astrocode needs an interactive terminal. Use --prompt for headless runs.');
    }
    this.running = true;
    this.screen.enter({ title: 'Astrocode' });
    this.stdin.setRawMode(true);
    this.stdin.resume();
    this.stdin.setEncoding('utf8');

    this._onData = (chunk) => {
      for (const ev of this.decoder.push(chunk)) {
        try {
          this.handleEvent(ev);
        } catch (err) {
          this.session.notice(`Input error: ${err.message}`, 'error');
          this.requestRender();
        }
      }
    };
    this.stdin.on('data', this._onData);
    this._offResize = this.screen.onResize(() => this.requestRender());

    if (this.config.showWelcome !== false) this.session.push({ kind: 'welcome' });

    await this.refreshGit();
    this._gitTimer = setInterval(() => { this.refreshGit().catch(() => {}); }, GIT_POLL_MS);
    this._gitTimer.unref?.();

    this.syncTicker();
    this.requestRender();

    // Open with a login window when signed out: pick a deployment, sign in,
    // and you land straight in the app. Skipping it leaves you gated.
    if (!this.authed && this.config.autoLogin !== false) {
      this.promptLogin({ startup: true }).catch(() => {});
    }

    await new Promise((resolve) => { this._resolveExit = resolve; });
    return this.exitCode;
  }

  stop(code = 0) {
    if (!this.running) return;
    this.running = false;
    this.exitCode = code;
    this.abortCtrl?.abort();
    clearInterval(this._gitTimer);
    clearInterval(this._ticker);
    this._offResize?.();
    this.stdin.off('data', this._onData);
    try { this.stdin.setRawMode(false); } catch { /* already closed */ }
    this.stdin.pause();
    this.screen.exit();
    if (this.config.autosave !== false) this.session.save();
    this._resolveExit?.(code);
  }

  /**
   * Signed in, the models are real (`RemoteEngine` → /api/cli/chat); signed
   * out, the local simulation still answers so the CLI is usable offline.
   * `config.engine` pins one either way — 'local' is how you demo or work on
   * a plane, and how the tests run a turn without a network.
   */
  get engine() {
    const pin = this.config.engine;
    if (pin === 'local') return this._engines.local;
    if (pin === 'remote') return this._engines.remote;
    return this.authed ? this._engines.remote : this._engines.local;
  }

  /** Only run a timer when something is actually animating. */
  syncTicker() {
    const needed = this.theme.animated || this.mode === 'busy';
    if (needed && !this._ticker) {
      this._ticker = setInterval(() => {
        this.theme.tick(1);
        if (this.mode === 'busy') this.spinner.advance();
        this.requestRender(true);
      }, FRAME_MS * 2);
      this._ticker.unref?.();
    } else if (!needed && this._ticker) {
      clearInterval(this._ticker);
      this._ticker = null;
    }
  }

  async refreshGit() {
    try {
      if (!(await git.isRepo(this.session.cwd))) { this.git = { branch: null, dirty: 0 }; return; }
      const [branch, status] = await Promise.all([
        git.branch(this.session.cwd),
        git.status(this.session.cwd),
      ]);
      const dirty = (status?.staged?.length || 0) + (status?.unstaged?.length || 0) +
        (status?.untracked?.length || 0);
      this.git = { branch, dirty };
      this.requestRender();
    } catch {
      // git being unavailable is not an error worth surfacing every 4 seconds
    }
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  requestRender(force = false) {
    if (this._renderQueued || !this.running) return;
    this._renderQueued = true;
    setTimeout(() => {
      this._renderQueued = false;
      if (this.running) this.render();
    }, force ? 0 : FRAME_MS);
  }

  render() {
    const layout = computeLayout({
      cols: this.screen.cols,
      rows: this.screen.rows,
    });

    if (layout.cols < 30 || layout.rows < 8) {
      this.screen.render([[run('Terminal too small', { fg: this.theme.warn })]], null);
      return;
    }

    const bottom = this.renderBottom(layout);
    const availH = Math.max(1, layout.contentH - bottom.lines.length);

    const tlines = renderTranscript(this.session.transcript, {
      width: layout.mainW,
      theme: this.theme,
      session: this.session,
      verbose: this.verbose,
      user: this.config.username || shortUser(),
      version: this.version,
    });

    const view = viewport(tlines, availH, this.scroll);
    this.maxScroll = view.maxOffset;

    const frame = composeFrame({
      layout,
      main: [...view.lines, ...bottom.lines],
      status: this.renderStatus(layout, view),
    });

    const cursor = bottom.cursor && !this.overlay
      ? { row: availH + bottom.cursor.row, col: bottom.cursor.col }
      : null;

    this.screen.render(frame, cursor);
  }

  /** Everything pinned below the transcript: overlay, spinner, input, popup. */
  renderBottom(layout) {
    const w = layout.mainW;
    const out = [];

    if (this.overlay) {
      out.push(...this.renderOverlay(w));
      out.push([]);
    }

    if (this.mode === 'busy' && !this.overlay) {
      out.push(this.spinner.render(this.theme, { tokens: this.streamedTokens || 0 }));
      out.push([]);
    }

    const box = this.editor.render({
      width: w,
      theme: this.theme,
      prompt: '›',
      busy: this.mode === 'busy',
      maxRows: Math.max(1, Math.floor(layout.contentH / 3)),
    });
    const inputStart = out.length;
    out.push(...box.lines);

    if (this.suggestion) {
      const sug = renderSuggestions(this.suggestion, {
        width: w, theme: this.theme, selected: this.sugIndex,
        max: Math.max(3, Math.min(8, Math.floor(layout.contentH / 3))),
      });
      out.push(...sug);
    }

    return {
      lines: out,
      cursor: this.overlay ? null : {
        row: inputStart + box.cursor.row,
        col: box.cursor.col,
      },
    };
  }

  renderStatus(layout, view) {
    const t = this.theme;
    // Drop hints from the right as the terminal narrows, rather than letting
    // the row truncate mid-word.
    const allHints = [
      ['ctrl+p', 'commands'],
      ['ctrl+j', 'newline'],
      ['esc', this.mode === 'busy' ? 'interrupt' : 'clear'],
      ['ctrl+c', 'quit'],
    ];
    const room = layout.cols >= 118 ? 4 : layout.cols >= 92 ? 3 : layout.cols >= 72 ? 2 : 1;
    const left = this.transientHint
      ? [run(this.transientHint.text, { fg: t[this.transientHint.level] || t.dim })]
      : hints(t, allHints.slice(0, room));

    // With no side rail, the status bar carries the live state: how far you have
    // scrolled, what you have changed, how full the context is, and the model.
    const m = this.session.model;
    const files = this.session.modifiedFiles;
    const used = this.session.contextTokens;
    const pct = contextPercent(used, m);
    const right = [
      ...(view.offset > 0 ? [run(`↑${view.offset}  `, { fg: t.warn })] : []),
      ...(this.permissions.mode !== 'ask'
        ? [run(`${this.permissions.mode}  `, { fg: this.permissions.mode === 'yolo' ? t.error : t.warn })]
        : []),
      ...(files.length
        ? [
          run(`${files.length}`, { fg: t.text }),
          run(files.length === 1 ? ' file  ' : ' files  ', { fg: t.faint }),
        ]
        : []),
      run(`${pct}%`, { fg: pct > 80 ? t.warn : t.faint }),
      run(` ${formatTokens(used)}  `, { fg: t.faint }),
      run(this.session.effort?.glyph ?? '', { fg: this.session.effort?.color ?? t.dim }),
      run(` ${this.session.effort?.label ?? ''}  `, { fg: t.faint }),
      run(m?.short ?? 'no model', { fg: t.rainbow ? t.pulse(0, m?.accent) : (m?.accent || t.dim) }),
      run(' ', {}),
    ];
    return statusBar({ layout, left, right });
  }

  renderOverlay(w) {
    const t = this.theme;
    const o = this.overlay;

    if (o.kind === 'permission') {
      const body = [];
      body.push([run(o.title, { fg: t.text, bold: true })]);
      if (o.detail) {
        body.push([]);
        for (const l of String(o.detail).split('\n').slice(0, 6)) {
          body.push(...wrapText(l, w - 6, { fg: t.code }));
        }
      }
      body.push([]);
      o.options.forEach((opt, i) => {
        const on = i === o.selected;
        body.push([
          run(on ? '❯ ' : '  ', { fg: on ? t.primary : t.faint }),
          run(`${i + 1}. `, { fg: t.faint }),
          run(opt.label, { fg: on ? t.text : t.dim, bold: on }),
        ]);
      });
      return drawBox(body, {
        width: w, theme: t, color: t.warn, padX: 1,
        title: [run('▲ Permission', { fg: t.warn, bold: true })],
        footer: [run('↑↓ select · enter confirm · esc deny', { fg: t.faint })],
      });
    }

    if (o.kind === 'login') return this.renderLoginOverlay(o, w);

    if (o.kind === 'select') {
      const body = [];
      const maxRows = Math.max(3, Math.min(10, o.items.length));
      const start = Math.max(0, Math.min(o.selected - maxRows + 1, o.items.length - maxRows));
      const labelW = Math.min(22, Math.max(...o.items.map((i) => lw([run(i.label)])))) + 2;

      o.items.slice(Math.max(0, start), Math.max(0, start) + maxRows).forEach((it, i) => {
        const idx = Math.max(0, start) + i;
        const on = idx === o.selected;
        const fg = on ? (it.color || t.primary) : t.dim;
        const head = [
          run(on ? '❯ ' : '  ', { fg: on ? fg : t.faint }),
          // A filled dot marks what is active right now, so the picker always
          // shows where you are as well as where the cursor is.
          run(it.current ? '● ' : '○ ', { fg: it.current ? (it.color || t.success) : t.faint }),
          run(it.label, { fg: on ? fg : (it.current ? t.text : t.dim), bold: on }),
        ];
        const desc = it.desc
          ? truncate([run(it.desc, { fg: on ? t.dim : t.faint })], Math.max(4, w - labelW - 8), '…')
          : [];
        body.push([...pad(head, labelW + 4), ...desc]);
      });

      if (o.items.length > maxRows) {
        body.push([run(`  ${o.selected + 1}/${o.items.length}`, { fg: t.faint })]);
      }
      return drawBox(body, {
        width: w, theme: t, padX: 1,
        title: [run(o.title, { fg: t.rainbow ? t.pulse(0) : t.primary, bold: true })],
        footer: [run(o.footer || '↑↓ select · enter confirm · esc cancel', { fg: t.faint })],
      });
    }

    return [];
  }

  // ── input ─────────────────────────────────────────────────────────────────

  handleEvent(ev) {
    this.transientHint = null;

    if (this.overlay) { this.handleOverlayKey(ev); return; }
    if (ev.type === 'paste') { this.editor.insert(ev.text); this.afterEdit(); return; }
    if (ev.type !== 'key') return;

    // ── global keys ────────────────────────────────────────────────────────
    if (ev.ctrl && ev.name === 'c') return this.onCtrlC();
    if (ev.ctrl && ev.name === 'd') {
      if (this.editor.isEmpty && this.mode !== 'busy') return this.stop(0);
      this.editor.del();
      return this.afterEdit();
    }
    if (ev.ctrl && ev.name === 'l') { this.screen.prev = []; return this.requestRender(true); }
    if (ev.ctrl && ev.name === 'p') {
      if (this.editor.isEmpty) this.editor.insert('/');
      return this.afterEdit();
    }
    if (ev.ctrl && ev.name === 'o') {
      this.verbose = !this.verbose;
      return this.flash(`Tool detail ${this.verbose ? 'expanded' : 'collapsed'}`);
    }
    if (ev.ctrl && ev.name === 'r') {
      this.theme.rainbow = !this.theme.rainbow;
      this.syncTicker();
      return this.flash(this.theme.rainbow ? '🌈 rainbow engaged' : 'rainbow off');
    }
    if (ev.name === 'pageup' || (ev.shift && ev.name === 'up')) return this.scrollBy(+5);
    if (ev.name === 'pagedown' || (ev.shift && ev.name === 'down')) return this.scrollBy(-5);
    if (ev.ctrl && ev.name === 'home') return this.scrollBy(+1e9);
    if (ev.ctrl && ev.name === 'end') return this.scrollBy(-1e9);

    if (ev.name === 'escape') {
      if (this.suggestion) { this.suggestion = null; return this.requestRender(); }
      if (this.mode === 'busy') return this.interrupt();
      if (!this.editor.isEmpty) { this.editor.clear(); return this.afterEdit(); }
      if (this.scroll) return this.scrollBy(-1e9);
      return;
    }

    // ── suggestion popup ───────────────────────────────────────────────────
    if (this.suggestion) {
      const n = this.suggestion.items.length;
      if (ev.name === 'up') { this.sugIndex = (this.sugIndex - 1 + n) % n; return this.requestRender(); }
      if (ev.name === 'down') { this.sugIndex = (this.sugIndex + 1) % n; return this.requestRender(); }
      if (ev.name === 'tab' || (ev.name === 'return' && this.suggestion.kind === 'file')) {
        return this.acceptSuggestion();
      }
      if (ev.name === 'return') {
        // Enter on a command popup accepts it only when it is a prefix match;
        // otherwise the user clearly meant to submit what they typed.
        const exact = getCommand(this.editor.value.slice(1).split(/\s/)[0]);
        if (!exact) return this.acceptSuggestion();
      }
    }

    if (this.mode === 'busy') {
      // Keep typing while a turn runs; enter queues rather than interleaves.
      const res = this.editor.handleKey(ev);
      if (res === 'submit') return this.flash('Still working — press esc to interrupt', 'warn');
      if (res) return this.afterEdit();
      return;
    }

    const res = this.editor.handleKey(ev);
    if (res === 'submit') return this.submit();
    if (res === 'consumed') return this.afterEdit();
  }

  handleOverlayKey(ev) {
    if (this.overlay?.kind === 'login') return this.handleLoginKey(ev);
    if (ev.type !== 'key') return;
    const o = this.overlay;
    const n = o.items ? o.items.length : o.options.length;

    if (ev.ctrl && ev.name === 'c') return this.onCtrlC();
    if (ev.name === 'up') { o.selected = (o.selected - 1 + n) % n; return this.requestRender(); }
    if (ev.name === 'down') { o.selected = (o.selected + 1) % n; return this.requestRender(); }
    if (/^[1-9]$/.test(ev.name)) {
      const i = Number(ev.name) - 1;
      if (i < n) { o.selected = i; return this.closeOverlay(i); }
      return;
    }
    if (o.kind === 'permission') {
      if (ev.name === 'y') return this.closeOverlay(0);
      if (ev.name === 'a') return this.closeOverlay(Math.min(1, n - 1));
      if (ev.name === 'n' || ev.name === 'escape') return this.closeOverlay(n - 1);
    }
    if (ev.name === 'escape') return this.closeOverlay(-1);
    if (ev.name === 'return') return this.closeOverlay(o.selected);
  }

  renderLoginOverlay(o, w) {
    const t = this.theme;
    const inner = w - 4;
    const body = [];

    if (o.mode === 'submitting') {
      body.push([run('Signing you in…', { fg: t.text })]);
      return drawBox(body, {
        width: w, theme: t, padX: 1, color: t.primary,
        title: [run('Tripplet', { fg: t.rainbow ? t.pulse(0) : t.primary, bold: true })],
      });
    }

    if (o.mode === 'paste') {
      body.push([run('Paste the code from your browser', { fg: t.text, bold: true })]);
      body.push([]);
      body.push(...wrapText(
        'After approving, your browser lands on a page that may not load. Copy its whole address bar (or just the code) and paste it here.',
        inner, { fg: t.dim },
      ));
      body.push([]);
      const shown = o.buffer || '';
      const tail = shown.length > inner - 4 ? `…${shown.slice(-(inner - 5))}` : shown;
      body.push([
        run('› ', { fg: t.primary, bold: true }),
        run(tail || 'waiting for paste…', { fg: shown ? t.user : t.faint, italic: !shown }),
      ]);
      if (shown) body.push([run(`  ${shown.length} characters`, { fg: t.faint })]);
      if (o.error) { body.push([]); body.push([run(o.error, { fg: t.error })]); }
      return drawBox(body, {
        width: w, theme: t, padX: 1, color: t.primary,
        title: [run('Sign in to Tripplet', { fg: t.rainbow ? t.pulse(0) : t.primary, bold: true })],
        footer: [run('enter submit · ctrl+u clear · esc back', { fg: t.faint })],
      });
    }

    // waiting on the browser
    body.push(o.opened
      ? [run('✓ ', { fg: t.success }), run('Opened your browser. Approve the request there.', { fg: t.text })]
      : [run('▲ ', { fg: t.warn }), run('Could not open a browser automatically.', { fg: t.text })]);
    if (!o.opened && o.openReason) body.push([run(`  ${o.openReason}`, { fg: t.faint })]);
    body.push([]);
    body.push([run('Sign-in link', { fg: t.dim })]);
    for (const l of wrapText(o.url || '', inner, { fg: t.info, underline: true })) body.push(l);
    body.push([]);
    body.push([
      run('c', { fg: t.primary, bold: true }), run(' copy link   ', { fg: t.faint }),
      run('o', { fg: t.primary, bold: true }), run(' open again   ', { fg: t.faint }),
      run('p', { fg: t.primary, bold: true }), run(' paste a code', { fg: t.faint }),
    ]);
    if (o.notice) {
      body.push([]);
      body.push(...wrapText(o.notice, inner, { fg: t[o.noticeLevel] || t.dim }));
    }
    return drawBox(body, {
      width: w, theme: t, padX: 1, color: t.primary,
      title: [run('Sign in to Tripplet', { fg: t.rainbow ? t.pulse(0) : t.primary, bold: true })],
      footer: [run('waiting for approval · esc cancel', { fg: t.faint })],
    });
  }

  /**
   * The login window: choose which Tripplet deployment, then sign in. On
   * startup, cancelling just drops you into the (gated) app.
   */
  async promptLogin({ startup = false } = {}) {
    const { DEPLOYMENTS, DEFAULT_BASE_URL } = await import('./auth/oauth.js');
    const configured = this.config.authUrl || DEFAULT_BASE_URL;

    // If the user pinned a deployment that is not one of the known three, don't
    // second-guess it — sign straight in to that one.
    const known = DEPLOYMENTS.some((d) => d.url === configured);
    let target = configured;

    if (known && DEPLOYMENTS.length > 1) {
      const chosen = await this.select({
        title: 'Sign in to Tripplet',
        footer: 'enter to sign in · esc to skip',
        items: DEPLOYMENTS.map((d) => ({
          label: d.label,
          value: d.url,
          desc: d.desc,
          current: d.url === configured,
        })),
      });
      if (!chosen) {
        if (startup) {
          this.session.notice('Skipped sign-in — run /login when you are ready.', 'warn');
          this.requestRender(true);
        }
        return { ok: false, skipped: true };
      }
      target = chosen;
      this.config.authUrl = target;
    }
    return this.runLogin({ baseUrl: target });
  }

  /**
   * Run the OAuth flow, driving the overlay. Resolves once signed in or
   * cancelled; never throws at the caller.
   */
  async runLogin({ baseUrl } = {}) {
    const { login } = await import('./auth/login.js');
    const { DEFAULT_BASE_URL } = await import('./auth/oauth.js');
    const target = baseUrl || this.config.authUrl || DEFAULT_BASE_URL;

    const ctrl = new AbortController();
    let submitManual;
    const manual = new Promise((resolve) => { submitManual = resolve; });

    this.session.notice(`Signing in to ${target}…`, 'info');
    this.requestRender(true);

    try {
      const { auth, method } = await login({
        baseUrl: target,
        signal: ctrl.signal,
        onReady: ({ url, opened, openReason }) => {
          this.overlay = {
            kind: 'login',
            url,
            opened,
            openReason,
            mode: 'wait',
            buffer: '',
            submit: (text) => submitManual(text),
            cancel: () => { ctrl.abort(); submitManual(null); },
          };
          this.requestRender(true);
        },
        waitForManual: () => manual,
      });

      this.overlay = null;
      this.authed = true;
      this.session.notice(
        `Signed in${auth.email ? ` as ${auth.email}` : ''} · ${target}${method === 'manual' ? ' (pasted code)' : ''}`,
        'success',
      );
      this.requestRender(true);
      return { ok: true, auth };
    } catch (err) {
      this.overlay = null;
      const cancelled = err?.code === 'cancelled';
      this.session.notice(cancelled ? 'Sign-in cancelled.' : `Sign-in failed: ${err.message}`, cancelled ? 'warn' : 'error');
      if (err?.hint) this.session.notice(err.hint, 'info');
      this.requestRender(true);
      return { ok: false, error: err.message };
    }
  }

  /**
   * The sign-in overlay. Two states: waiting on the browser, or collecting a
   * pasted code for when the browser never got there.
   */
  handleLoginKey(ev) {
    const o = this.overlay;
    if (ev.type === 'paste') {
      o.mode = 'paste';
      o.buffer = (o.buffer || '') + ev.text.replace(/\s+/g, ' ').trim();
      return this.requestRender(true);
    }
    if (ev.type !== 'key') return;

    if (ev.ctrl && ev.name === 'c') {
      if (o.mode === 'paste' && o.buffer) { o.buffer = ''; return this.requestRender(true); }
      return this.cancelLogin();
    }
    if (ev.name === 'escape') {
      if (o.mode === 'paste') { o.mode = 'wait'; o.buffer = ''; o.error = null; return this.requestRender(true); }
      return this.cancelLogin();
    }

    if (o.mode !== 'paste') {
      if (ev.name === 'c') return this.copyLoginUrl();
      if (ev.name === 'p') { o.mode = 'paste'; o.buffer = ''; return this.requestRender(true); }
      if (ev.name === 'o') return this.reopenLoginUrl();
      return;
    }

    // paste mode
    if (ev.name === 'return') {
      const text = (o.buffer || '').trim();
      if (!text) { o.error = 'Paste the code (or the whole URL) first.'; return this.requestRender(true); }
      o.submit(text);
      o.mode = 'submitting';
      o.error = null;
      return this.requestRender(true);
    }
    if (ev.name === 'backspace') { o.buffer = (o.buffer || '').slice(0, -1); return this.requestRender(true); }
    if (ev.ctrl && ev.name === 'u') { o.buffer = ''; return this.requestRender(true); }
    if (ev.ctrl && ev.name === 'v') return this.pasteFromClipboard();
    if (isPrintable(ev)) { o.buffer = (o.buffer || '') + charOf(ev); return this.requestRender(true); }
  }

  async copyLoginUrl() {
    const o = this.overlay;
    if (!o?.url) return;
    const { copyToClipboard } = await import('./auth/browser.js');
    const res = await copyToClipboard(o.url);
    o.notice = res.copied
      ? 'Link copied — paste it into a browser, then press p to enter the code.'
      : `Could not copy automatically (${res.reason}). Select the link above by hand.`;
    o.noticeLevel = res.copied ? 'success' : 'warn';
    this.requestRender(true);
  }

  async reopenLoginUrl() {
    const o = this.overlay;
    if (!o?.url) return;
    const { openUrl } = await import('./auth/browser.js');
    const res = await openUrl(o.url);
    o.notice = res.opened ? 'Asked your browser again…' : `Still could not open a browser (${res.reason}).`;
    o.noticeLevel = res.opened ? 'success' : 'warn';
    this.requestRender(true);
  }

  async pasteFromClipboard() {
    const o = this.overlay;
    const { readClipboard } = await import('./auth/browser.js');
    const text = await readClipboard();
    if (text) { o.buffer = text.replace(/\s+/g, ' ').trim(); o.error = null; }
    else o.error = 'Nothing readable on the clipboard — type or paste with your terminal.';
    this.requestRender(true);
  }

  cancelLogin() {
    const o = this.overlay;
    this.overlay = null;
    o?.cancel?.();
    this.requestRender(true);
  }

  closeOverlay(index) {
    const o = this.overlay;
    this.overlay = null;
    const value = index < 0
      ? null
      : (o.items ? o.items[index]?.value : o.options[index]?.value);
    o.resolve?.(value ?? null);
    this.requestRender();
  }

  afterEdit() {
    const text = this.editor.value;
    const caret = caretOffset(this.editor);
    const sug = suggest(text, caret, { commands: COMMANDS, cwd: this.session.cwd });
    if (!sug || !this.suggestion || sug.kind !== this.suggestion.kind || sug.query !== this.suggestion.query) {
      this.sugIndex = 0;
    }
    this.suggestion = sug;
    if (this.sugIndex >= (sug?.items.length ?? 0)) this.sugIndex = 0;
    this.requestRender();
  }

  acceptSuggestion() {
    const item = this.suggestion.items[this.sugIndex];
    if (!item) return;
    const { text, caret } = applySuggestion(this.editor.value, this.suggestion, item);
    this.editor.setValue(text);
    setCaretOffset(this.editor, caret);
    this.suggestion = null;
    this.afterEdit();
  }

  scrollBy(n) {
    this.scroll = Math.max(0, Math.min((this.maxScroll ?? 0), this.scroll + n));
    this.requestRender();
  }

  flash(text, level = 'dim') {
    this.transientHint = { text, level };
    this.requestRender(true);
    setTimeout(() => {
      if (this.transientHint?.text === text) { this.transientHint = null; this.requestRender(); }
    }, 2200);
  }

  onCtrlC() {
    if (this.overlay) { this.closeOverlay(-1); return; }
    if (this.mode === 'busy') return this.interrupt();
    if (!this.editor.isEmpty) { this.editor.clear(); return this.afterEdit(); }
    const now = Date.now();
    if (now - this.lastCtrlC < 1500) return this.stop(0);
    this.lastCtrlC = now;
    this.flash('Press ctrl+c again to exit', 'warn');
  }

  interrupt() {
    this.abortCtrl?.abort();
    this.flash('Interrupting…', 'warn');
  }

  // ── turns ─────────────────────────────────────────────────────────────────

  submit() {
    const text = this.editor.value.trim();
    if (!text) return;
    this.editor.remember(text);
    this.editor.clear();
    this.suggestion = null;
    this.scroll = 0;
    this.requestRender(true);

    if (text.startsWith('/')) {
      this.runCommand(text).catch((err) => {
        this.session.notice(`Command failed: ${err.message}`, 'error');
        this.requestRender();
      });
      return;
    }

    if (!this.authed) {
      this.session.notice('You need to sign in before Astrocode can answer. Run /login.', 'warn');
      this.requestRender(true);
      return;
    }

    this.session.user(text);
    this.runTurn(text).catch((err) => {
      this.session.notice(`${err.message}`, 'error');
      this.mode = 'input';
      this.syncTicker();
      this.requestRender();
    });
  }

  /**
   * Remember a preference across sessions. Gated on `autosave` so an embedded
   * or test-driven App never writes to the user's real config.
   */
  persist(patch) {
    if (this.config.autosave === false) return;
    saveConfig(patch);
  }

  commandContext() {
    return {
      app: this,
      session: this.session,
      config: this.config,
      theme: this.theme,
      permissions: this.permissions,
      tools: TOOLS,
      cwd: this.session.cwd,
      version: this.version,
      git,
      print: (l) => {
        const lines = Array.isArray(l) && Array.isArray(l[0]) ? l : [l];
        this.session.lines(lines);
        this.requestRender();
      },
      notice: (text, level) => { this.session.notice(text, level); this.requestRender(); },
      setModel: (m) => {
        const model = typeof m === 'string' ? getModel(m) : m;
        if (!model) return null;
        this.session.setModel(model);
        for (const e of Object.values(this._engines)) e.session = this.session;
        this.persist({ model: model.id });
        this.requestRender();
        return model;
      },
      setEffort: (e) => {
        const eff = typeof e === 'string' ? getEffort(e) : e;
        if (!eff) return null;
        this.session.setEffort(eff);
        this.persist({ effort: eff.id });
        this.requestRender();
        return eff;
      },
      setTheme: (name) => {
        this.theme.setPalette(name);
        this.screen.prev = [];
        this.persist({ theme: name });
        this.requestRender(true);
        return this.theme;
      },
      toggleRainbow: (on) => {
        this.theme.rainbow = on ?? !this.theme.rainbow;
        this.syncTicker();
        this.requestRender(true);
        return this.theme.rainbow;
      },
      select: (opts) => this.select(opts),
      clear: () => {
        this.session.clear();
        if (this.config.showWelcome !== false) this.session.push({ kind: 'welcome' });
        this.scroll = 0;
        invalidateFileIndex();
        this.requestRender(true);
      },
      quit: (code = 0) => this.stop(code),
      refreshGit: () => this.refreshGit(),
    };
  }

  async runCommand(text) {
    const [head, ...rest] = text.slice(1).split(/\s+/);
    const cmd = getCommand(head);
    if (!cmd) {
      this.session.notice(`Unknown command /${head} — try /help`, 'error');
      this.requestRender();
      return;
    }
    this.session.push({ kind: 'user', text });
    const ctx = this.commandContext();
    try {
      const res = await cmd.run(ctx, rest);
      if (res && res.ok === false && res.message) this.session.notice(res.message, 'error');
      else if (res && res.message) this.session.notice(res.message, 'success');
    } catch (err) {
      this.session.notice(`/${head} failed: ${err.message}`, 'error');
    }
    this.requestRender(true);
  }

  /** Ask the user something; resolves to the chosen value or null. */
  /**
   * Arrow-key picker. Opens on whatever is currently active, so `enter`
   * without moving is always a no-op rather than a surprise.
   * @returns {Promise<*|null>} the chosen item's `value`, or null if cancelled
   */
  select({ title, items, footer }) {
    if (!items?.length) return Promise.resolve(null);
    const initial = Math.max(0, items.findIndex((i) => i.current));
    return new Promise((resolve) => {
      this.overlay = { kind: 'select', title, items, footer, selected: initial, resolve };
      this.requestRender(true);
    });
  }

  askPermission(request) {
    return new Promise((resolve) => {
      const options = [
        { label: 'Yes', value: 'once' },
        { label: `Yes, and don't ask again for ${request.key}`, value: 'session' },
        { label: 'No, stop and tell Astrocode what to do instead', value: 'deny' },
      ];
      this.overlay = {
        kind: 'permission',
        title: `Astrocode wants to run ${request.title}`,
        detail: request.preview,
        options,
        selected: 0,
        resolve: (v) => resolve(v ?? 'deny'),
      };
      this.requestRender(true);
    });
  }

  async runTurn(text) {
    this.mode = 'busy';
    this.spinner.start();
    this.streamedTokens = 0;
    this.syncTicker();
    this.requestRender(true);

    const ctrl = new AbortController();
    this.abortCtrl = ctrl;
    let think = null;
    let answer = null;
    const toolBlocks = new Map();

    try {
      for await (const ev of this.engine.send(text, { signal: ctrl.signal })) {
        switch (ev.type) {
          case 'thinking-delta':
            if (!think) think = this.session.thinking();
            think.text += ev.text;
            this.streamedTokens += 1;
            break;
          case 'thinking-end':
            if (think) think.done = true;
            think = null;
            break;
          case 'tool-start': {
            const b = this.session.tool(ev.tool, ev.title, ev.describe);
            toolBlocks.set(ev.id, b);
            break;
          }
          case 'tool-permission': {
            const decision = await this.askPermission(ev.request);
            ev.resolve(decision);
            break;
          }
          case 'tool-end': {
            const b = toolBlocks.get(ev.id);
            if (b) {
              b.status = ev.ok ? 'ok' : (ev.denied ? 'denied' : 'error');
              b.summary = ev.summary || '';
              b.detail = ev.detail ?? null;
              b.meta = ev.meta ?? null;
            }
            if (ev.meta?.path && ev.ok && (ev.meta.added || ev.meta.removed || ev.meta.created)) {
              this.session.trackFile(ev.meta.path, ev.meta);
              invalidateFileIndex();
            }
            break;
          }
          case 'text-delta':
            if (!answer) answer = this.session.assistant();
            answer.text += ev.text;
            this.streamedTokens += 1;
            break;
          case 'usage':
            this.session.addUsage(this.session.model.id, ev.input, ev.output);
            break;
          case 'notice':
            this.session.notice(ev.text, ev.level || 'info');
            break;
          case 'done':
            if (ev.reason === 'aborted') this.session.notice('Interrupted by user', 'warn');
            if (ev.reason === 'error') this.session.notice(ev.error || 'Engine error', 'error');
            break;
          default:
            break;
        }
        if (this.scroll === 0) this.requestRender();
      }
    } finally {
      this.abortCtrl = null;
      this.mode = 'input';
      this.spinner.stop();
      this.syncTicker();
      if (this.config.autosave !== false) this.session.save();
      this.requestRender(true);
      this.refreshGit().catch(() => {});
    }
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function caretOffset(editor) {
  let n = 0;
  for (let i = 0; i < editor.line; i++) n += editor.lines[i].length + 1;
  return n + [...editor.lines[editor.line]].slice(0, editor.col).join('').length;
}

function setCaretOffset(editor, offset) {
  let n = 0;
  for (let i = 0; i < editor.lines.length; i++) {
    const len = editor.lines[i].length;
    if (offset <= n + len) {
      editor.line = i;
      editor.col = [...editor.lines[i].slice(0, offset - n)].length;
      return;
    }
    n += len + 1;
  }
  editor.line = editor.lines.length - 1;
  editor.col = [...editor.lines[editor.line]].length;
}

function shortUser() {
  return process.env.USER || process.env.USERNAME || 'you';
}

export default App;
