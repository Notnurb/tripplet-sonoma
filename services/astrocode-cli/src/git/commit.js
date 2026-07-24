/**
 * commit.js — turns a dirty work tree into a commit message, then a commit.
 *
 * Two jobs live here. `summariseChanges` is the heuristic that reads a git
 * status + unified diff and writes a conventional-commit subject and body, and
 * `buildCommitMessage` glues that onto the Astrocode trailer.
 *
 * The trailer is not optional. Every message Astrocode writes ends with a blank
 * line, then:
 *
 *   🚀 Generated with Astrocode
 *
 *   Co-Authored by <Model Display Name> - Tripplet
 *
 * with one Co-Authored line per distinct model used in the session, in
 * first-use order.
 */

import { commitAuthor, getModel, DEFAULT_MODEL_ID } from '../core/models.js';
import * as defaultGit from './git.js';

export const TRAILER = '🚀 Generated with Astrocode';

const SUBJECT_MAX = 72;
const MAX_BULLETS = 12;

/** Conventional-commit types, in the order ties are broken. */
const TYPE_ORDER = ['feat', 'fix', 'refactor', 'perf', 'docs', 'test', 'style', 'ci', 'chore'];

// `fix: fix x` and `refactor: refactor x` stutter, hence the synonyms
const VERBS = {
  feat: 'add',
  fix: 'correct',
  refactor: 'restructure',
  perf: 'optimise',
  docs: 'update',
  test: 'update',
  style: 'reformat',
  ci: 'update',
  chore: 'update',
};

// ── the trailer ─────────────────────────────────────────────────────────────

/**
 * Normalise anything model-shaped into a `Name - Tripplet` author string.
 * Accepts a Model, a message/turn object carrying `.model`, a model id or
 * alias, or an already-formatted author line.
 */
function authorLine(x) {
  if (!x || Array.isArray(x)) return null;
  if (typeof x === 'object') {
    if (x.model) return authorLine(x.model);
    if (typeof x.name === 'string' && x.name.trim()) return commitAuthor(x);
    if (typeof x.id === 'string') return authorLine(x.id);
    return null;
  }
  const s = String(x).trim();
  if (!s) return null;
  const m = getModel(s);
  if (m) return commitAuthor(m);
  return /\s-\s*Tripplet$/i.test(s) ? s : `${s} - Tripplet`;
}

const isTrailerLine = (l) => {
  const t = l.trim();
  return t === TRAILER || /^Co-Authored[ -]by\s/i.test(t);
};

function hardTrim(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:-]+$/, '');
}

function cleanSubject(subject) {
  let s = String(subject ?? '').replace(/\r/g, '').split('\n')[0].trim().replace(/\s+/g, ' ');
  s = s.replace(/^[-*]\s+/, '').replace(/\.+$/, '');
  if (!s) s = 'chore: update working tree';
  return hardTrim(s, SUBJECT_MAX);
}

function cleanBody(body) {
  if (body == null) return '';
  const text = Array.isArray(body) ? body.join('\n') : String(body);
  const kept = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const l = raw.replace(/\s+$/, '');
    // a body that already carries a trailer must not produce a second one
    if (isTrailerLine(l)) continue;
    if (!l && kept.length && !kept[kept.length - 1]) continue;
    kept.push(l);
  }
  while (kept.length && !kept[0]) kept.shift();
  while (kept.length && !kept[kept.length - 1]) kept.pop();
  return kept.join('\n');
}

/**
 * @param {{subject:string, body?:string|string[], model?:object|string,
 *   coAuthors?:Array<object|string>}} spec
 * @returns {string} the full commit message, trailer included, no trailing newline
 */
export function buildCommitMessage({ subject, body, model, coAuthors = [] } = {}) {
  const authors = [];
  const seen = new Set();
  for (const candidate of [model, ...(coAuthors || [])]) {
    const l = authorLine(candidate);
    if (!l || seen.has(l)) continue;
    seen.add(l);
    authors.push(l);
  }
  if (!authors.length) authors.push(commitAuthor(getModel(DEFAULT_MODEL_ID)));

  const out = [cleanSubject(subject)];
  const b = cleanBody(body);
  if (b) out.push('', b);
  out.push('', TRAILER, '');
  for (const a of authors) out.push(`Co-Authored by ${a}`);
  return out.join('\n');
}

/** The inverse of the trailer: a message with the Astrocode block removed. */
export function stripTrailer(message) {
  const out = [];
  for (const l of String(message ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (isTrailerLine(l)) continue;
    out.push(l);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join('\n');
}

// ── path classification ─────────────────────────────────────────────────────

const base = (p) => String(p).split('/').filter(Boolean).pop() || String(p);

const isCi = (p) => /(^|\/)(\.github\/workflows|\.gitlab-ci|\.circleci|\.travis|azure-pipelines)/i.test(p);

const isTestPath = (p) => /(^|\/)(tests?|spec|specs|__tests__|e2e)\//i.test(p)
  || /\.(test|spec)\.[a-z0-9]+$/i.test(p)
  || /_test\.[a-z0-9]+$/i.test(p);

const isDocPath = (p) => /(^|\/)(docs?|documentation)\//i.test(p)
  || /\.(md|mdx|rst|adoc|txt)$/i.test(p)
  || /(^|\/)(readme|changelog|license|licence|contributing|authors|notice)(\.|$)/i.test(p);

const isConfigPath = (p) => /(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|tsconfig[^/]*\.json|jsconfig\.json|\.eslintrc[^/]*|eslint\.config\.[a-z]+|\.prettierrc[^/]*|\.gitignore|\.gitattributes|\.npmrc|\.nvmrc|\.editorconfig|Makefile|Dockerfile|docker-compose\.ya?ml|[a-z]+\.config\.[a-z]+|Cargo\.toml|go\.mod|go\.sum|requirements\.txt|pyproject\.toml)$/i.test(p);

const isStylePath = (p) => /\.(css|scss|sass|less|styl)$/i.test(p);

const churn = (f) => f.added + f.removed;
const byChurn = (a, b) => churn(b) - churn(a) || a.path.localeCompare(b.path);

/**
 * The dominant directory, used as the conventional-commit scope.
 * Container directories (`src`, `packages`, …) are skipped so
 * `src/ui/text.js` scopes to `ui`, not `src`.
 */
function scopeOf(p) {
  const parts = String(p).split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const skip = new Set(['src', 'lib', 'source', 'app', 'apps', 'packages', 'pkg', 'internal', 'cmd']);
  let i = 0;
  while (i < parts.length - 1 && skip.has(parts[i])) i++;
  if (i >= parts.length - 1) return null;
  const seg = parts[i].replace(/\.[^.]+$/, '');
  return seg && seg.length <= 16 ? seg : null;
}

function scopeFor(paths) {
  const counts = new Map();
  for (const p of paths) {
    const s = scopeOf(p);
    if (s) counts.set(s, (counts.get(s) || 0) + 1);
  }
  if (!counts.size) return null;
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  // a scope is only meaningful when most of the change lives there
  return n / paths.length >= 0.6 ? top : null;
}

// ── diff parsing ────────────────────────────────────────────────────────────

const FIX_RE = /\b(fix(e[sd])?|bug|regression|crash|revert|guard|fallback|catch|invalid|missing|incorrect|broken|typo|edge case)\b/i;
const FEAT_RE = /(\bexport\s+(async\s+)?(function|class|const|default)\b|^\s*(def|func|fn|class)\s+\w+)/;
const PERF_RE = /\b(perf|performance|optimi[sz]e[ds]?|memoi[sz]e|fast path|throttle|debounce|lazily|preallocate)\b/i;

function unquote(s) {
  const t = s.trim();
  if (t.length > 1 && t[0] === '"' && t[t.length - 1] === '"') {
    try {
      return JSON.parse(t);
    } catch {
      return t.slice(1, -1); // git escaped something JSON cannot parse; close enough
    }
  }
  return t;
}

const stripSide = (s) => unquote(String(s).split('\t')[0]).replace(/^[ab]\//, '');

function headerPath(line) {
  const rest = line.slice('diff --git '.length).trim();
  const m = / b\/(.*)$/.exec(rest);
  if (m) return unquote(m[1]);
  const last = rest.split(' ').pop() || '';
  return unquote(last).replace(/^[ab]\//, '');
}

/** Parse a unified diff into per-file counts, kinds and keyword hits. */
function parseUnifiedDiff(text) {
  const out = [];
  let cur = null;
  const push = () => {
    if (cur && cur.path) out.push(cur);
    cur = null;
  };
  const start = (path) => {
    push();
    cur = { path, kind: null, orig: undefined, added: 0, removed: 0, sawHunk: false, hits: { fix: 0, feat: 0, perf: 0 } };
  };

  for (const raw of String(text).split('\n')) {
    if (raw.startsWith('diff --git ')) {
      start(headerPath(raw));
      continue;
    }
    if (raw.startsWith('--- ')) {
      if (!cur || cur.sawHunk) start('');
      const p = stripSide(raw.slice(4));
      if (p === '/dev/null') cur.kind = 'added';
      else if (!cur.orig) cur.orig = p;
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith('+++ ')) {
      const p = stripSide(raw.slice(4));
      if (p === '/dev/null') cur.kind = 'deleted';
      else if (!cur.path) cur.path = p;
      continue;
    }
    if (raw.startsWith('new file mode')) { cur.kind = 'added'; continue; }
    if (raw.startsWith('deleted file mode')) { cur.kind = 'deleted'; continue; }
    if (raw.startsWith('rename from ')) { cur.orig = raw.slice(12).trim(); cur.kind = 'renamed'; continue; }
    if (raw.startsWith('rename to ')) { cur.path = raw.slice(10).trim(); cur.kind = 'renamed'; continue; }
    if (raw.startsWith('@@')) { cur.sawHunk = true; continue; }
    if (!cur.sawHunk) continue;
    if (raw.startsWith('+')) {
      cur.added++;
      const body = raw.slice(1);
      if (FIX_RE.test(body)) cur.hits.fix++;
      if (FEAT_RE.test(body)) cur.hits.feat++;
      if (PERF_RE.test(body)) cur.hits.perf++;
      continue;
    }
    if (raw.startsWith('-')) cur.removed++;
  }
  push();
  return out;
}

const pathOf = (entry) => {
  if (!entry) return '';
  if (typeof entry === 'string') return entry;
  return String(entry.path || entry.file || entry.name || '');
};

function kindOf(entry) {
  if (!entry || typeof entry === 'string') return null;
  const s = String(entry.status || '').toLowerCase();
  if (s === 'added' || s === 'untracked' || s === 'copied') return 'added';
  if (s === 'deleted') return 'deleted';
  if (s === 'renamed') return 'renamed';
  return 'modified';
}

/** Merge what the diff knows (counts, kinds) with what status knows (paths). */
function collectFiles(status, diffText) {
  const map = new Map();
  const touch = (p) => {
    let f = map.get(p);
    if (!f) {
      f = { path: p, kind: 'modified', orig: undefined, added: 0, removed: 0, hits: { fix: 0, feat: 0, perf: 0 } };
      map.set(p, f);
    }
    return f;
  };

  for (const d of parseUnifiedDiff(diffText || '')) {
    const f = touch(d.path);
    f.added = d.added;
    f.removed = d.removed;
    f.hits = d.hits;
    if (d.kind) f.kind = d.kind;
    if (d.orig && d.orig !== d.path) f.orig = d.orig;
  }

  const fromStatus = (entry, fallbackKind) => {
    const p = pathOf(entry);
    if (!p) return;
    const known = map.has(p);
    const f = touch(p);
    const k = kindOf(entry) || fallbackKind;
    if (!known && k) f.kind = k;
    if (!f.orig && entry && typeof entry === 'object' && entry.orig) f.orig = entry.orig;
  };

  for (const e of status?.staged || []) fromStatus(e, 'modified');
  for (const e of status?.unstaged || []) fromStatus(e, 'modified');
  for (const e of status?.conflicted || []) fromStatus(e, 'modified');
  for (const e of status?.untracked || []) fromStatus(e, 'added');

  // `status.files` is the aggregate view; fall back to it when a caller passed
  // only that. touch() dedupes by path, so this cannot double-count.
  if (!map.size) for (const e of status?.files || []) fromStatus(e, 'modified');

  return [...map.values()];
}

// ── the heuristic ───────────────────────────────────────────────────────────

function classifyType(files) {
  const score = Object.create(null);
  const bump = (t, v) => { score[t] = (score[t] || 0) + v; };
  const hasSource = files.some((f) => {
    const p = f.path;
    return !isCi(p) && !isTestPath(p) && !isDocPath(p) && !isConfigPath(p) && !isStylePath(p);
  });

  for (const f of files) {
    const p = f.path;
    const w = Math.max(1, churn(f));
    if (isCi(p)) { bump('ci', w); continue; }
    // tests and docs alongside real source are supporting cast, not the story
    if (isTestPath(p)) { bump('test', w * (hasSource ? 0.35 : 1)); continue; }
    if (isDocPath(p)) { bump('docs', w * (hasSource ? 0.35 : 1)); continue; }
    if (isConfigPath(p)) { bump('chore', w * (hasSource ? 0.5 : 1)); continue; }
    if (isStylePath(p)) { bump('style', w * 0.8); continue; }

    if (f.kind === 'added') bump('feat', w * 1.3);
    else if (f.kind === 'deleted') { bump('refactor', w * 0.7); bump('chore', w * 0.3); }
    else if (f.kind === 'renamed') bump('refactor', w * 1.3);
    else {
      const ratio = f.added / Math.max(1, f.removed);
      if (ratio >= 2.5) bump('feat', w * 0.9);
      else if (ratio <= 0.5) bump('refactor', w * 0.8);
      else { bump('fix', w * 0.7); bump('refactor', w * 0.3); }
    }

    // keyword evidence, scaled by how much of the addition it covers
    const denom = Math.max(1, f.added);
    bump('fix', w * Math.min(1, (f.hits.fix / denom) * 5) * 1.0);
    bump('feat', w * Math.min(1, (f.hits.feat / denom) * 5) * 0.7);
    bump('perf', w * Math.min(1, (f.hits.perf / denom) * 5) * 0.7);
  }

  let best = 'chore';
  let bestScore = -1;
  for (const t of TYPE_ORDER) {
    const v = score[t] || 0;
    if (v > bestScore) { best = t; bestScore = v; }
  }
  return bestScore > 0 ? best : 'chore';
}

function namePhrase(files, max = 2) {
  const names = files.map((f) => base(f.path));
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

function describeChanges(type, files, compact) {
  const ranked = [...files].sort(byChurn);
  const added = files.filter((f) => f.kind === 'added');
  const deleted = files.filter((f) => f.kind === 'deleted');
  const verb = VERBS[type] || 'update';

  if (files.length === 1) {
    const f = files[0];
    if (f.kind === 'renamed' && f.orig) return `rename ${base(f.orig)} to ${base(f.path)}`;
    if (f.kind === 'added') return `add ${base(f.path)}`;
    if (f.kind === 'deleted') return `remove ${base(f.path)}`;
    return `${verb} ${base(f.path)}`;
  }

  const focus = type === 'feat' && added.length ? [...added].sort(byChurn) : ranked;
  const what = compact ? `${files.length} files` : namePhrase(focus);
  if (deleted.length === files.length) return `remove ${what}`;
  if (added.length === files.length) return `add ${what}`;
  return `${verb} ${what}`;
}

function bulletFor(f) {
  const bits = [];
  if (f.added) bits.push(`+${f.added}`);
  if (f.removed) bits.push(`-${f.removed}`);
  const tag = bits.length ? ` (${bits.join('/')})` : '';
  if (f.kind === 'renamed' && f.orig) return `rename ${f.orig} -> ${f.path}${tag}`;
  const verb = f.kind === 'added' ? 'add' : f.kind === 'deleted' ? 'remove' : 'update';
  return `${verb} ${f.path}${tag}`;
}

function bodyFor(files) {
  const total = files.reduce(
    (a, f) => ({ added: a.added + f.added, removed: a.removed + f.removed }),
    { added: 0, removed: 0 },
  );
  const n = files.length;
  const head = [`${n} file${n === 1 ? '' : 's'} changed`];
  if (total.added) head.push(`${total.added} insertion${total.added === 1 ? '' : 's'}(+)`);
  if (total.removed) head.push(`${total.removed} deletion${total.removed === 1 ? '' : 's'}(-)`);

  const ranked = [...files].sort(byChurn);
  const shown = ranked.slice(0, MAX_BULLETS);
  const lines = [`${head.join(', ')}.`, ''];
  for (const f of shown) lines.push(`- ${bulletFor(f)}`);
  if (ranked.length > shown.length) {
    const rest = ranked.length - shown.length;
    lines.push(`- ...and ${rest} more file${rest === 1 ? '' : 's'}`);
  }
  return lines.join('\n');
}

/**
 * Heuristic conventional-commit summary of a working tree.
 * @param {object} status  from git.status()
 * @param {string} diff    unified diff text (may be empty)
 * @returns {{subject:string, body:string}}
 */
export function summariseChanges(status, diff) {
  const files = collectFiles(status, diff);
  if (!files.length) return { subject: 'chore: update working tree', body: '' };

  const type = classifyType(files);
  let scope = scopeFor(files.map((f) => f.path));
  // `test(test):` and `docs(docs):` read like a stutter
  if (scope && (scope === type || `${scope}s` === type || scope === `${type}s`)) scope = null;
  const head = `${type}${scope ? `(${scope})` : ''}: `;

  let subject = head + describeChanges(type, files, false);
  if (subject.length > SUBJECT_MAX) subject = head + describeChanges(type, files, true);
  if (subject.length > SUBJECT_MAX) subject = hardTrim(subject, SUBJECT_MAX);

  return { subject, body: bodyFor(files) };
}

// ── committing ──────────────────────────────────────────────────────────────

/** Every model-ish value a session might carry, roughly in first-use order. */
function harvestModels(session) {
  if (!session || typeof session !== 'object') return [];
  const out = [];
  const iter = (v) => (v && typeof v !== 'string' && typeof v[Symbol.iterator] === 'function' ? [...v] : []);
  for (const list of [session.modelsUsed, session.models, session.modelHistory]) out.push(...iter(list));
  for (const stream of [session.messages, session.transcript, session.turns, session.entries, session.history]) {
    for (const item of iter(stream)) {
      if (!item || typeof item !== 'object') continue;
      if (item.model) out.push(item.model);
      else if (item.modelId) out.push(item.modelId);
    }
  }
  if (session.model) out.push(session.model);
  else if (session.modelId) out.push(session.modelId);
  return out;
}

/**
 * Author lines for the trailer: session models in first-use order, with the
 * committing model appended if the session never mentioned it.
 */
function trailerAuthors(session, model) {
  const out = [];
  const seen = new Set();
  const add = (x) => {
    const l = authorLine(x);
    if (!l || seen.has(l)) return;
    seen.add(l);
    out.push(l);
  };
  for (const m of harvestModels(session)) add(m);
  add(model);
  if (!out.length) add(getModel(DEFAULT_MODEL_ID));
  return out;
}

/**
 * Stage (when nothing is staged yet), summarise, and commit.
 * @param {{cwd?:string, model?:object, session?:object, git?:object,
 *   subject?:string, body?:string, stageAll?:boolean}} opts
 * @returns {Promise<{ok:boolean, message:string, hash?:string, error?:string}>}
 */
export async function makeCommit(opts = {}) {
  const {
    cwd = process.cwd(), model, session, subject, body, stageAll,
  } = opts;
  const g = opts.git || defaultGit;

  if (!(await g.isRepo(cwd))) return { ok: false, message: '', error: 'not a git repository' };

  let st = await g.status(cwd);
  if (st.clean) return { ok: false, message: '', error: 'nothing to commit, working tree clean' };
  if (st.conflicted && st.conflicted.length) {
    const n = st.conflicted.length;
    return { ok: false, message: '', error: `resolve ${n} conflicted file${n === 1 ? '' : 's'} first` };
  }

  // Respect a deliberate partial stage; otherwise take everything.
  const shouldStage = stageAll === undefined ? st.staged.length === 0 : Boolean(stageAll);
  if (shouldStage) {
    const res = await g.stageAll(cwd);
    if (!res.ok) return { ok: false, message: '', error: res.error || 'git add failed' };
    st = await g.status(cwd);
  }
  if (!st.staged.length) return { ok: false, message: '', error: 'nothing staged to commit' };

  const staged = await g.diff(cwd, { staged: true });
  // only the index is being committed, so summarise the index alone
  const indexOnly = { ...st, unstaged: [], untracked: [], conflicted: [] };
  const summary = summariseChanges(indexOnly, staged);

  const authors = trailerAuthors(session, model);
  const message = buildCommitMessage({
    subject: (subject && String(subject).trim()) || summary.subject,
    body: body === undefined || body === null || body === '' ? summary.body : body,
    model: authors[0],
    coAuthors: authors.slice(1),
  });

  const res = await g.commit(cwd, message);
  if (!res.ok) return { ok: false, message, error: res.error || 'git commit failed' };
  return { ok: true, message, hash: res.hash };
}
