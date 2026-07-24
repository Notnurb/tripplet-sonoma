/**
 * planner.js — turn a sentence into a plan of real work.
 *
 * `classify()` is a weighted keyword scorer plus an entity extractor; nothing
 * clever, but it is tuned so the common phrasings a developer actually types
 * land on the right intent. `planFor()` turns that into Steps the engine
 * executes: genuine `read`/`write`/`edit`/`bash`/`grep`/`glob` calls against
 * the real filesystem, never a mime of one.
 *
 * The `say` steps carry a `build(ctx)` closure so the final answer can quote
 * what the tools actually returned — that is the difference between this and a
 * canned demo.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { voiceFor } from './personas.js';

// ── intent scoring ──────────────────────────────────────────────────────────

/** [regex, weight] per intent. Longer, more specific phrases score higher. */
const RULES = {
  commit: [
    [/\bcommit\b/, 6], [/\bgit commit\b/, 9], [/\bstage (?:and|&) commit\b/, 9],
    [/\bcommit message\b/, 7], [/\bcheck ?in (?:these|the) changes\b/, 6],
  ],
  test: [
    [/\brun (?:the )?tests?\b/, 9], [/\btest suite\b/, 7], [/\bnpm (?:run )?test\b/, 9],
    [/\bunit tests?\b/, 6], [/\bdo(?:es)? (?:it|they) pass\b/, 6], [/\bpytest\b/, 8],
    [/\bvitest\b/, 8], [/\bjest\b/, 7], [/\bare the tests? (?:passing|green|failing)\b/, 9],
    [/\bgo test\b/, 8], [/\bcargo test\b/, 8], [/\btests?\b/, 2],
  ],
  run: [
    [/\brun\b/, 4], [/\bexecute\b/, 5], [/\bstart (?:the )?(?:server|app|dev)\b/, 8],
    [/\bnpm (?:run|start|ci|install)\b/, 7], [/\bbuild (?:the )?(?:project|app|bundle)\b/, 7],
    [/\bshell\b/, 3], [/\bin the terminal\b/, 6], [/\bwhat (?:does|happens when) .* prints?\b/, 5],
    [/\bgit (?:status|log|diff|branch)\b/, 8],
  ],
  create: [
    [/\bcreate\b/, 6], [/\bmake (?:me )?an?\b/, 5], [/\bmake\b/, 3],
    [/\bnew file\b/, 8], [/\bscaffold\b/, 8],
    [/\bgenerate\b/, 5], [/\bwrite (?:me )?an?\b/, 7], [/\badd (?:a )?(?:new )?file\b/, 8],
    [/\bset up\b/, 4], [/\bboilerplate\b/, 7], [/\bstub\b/, 5], [/\bstarter\b/, 5],
  ],
  edit: [
    [/\bchange\b/, 5], [/\bupdate\b/, 5], [/\bmodify\b/, 6], [/\bedit\b/, 7],
    [/\breplace\b/, 6], [/\brename\b/, 7], [/\bswap\b/, 4], [/\bbump\b/, 5],
    [/\badd .{1,40} to\b/, 5], [/\bremove .{1,40} from\b/, 5], [/\bset .{1,30} to\b/, 5],
    [/\bappend\b/, 4], [/\bdelete the line\b/, 7],
  ],
  fix: [
    [/\bfix\b/, 8], [/\bbroken\b/, 7], [/\bbugs?\b/, 6], [/\bfailing\b/, 6],
    [/\bcrash(?:es|ing|ed)?\b/, 7], [/\bdoes ?n[o']t work\b/, 8], [/\berror\b/, 5],
    [/\bexception\b/, 6], [/\bstack ?trace\b/, 7], [/\btraceback\b/, 7],
    [/\bwhy (?:is|does) .* (?:fail|break|throw)/, 8], [/\bundefined is not\b/, 8],
    [/\bcannot read (?:property|properties)\b/, 8],
  ],
  refactor: [
    [/\brefactor\b/, 9], [/\bclean ?up\b/, 6], [/\bextract\b/, 6], [/\bsimplify\b/, 7],
    [/\bde-?duplicate\b/, 7], [/\bsplit (?:up|out|this|the)\b/, 5], [/\btidy\b/, 5],
    [/\bmodularis[ez]e\b/, 7], [/\bmove .{1,30} (?:into|out of)\b/, 5],
  ],
  review: [
    [/\breview\b/, 9], [/\bcode review\b/, 10], [/\bcritique\b/, 8], [/\baudit\b/, 7],
    [/\bwhat(?:'s| is) wrong with\b/, 7], [/\blook over\b/, 6], [/\bfeedback on\b/, 7],
    [/\bany (?:issues|problems|smells)\b/, 7],
  ],
  read: [
    [/\bread\b/, 7], [/\bshow me\b/, 6], [/\bopen\b/, 5], [/\bcat\b/, 5],
    [/\bprint\b/, 4], [/\bwhat(?:'s| is) in\b/, 7], [/\bcontents? of\b/, 7],
    [/\blet me see\b/, 6], [/\bdump\b/, 4],
  ],
  explain: [
    [/\bexplain\b/, 9], [/\bhow does\b/, 7], [/\bwhat does\b/, 6], [/\bwhy does\b/, 6],
    [/\bwalk me through\b/, 9], [/\bdescribe\b/, 6], [/\bwhat is this\b/, 6],
    [/\bhow (?:do|does) (?:it|this|that) work\b/, 8], [/\bsummar(?:ise|ize)\b/, 7],
    [/\bwhat(?:'s| is) the (?:point|purpose)\b/, 7],
  ],
  search: [
    [/\bsearch\b/, 8], [/\bgrep\b/, 9], [/\bwhere (?:is|are|does)\b/, 8],
    [/\bfind (?:all|every|the|any)?\b/, 6], [/\blocate\b/, 7], [/\bwhich files?\b/, 8],
    [/\busages? of\b/, 8], [/\breferences? to\b/, 8], [/\ball occurrences\b/, 8],
    [/\blist (?:all )?(?:the )?files\b/, 7], [/\bwho calls\b/, 8],
  ],
  plan: [
    [/\bplan\b/, 8], [/\bhow would you\b/, 8], [/\bdesign\b/, 6], [/\bpropose\b/, 7],
    [/\bapproach\b/, 6], [/\bstrategy\b/, 6], [/\bthink about\b/, 6],
    [/\bwhat(?:'s| is) the best way\b/, 7], [/\bshould i\b/, 6], [/\btrade-?offs?\b/, 7],
    [/\bdon'?t (?:write|change|edit) anything\b/, 9],
  ],
};

const KNOWN_EXT = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'json', 'md', 'markdown', 'txt', 'py',
  'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'sh', 'bash', 'zsh',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'yml', 'yaml', 'toml', 'ini',
  'env', 'lock', 'sql', 'swift', 'kt', 'php', 'vue', 'svelte', 'xml', 'csv',
  'log', 'conf', 'cfg', 'gitignore', 'dockerfile', 'makefile', 'tf', 'proto',
]);

const CMD_HEADS = new Set([
  'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno', 'node', 'git', 'make', 'python',
  'python3', 'pip', 'pytest', 'cargo', 'go', 'docker', 'ls', 'cat', 'rg', 'grep',
  'find', 'echo', 'curl', 'sed', 'awk', 'tsc', 'eslint', 'prettier', 'vitest',
  'jest', 'bash', 'sh', 'rm', 'mv', 'cp', 'mkdir', 'touch', 'chmod', 'kill',
]);

const STOP_DOTTED = new Set(['node.js', 'e.g', 'i.e', 'etc', 'vs.js', 'a.k.a']);

const PATH_RE = /(?:\.{1,2}\/)?(?:[\w.@~-]+\/)+[\w.@-]*|[\w][\w.@-]*\.[A-Za-z0-9]{1,10}/g;
const BACKTICK_RE = /`([^`]+)`/g;
const QUOTED_RE = /["'“”']([^"'“”']{2,80})["'“”']/g;

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

function looksLikePath(tok) {
  const t = tok.replace(/[.,;:)\]]+$/, '');
  if (!t || STOP_DOTTED.has(t.toLowerCase())) return false;
  if (t.includes('/')) return true;
  const dot = t.lastIndexOf('.');
  if (dot <= 0) return false;
  return KNOWN_EXT.has(t.slice(dot + 1).toLowerCase());
}

const cleanTok = (t) => t.replace(/^[('"`]+/, '').replace(/[.,;:)\]'"`]+$/, '');

function extractCommands(text) {
  const out = [];
  for (const m of text.matchAll(BACKTICK_RE)) {
    const head = m[1].trim().split(/\s+/)[0];
    if (CMD_HEADS.has(head)) out.push(m[1].trim());
  }
  const verb = /(?:run|execute|exec|try|invoke)\s+([a-z][\w.-]*(?:\s+[^,.;\n]{0,60})?)/gi;
  for (const m of text.matchAll(verb)) {
    const cand = m[1].trim().replace(/\s+(?:and|then)\b.*$/i, '');
    const head = cand.split(/\s+/)[0];
    if (CMD_HEADS.has(head)) out.push(cand);
  }
  return uniq(out);
}

function extractSymbols(text) {
  const out = [];
  for (const m of text.matchAll(BACKTICK_RE)) {
    const t = m[1].trim();
    if (!looksLikePath(t) && /^[A-Za-z_$][\w$.]*(?:\(\))?$/.test(t)) out.push(t.replace(/\(\)$/, ''));
  }
  const declared = /\b(?:function|class|const|let|var|def|interface|type|method)\s+([A-Za-z_$][\w$]*)/g;
  for (const m of text.matchAll(declared)) out.push(m[1]);
  const called = /\b([A-Za-z_$][\w$]*)\(\)/g;
  for (const m of text.matchAll(called)) out.push(m[1]);
  const camel = /\b([a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)+|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)\b/g;
  for (const m of text.matchAll(camel)) {
    if (!looksLikePath(m[1])) out.push(m[1]);
  }
  const snake = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;
  for (const m of text.matchAll(snake)) out.push(m[1]);
  return uniq(out).slice(0, 8);
}

function extractPaths(text) {
  const out = [];
  for (const m of text.matchAll(BACKTICK_RE)) {
    const t = m[1].trim();
    if (looksLikePath(t) && !t.includes(' ')) out.push(cleanTok(t));
  }
  for (const m of text.matchAll(QUOTED_RE)) {
    const t = m[1].trim();
    if (looksLikePath(t) && !t.includes(' ')) out.push(cleanTok(t));
  }
  for (const m of text.matchAll(PATH_RE)) {
    const t = cleanTok(m[0]);
    if (looksLikePath(t)) out.push(t);
  }
  return uniq(out).map((p) => p.replace(/^\.\//, '')).slice(0, 6);
}

/**
 * @param {string} prompt
 * @param {object} [ctx] {cwd}
 * @returns {{intent:string, entities:{paths:string[],symbols:string[],commands:string[]},
 *   confidence:number, prompt:string, scores:object}}
 */
export function classify(prompt, ctx = {}) {
  const text = String(prompt ?? '');
  const low = text.toLowerCase();
  const entities = {
    paths: extractPaths(text),
    symbols: extractSymbols(text),
    commands: extractCommands(text),
  };

  const scores = {};
  for (const [intent, rules] of Object.entries(RULES)) {
    let s = 0;
    for (const [re, w] of rules) if (re.test(low)) s += w;
    if (s) scores[intent] = s;
  }

  // Structural nudges: what the sentence *contains* is evidence too.
  if (entities.commands.length) scores.run = (scores.run || 0) + 4;
  if (entities.paths.length) {
    scores.read = (scores.read || 0) + 1;
    if (/\?\s*$/.test(text)) scores.explain = (scores.explain || 0) + 2;
  }
  if (!entities.paths.length && !entities.commands.length) {
    scores.chat = 2;
    if (scores.read) scores.read -= 2;
  }
  if (/\bfile\b/.test(low) && scores.create) scores.create += 2;
  if (/\bthat (?:does|prints|returns|exports)\b/.test(low) && scores.create) scores.create += 3;
  // "fix the failing tests" is a fix that must run the tests first.
  if (scores.fix && scores.test && scores.fix >= scores.test) scores.test -= 3;

  // You cannot read, edit or explain a file that is not on disk — if every path
  // the user named is missing and they are not asking a question about it, they
  // are asking for it to be made.
  if (ctx.cwd && entities.paths.length && !/\?\s*$/.test(text)) {
    const allMissing = entities.paths.every((p) => {
      try {
        return !existsSync(path.resolve(ctx.cwd, p));
      } catch {
        return false;   // an unreadable path is not evidence either way
      }
    });
    if (allMissing) {
      for (const k of ['read', 'edit', 'explain', 'review', 'refactor']) {
        if (scores[k]) { scores.create = (scores.create || 0) + 3; scores[k] -= 4; }
      }
    }
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) {
    return { intent: 'chat', entities, confidence: 0.34, prompt: text, scores };
  }
  const [intent, top] = ranked[0];
  const second = ranked[1] ? ranked[1][1] : 0;
  const margin = (top - second) / Math.max(1, top);
  const confidence = Math.min(0.97, Math.max(0.32, 0.45 + margin * 0.4 + Math.min(top, 12) / 40));
  return { intent, entities, confidence, prompt: text, scores };
}

// ── project probing (plan time, cheap, cached per cwd) ──────────────────────

const projectCache = new Map();

/** What the repo is, as far as one directory listing and a package.json say. */
export function detectProject(cwd = process.cwd()) {
  const hit = projectCache.get(cwd);
  if (hit) return hit;
  const info = {
    cwd,
    name: path.basename(cwd),
    kind: 'unknown',
    scripts: {},
    testCommand: '',
    runCommand: '',
    manager: 'npm',
    entry: '',
    hasGit: existsSync(path.join(cwd, '.git')),
  };
  const read = (f) => {
    try {
      return readFileSync(path.join(cwd, f), 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'EISDIR') info.warning = err.message;
      return null;
    }
  };
  const pkgRaw = read('package.json');
  if (pkgRaw) {
    info.kind = 'node';
    try {
      const pkg = JSON.parse(pkgRaw);
      info.name = pkg.name || info.name;
      info.scripts = pkg.scripts || {};
      info.entry = pkg.main || (pkg.bin && Object.values(pkg.bin)[0]) || '';
      info.esm = pkg.type === 'module';
      info.pkg = pkg;
    } catch (err) {
      info.warning = `package.json is not valid JSON (${err.message})`;
    }
    if (existsSync(path.join(cwd, 'pnpm-lock.yaml'))) info.manager = 'pnpm';
    else if (existsSync(path.join(cwd, 'yarn.lock'))) info.manager = 'yarn';
    else if (existsSync(path.join(cwd, 'bun.lockb'))) info.manager = 'bun';
    if (info.scripts.test) info.testCommand = `${info.manager} test`;
    if (info.scripts.dev) info.runCommand = `${info.manager} run dev`;
    else if (info.scripts.start) info.runCommand = `${info.manager} start`;
  } else if (existsSync(path.join(cwd, 'pyproject.toml')) || existsSync(path.join(cwd, 'requirements.txt'))) {
    info.kind = 'python';
    info.testCommand = 'python3 -m pytest -q';
    info.manager = 'pip';
  } else if (existsSync(path.join(cwd, 'Cargo.toml'))) {
    info.kind = 'rust';
    info.testCommand = 'cargo test';
    info.runCommand = 'cargo run';
    info.manager = 'cargo';
  } else if (existsSync(path.join(cwd, 'go.mod'))) {
    info.kind = 'go';
    info.testCommand = 'go test ./...';
    info.runCommand = 'go run .';
    info.manager = 'go';
  } else if (existsSync(path.join(cwd, 'Makefile'))) {
    info.kind = 'make';
    info.testCommand = 'make test';
    info.runCommand = 'make';
    info.manager = 'make';
  }
  projectCache.set(cwd, info);
  return info;
}

/** Exported for tests and for `/status`; clears the plan-time probe cache. */
export const forgetProject = (cwd) => (cwd ? projectCache.delete(cwd) : projectCache.clear());

// ── generated file content ──────────────────────────────────────────────────

const camel = (s) => s.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
  .replace(/^[0-9]+/, '')
  .replace(/^./, (c) => c.toLowerCase()) || 'main';

const pascal = (s) => {
  const c = camel(s);
  return c.charAt(0).toUpperCase() + c.slice(1);
};

const snake = (s) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'main';

/** One clean sentence describing the file, taken from what the user asked for. */
function purposeOf(request, base) {
  const t = String(request || '').replace(/\s+/g, ' ').trim();
  const m = t.match(/\b(?:that|which|to|for)\s+(.{6,110})$/i);
  let s = m ? m[1] : t;
  s = s.replace(/^(?:it|this|the file)\s+/i, '').replace(/[.!?]+$/, '');
  s = s.replace(/\b(?:please|for me|thanks)\b/gi, '').trim();
  if (!s || s.length < 6) return `supporting module for ${base}`;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Plausible, syntactically valid starter content for a new file.
 * The shape is chosen from the extension; the details from the request.
 */
export function scaffold(filePath, request, opts = {}) {
  const base = path.basename(filePath);
  const ext = (base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '').toLowerCase();
  const stem = base.replace(/\.[^.]+$/, '');
  // A symbol named in the request beats one guessed from the filename:
  // "a file utils.js that exports a slugify function" wants `slugify`.
  const named = requestedSymbol(request);
  const ident = camel(named || stem);
  const Comp = pascal(named || stem);
  const purpose = purposeOf(request, base);
  const req = String(request || '').toLowerCase();
  const esm = opts.esm !== false;
  const isTest = /\.(?:test|spec)\./.test(base) || /\btests?\b/.test(req);
  const wantsServer = /\bserver\b|\bhttp\b|\bapi\b|\bendpoint\b/.test(req);
  const wantsCli = /\bcli\b|\bcommand[- ]line\b|\bargv\b|\bbin\b/.test(req);

  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      if (isTest) return jsTest(base, purpose, ident, esm);
      if (wantsServer) return jsServer(base, purpose);
      if (wantsCli) return jsCli(base, purpose, ident);
      return jsModule(base, purpose, ident);
    case 'ts':
      if (isTest) return jsTest(base, purpose, ident, true);
      return tsModule(base, purpose, ident);
    case 'jsx':
    case 'tsx':
      return reactComponent(base, purpose, Comp, ext === 'tsx');
    case 'py':
      return wantsCli ? pyCli(base, purpose, snake(stem)) : pyModule(base, purpose, snake(stem));
    case 'sh':
    case 'bash':
      return shScript(base, purpose);
    case 'json':
      return jsonFile(base, purpose, stem);
    case 'md':
    case 'markdown':
      return mdFile(base, purpose, stem, request);
    case 'html':
    case 'htm':
      return htmlFile(base, purpose, stem);
    case 'css':
      return cssFile(base, purpose);
    case 'go':
      return goFile(base, purpose, ident);
    case 'rs':
      return rustFile(base, purpose);
    case 'yml':
    case 'yaml':
      return yamlFile(filePath, base, purpose, stem);
    case 'toml':
      return `# ${base} — ${purpose}\n\n[${snake(stem)}]\nenabled = true\nname = "${stem}"\n`;
    case 'env':
      return `# ${base} — ${purpose}\nNODE_ENV=development\nLOG_LEVEL=info\nPORT=3000\n`;
    default:
      return `${base}\n${'='.repeat(base.length)}\n\n${purpose.charAt(0).toUpperCase()}${purpose.slice(1)}.\n`;
  }
}

const SYMBOL_STOP = new Set([
  'a', 'an', 'the', 'new', 'default', 'function', 'class', 'component', 'helper',
  'util', 'utils', 'method', 'module', 'file', 'it', 'that', 'this', 'which',
  'simple', 'small', 'single', 'basic', 'named', 'called', 'export', 'exports',
  // Framework and language words describe the *kind* of thing, never its name.
  'react', 'vue', 'svelte', 'angular', 'solid', 'preact', 'next', 'node',
  'typescript', 'javascript', 'python', 'jsx', 'tsx', 'ts', 'js', 'ui', 'web',
  'async', 'pure', 'stateless', 'functional', 'reusable', 'generic', 'custom',
]);

/** Pull an intended identifier out of the request, if it names one. */
function requestedSymbol(request) {
  const t = String(request || '');
  const patterns = [
    /\b(?:function|class|component|helper)\s+(?:called|named)\s+`?([A-Za-z_$][\w$]*)`?/i,
    /`([A-Za-z_$][\w$]*)`\s*(?:function|helper|util|method|class|component)\b/i,
    /\b(?:a|an|the)\s+`?([A-Za-z_$][\w$]*)`?\s+(?:function|helper|method|class|component)\b/i,
    /\bexports?\s+(?:a|an|the)?\s*`?([A-Za-z_$][\w$]*)`?/i,
    /`?\b([A-Za-z_$][\w$]*)\(\)/,
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    const name = m && m[1];
    if (name && !SYMBOL_STOP.has(name.toLowerCase()) && name.length > 1) return name;
  }
  return '';
}

const header = (base, purpose) => `/**\n * ${base} — ${purpose}.\n */\n`;

function jsModule(base, purpose, ident) {
  return `${header(base, purpose)}
const DEFAULTS = {
  verbose: false,
};

/**
 * ${purpose.charAt(0).toUpperCase()}${purpose.slice(1)}.
 * @param {object} [options]
 * @returns {object}
 */
export function ${ident}(options = {}) {
  const config = { ...DEFAULTS, ...options };
  if (config.verbose) process.stderr.write(\`[${ident}] \${JSON.stringify(config)}\\n\`);
  return { ok: true, config };
}

export default ${ident};
`;
}

function tsModule(base, purpose, ident) {
  return `${header(base, purpose)}
export interface ${pascal(ident)}Options {
  verbose?: boolean;
}

export interface ${pascal(ident)}Result {
  ok: boolean;
  config: Required<${pascal(ident)}Options>;
}

const DEFAULTS: Required<${pascal(ident)}Options> = {
  verbose: false,
};

/** ${purpose.charAt(0).toUpperCase()}${purpose.slice(1)}. */
export function ${ident}(options: ${pascal(ident)}Options = {}): ${pascal(ident)}Result {
  const config = { ...DEFAULTS, ...options };
  return { ok: true, config };
}

export default ${ident};
`;
}

function jsTest(base, purpose, ident, esm) {
  const target = base.replace(/\.(?:test|spec)\./, '.').replace(/\.ts$/, '.js');
  const imp = esm
    ? `import test from 'node:test';\nimport assert from 'node:assert/strict';\n\nimport { ${ident} } from './${target}';`
    : `const test = require('node:test');\nconst assert = require('node:assert/strict');\n\nconst { ${ident} } = require('./${target}');`;
  return `${header(base, purpose)}
${imp}

test('${ident} returns a result', () => {
  const out = ${ident}();
  assert.equal(typeof out, 'object');
  assert.equal(out.ok, true);
});

test('${ident} honours options', () => {
  const out = ${ident}({ verbose: true });
  assert.equal(out.config.verbose, true);
});
`;
}

function jsServer(base, purpose) {
  return `${header(base, purpose)}
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 3000);

const routes = {
  '/': () => ({ ok: true, service: '${base.replace(/\.[^.]+$/, '')}' }),
  '/health': () => ({ ok: true, uptime: process.uptime() }),
};

export const server = createServer((req, res) => {
  const url = new URL(req.url, \`http://\${req.headers.host ?? 'localhost'}\`);
  const handler = routes[url.pathname];
  const body = handler ? handler(req) : { ok: false, error: 'not found' };
  res.writeHead(handler ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
});

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  server.listen(PORT, () => process.stdout.write(\`listening on \${PORT}\\n\`));
}
`;
}

function jsCli(base, purpose, ident) {
  return `#!/usr/bin/env node
${header(base, purpose)}
function parse(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { rest.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v ?? true;
    } else rest.push(a);
  }
  return { flags, rest };
}

export function ${ident}(argv = process.argv.slice(2)) {
  const { flags, rest } = parse(argv);
  if (flags.help || flags.h) {
    process.stdout.write('usage: ${base.replace(/\.[^.]+$/, '')} [--help] [args...]\\n');
    return 0;
  }
  process.stdout.write(\`\${rest.join(' ')}\\n\`);
  return 0;
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  process.exitCode = ${ident}();
}
`;
}

function reactComponent(base, purpose, Comp, typed) {
  const props = typed
    ? `interface ${Comp}Props {\n  title?: string;\n  children?: React.ReactNode;\n}\n\n`
    : '';
  const sig = typed ? `({ title = '${Comp}', children }: ${Comp}Props)` : `({ title = '${Comp}', children })`;
  return `${header(base, purpose)}
import React, { useState } from 'react';

${props}export function ${Comp}${sig} {
  const [open, setOpen] = useState(false);

  return (
    <section className="${camel(Comp)}">
      <h2 onClick={() => setOpen((v) => !v)}>{title}</h2>
      {open ? <div className="${camel(Comp)}__body">{children}</div> : null}
    </section>
  );
}

export default ${Comp};
`;
}

function pyModule(base, purpose, ident) {
  return `"""${base} — ${purpose}."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ${pascal(ident)}Config:
    verbose: bool = False


def ${ident}(config: ${pascal(ident)}Config | None = None) -> dict:
    """${purpose.charAt(0).toUpperCase()}${purpose.slice(1)}."""
    cfg = config or ${pascal(ident)}Config()
    return {"ok": True, "verbose": cfg.verbose}


if __name__ == "__main__":
    print(${ident}())
`;
}

function pyCli(base, purpose, ident) {
  return `"""${base} — ${purpose}."""

from __future__ import annotations

import argparse
import sys


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="${purpose}")
    parser.add_argument("args", nargs="*", help="positional arguments")
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser


def ${ident}(argv: list[str] | None = None) -> int:
    opts = build_parser().parse_args(argv)
    if opts.verbose:
        print(f"args={opts.args}", file=sys.stderr)
    print(" ".join(opts.args))
    return 0


if __name__ == "__main__":
    raise SystemExit(${ident}())
`;
}

function shScript(base, purpose) {
  return `#!/usr/bin/env bash
# ${base} — ${purpose}.
set -euo pipefail

usage() {
  echo "usage: ${base} [-v] [args...]" >&2
}

verbose=0
while getopts ":vh" opt; do
  case "\${opt}" in
    v) verbose=1 ;;
    h) usage; exit 0 ;;
    *) usage; exit 64 ;;
  esac
done
shift $((OPTIND - 1))

if [[ "\${verbose}" -eq 1 ]]; then
  echo "running ${base} with $# argument(s)" >&2
fi

for arg in "$@"; do
  echo "\${arg}"
done
`;
}

function jsonFile(base, purpose, stem) {
  if (base === 'package.json') {
    return `${JSON.stringify({
      name: stem === 'package' ? 'app' : stem,
      version: '0.1.0',
      description: purpose,
      type: 'module',
      main: 'index.js',
      scripts: { start: 'node index.js', test: 'node --test test/' },
      license: 'MIT',
    }, null, 2)}\n`;
  }
  if (base === 'tsconfig.json') {
    return `${JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
        strict: true, skipLibCheck: true, outDir: 'dist',
      },
      include: ['src'],
    }, null, 2)}\n`;
  }
  return `${JSON.stringify({ name: stem, description: purpose, version: '0.1.0', items: [] }, null, 2)}\n`;
}

function mdFile(base, purpose, stem, request) {
  const title = stem.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return `# ${title}

${purpose.charAt(0).toUpperCase()}${purpose.slice(1)}.

## Usage

\`\`\`sh
# describe the entry point here
\`\`\`

## Notes

- Created from: ${String(request || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'a request with no further detail'}
- Replace these sections as the real behaviour lands.
`;
}

function htmlFile(base, purpose, stem) {
  const title = stem.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${purpose.charAt(0).toUpperCase()}${purpose.slice(1)}.</p>
    </main>
    <script type="module" src="./main.js"></script>
  </body>
</html>
`;
}

function cssFile(base, purpose) {
  return `/* ${base} — ${purpose}. */

:root {
  --bg: #0b0e14;
  --fg: #d5dbe5;
  --accent: #4d9dff;
  --radius: 8px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.5 system-ui, sans-serif;
}

a { color: var(--accent); }
`;
}

function goFile(base, purpose, ident) {
  return `// ${base} — ${purpose}.
package main

import "fmt"

// ${pascal(ident)} carries the configuration for this command.
type ${pascal(ident)} struct {
	Verbose bool
}

func (c ${pascal(ident)}) Run(args []string) error {
	if c.Verbose {
		fmt.Println("args:", args)
	}
	return nil
}

func main() {
	if err := (${pascal(ident)}{}).Run(nil); err != nil {
		panic(err)
	}
}
`;
}

function rustFile(base, purpose) {
  return `// ${base} — ${purpose}.

#[derive(Debug, Default)]
pub struct Config {
    pub verbose: bool,
}

pub fn run(config: &Config) -> Result<(), String> {
    if config.verbose {
        eprintln!("running with {config:?}");
    }
    Ok(())
}

fn main() {
    if let Err(err) = run(&Config::default()) {
        eprintln!("error: {err}");
        std::process::exit(1);
    }
}
`;
}

function yamlFile(filePath, base, purpose, stem) {
  if (filePath.includes('.github/workflows')) {
    return `# ${base} — ${purpose}.
name: ${stem}

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm test
`;
  }
  return `# ${base} — ${purpose}.
name: ${stem}
version: 1
enabled: true
options:
  verbose: false
`;
}

// ── reading tool results ────────────────────────────────────────────────────

const textOf = (res) => {
  if (!res) return '';
  if (res.meta && Array.isArray(res.meta.lines)) return res.meta.lines.map((l) => l.text).join('\n');
  if (typeof res.detail === 'string') return res.detail;
  if (res.meta && typeof res.meta.content === 'string') return res.meta.content;
  return '';
};

const firstOf = (results, tool) => results.find((r) => r.tool === tool && r.ok);
const allOf = (results, tool) => results.filter((r) => r.tool === tool);

/** Cheap structural outline — real symbols with real line numbers. */
export function outline(text, ext = 'js') {
  const lines = String(text).split('\n');
  const out = [];
  const pats = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|def|type|interface|struct|fn|func)\s+([A-Za-z_$][\w$]*)/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(pats);
    if (!m) continue;
    const exported = /^export\b/.test(lines[i]) || /^pub\b/.test(lines[i]);
    const kind = lines[i].match(/\b(function|class|const|let|var|def|type|interface|struct|fn|func)\b/);
    out.push({ name: m[1], line: i + 1, exported, kind: kind ? kind[1] : 'symbol' });
    if (out.length >= 40) break;
  }
  void ext;
  return out;
}

/** Observations a reviewer would actually make, derived from the source. */
export function reviewNotes(text, filePath = '') {
  const lines = String(text).split('\n');
  const notes = [];
  const longest = lines.reduce((a, l, i) => (l.length > a.len ? { len: l.length, n: i + 1 } : a), { len: 0, n: 0 });
  const todos = lines.map((l, i) => ({ l, n: i + 1 })).filter((x) => /\b(TODO|FIXME|XXX|HACK)\b/.test(x.l));
  const logs = lines.filter((l) => /\bconsole\.log\(/.test(l)).length;
  const emptyCatch = lines.findIndex((l) => /catch\s*(\([^)]*\))?\s*\{\s*\}/.test(l));
  const anyType = lines.filter((l) => /:\s*any\b/.test(l)).length;
  const awaitInLoop = lines.findIndex((l, i) => /\bfor\s*\(/.test(l) && /await/.test(lines[i + 1] || ''));

  if (lines.length > 400) notes.push(`${lines.length} lines in one file — the natural split points are the section comments.`);
  if (longest.len > 120) notes.push(`Line ${longest.n} is ${longest.len} columns wide; it is doing more than one thing.`);
  if (todos.length) notes.push(`${todos.length} TODO/FIXME marker${todos.length > 1 ? 's' : ''}, first at line ${todos[0].n}.`);
  if (logs) notes.push(`${logs} \`console.log\` call${logs > 1 ? 's' : ''} left in — noisy for a library, fine for a script.`);
  if (emptyCatch >= 0) notes.push(`Empty catch at line ${emptyCatch + 1}: swallowing an error there will hide the real failure.`);
  if (anyType) notes.push(`${anyType} \`any\` annotation${anyType > 1 ? 's' : ''} — each one is a type check you are not getting.`);
  if (awaitInLoop >= 0) notes.push(`\`await\` inside the loop at line ${awaitInLoop + 1} serialises work that could run concurrently.`);
  if (!/\b(try|catch)\b/.test(text) && /\b(readFile|fetch|spawn|exec)\b/.test(text)) {
    notes.push('I/O without any error handling — the happy path is the only path here.');
  }
  if (!notes.length) notes.push(`Nothing structural stands out in ${filePath || 'the file'}; it is short, consistent and does one thing.`);
  return notes.slice(0, 6);
}

/** English plurals, enough of them: match -> matches, directory -> directories. */
function pluralise(word) {
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

const fmtCount = (n, one, many = pluralise(one)) => `${n} ${n === 1 ? one : many}`;

// ── plan construction ───────────────────────────────────────────────────────

const think = (text) => ({ kind: 'think', text });
const tool = (name, input) => ({ kind: 'tool', tool: name, input });
const say = (markdown, build) => ({ kind: 'say', markdown, build });

/** Reject anything that would escape the working directory before we plan it. */
function inside(cwd, p) {
  const abs = path.resolve(cwd, p);
  const root = path.resolve(cwd);
  return abs === root || abs.startsWith(root + path.sep);
}

function exists(cwd, p) {
  try {
    return existsSync(path.resolve(cwd, p));
  } catch (err) {
    void err;                       // an unreadable path is, for planning, absent
    return false;
  }
}

function isDir(cwd, p) {
  try {
    return statSync(path.resolve(cwd, p)).isDirectory();
  } catch (err) {
    void err;
    return false;
  }
}

/** "rename foo to bar" / "change X with Y" — the only edits we can plan blind. */
function replacementPair(text) {
  const pats = [
    /\b(?:rename|change|replace|swap|rewrite)\s+["'`]?([^"'`\n]{1,80}?)["'`]?\s+(?:to|with|into|->|→)\s+["'`]?([^"'`\n.]{1,80}?)["'`]?\s*[.!]?$/i,
    /\bs\/([^/\n]{1,60})\/([^/\n]{0,60})\/(g?)/,
    /\bbump\s+["'`]?([\w.-]+)["'`]?\s+to\s+["'`]?([\w.-]+)["'`]?/i,
  ];
  for (const re of pats) {
    const m = text.match(re);
    if (m && m[1] && m[2] && m[1].trim() !== m[2].trim()) {
      return { from: m[1].trim(), to: m[2].trim(), all: /\ball\b|\bevery\b|everywhere/i.test(text) || m[3] === 'g' };
    }
  }
  return null;
}

function searchPattern(cls) {
  const t = cls.prompt;
  const quoted = t.match(/["'`]([^"'`\n]{2,80})["'`]/);
  if (quoted) return { pattern: escapeRe(quoted[1]), literal: quoted[1] };
  const after = t.match(/\b(?:for|of|to|called|named|containing|matching)\s+([A-Za-z_$][\w$.-]{1,60})/i);
  if (after) return { pattern: escapeRe(after[1]), literal: after[1] };
  if (cls.entities.symbols.length) {
    return { pattern: escapeRe(cls.entities.symbols[0]), literal: cls.entities.symbols[0] };
  }
  const words = t.split(/\s+/).filter((w) => /^[A-Za-z_][\w-]{3,}$/.test(w) && !STOPWORDS.has(w.toLowerCase()));
  const last = words[words.length - 1];
  return last ? { pattern: escapeRe(last), literal: last } : null;
}

const STOPWORDS = new Set([
  'find', 'search', 'where', 'which', 'files', 'file', 'that', 'this', 'with',
  'from', 'have', 'does', 'grep', 'look', 'through', 'about', 'inside', 'usages',
  'references', 'occurrences', 'please', 'code', 'repo', 'project', 'anything',
]);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {object} cls  result of classify()
 * @param {object} ctx  {cwd, session, model, effort, voice, prompt}
 * @returns {Array<object>} Step[]
 */
export function planFor(cls, ctx = {}) {
  const cwd = ctx.cwd || (ctx.session && ctx.session.cwd) || process.cwd();
  const voice = ctx.voice || voiceFor(ctx.model, ctx.effort);
  const project = detectProject(cwd);
  const prompt = cls.prompt || ctx.prompt || '';
  const { paths, symbols, commands } = cls.entities;
  const base = { cls, ctx, cwd, voice, project, prompt };

  const escaped = paths.find((p) => !inside(cwd, p));
  if (escaped) {
    return [say('', () => voice.compose({
      headline: 'That path is outside the working directory',
      body: [`\`${escaped}\` resolves outside \`${cwd}\`, so I will not read or write it. Every tool in Astrocode is scoped to the directory the session started in — move the file inside it, or restart the session with \`--cwd\`.`],
      closing: false,
      confidence: false,
    }))];
  }

  switch (cls.intent) {
    case 'read': return planRead(base);
    case 'explain': return planExplain(base);
    case 'review': return planReview(base);
    case 'search': return planSearch(base);
    case 'create': return planCreate(base);
    case 'edit': return planEdit(base);
    case 'fix': return planFix(base);
    case 'refactor': return planRefactor(base);
    case 'test': return planTest(base);
    case 'run': return planRun(base);
    case 'commit': return planCommit(base);
    case 'plan': return planPlan(base);
    default: return planChat(base);
  }
}

// ── per-intent planners ─────────────────────────────────────────────────────

function planRead({ cls, cwd, voice, prompt }) {
  const files = cls.entities.paths.filter((p) => !isDir(cwd, p)).slice(0, 3);
  const dirs = cls.entities.paths.filter((p) => isDir(cwd, p));

  if (!files.length) {
    const target = dirs[0] || '.';
    return [
      think(`No readable file was named, so I list ${target} first and let the user point at one.`),
      tool('ls', { path: target }),
      say('', ({ results }) => {
        const r = results[0];
        return voice.compose({
          headline: `Listing \`${target}\``,
          body: [r && r.ok
            ? `${r.summary} Name one of these and I will read it — or give me a glob and I will read the set.`
            : `I could not list \`${target}\`: ${(r && r.error) || 'unknown error'}.`],
          confidence: false,
        });
      }),
    ];
  }

  const steps = [think(`The user named ${files.map((f) => `\`${f}\``).join(', ')}. Read ${files.length > 1 ? 'them' : 'it'} before saying anything about the contents.`)];
  for (const f of files) steps.push(tool('read', { path: f }));
  steps.push(say('', ({ results }) => {
    const reads = allOf(results, 'read');
    const bullets = [];
    for (const r of reads) {
      if (!r.ok) { bullets.push(`\`${r.input.path}\` — ${r.error}`); continue; }
      const text = textOf(r);
      const n = text ? text.split('\n').length : (r.meta && r.meta.lines ? r.meta.lines.length : 0);
      const sym = outline(text).filter((s) => s.exported).slice(0, 4).map((s) => `\`${s.name}\``);
      bullets.push(`\`${r.input.path}\` — ${fmtCount(n, 'line')}${sym.length ? `, exporting ${sym.join(', ')}` : ''}.`);
    }
    return voice.compose({
      headline: reads.length > 1 ? `Read ${fmtCount(reads.length, 'file')}` : `Read \`${reads[0] ? reads[0].input.path : ''}\``,
      body: [`The contents are above in the tool output. ${prompt.trim().endsWith('?') ? 'To answer the question directly: ask again and I will quote the specific lines that matter.' : 'Tell me what you want changed and I will work from what is actually there.'}`],
      bullets,
      confidence: false,
    });
  }));
  return steps;
}

function planExplain({ cls, cwd, voice, project }) {
  const files = cls.entities.paths.filter((p) => !isDir(cwd, p)).slice(0, 2);
  if (!files.length) {
    return [
      think('Nothing concrete was named, so this is a general explanation grounded in what the repo looks like.'),
      say('', () => voice.compose({
        headline: 'Happy to explain — point me at something',
        body: [
          `This looks like a ${project.kind === 'unknown' ? 'plain' : project.kind} project called \`${project.name}\`. Name a file, a symbol, or a behaviour and I will read the source first and explain from that rather than from guesswork.`,
          'I am a simulated model: the reasoning you see is generated locally, but every tool call reads the real disk, so anything I quote from a file is genuinely what is in it.',
        ],
        confidence: false,
      })),
    ];
  }
  const steps = [think(`Explaining ${files.join(' and ')} means reading ${files.length > 1 ? 'them' : 'it'} first — an explanation from the filename alone would be fiction.`)];
  for (const f of files) steps.push(tool('read', { path: f }));
  steps.push(say('', ({ results }) => {
    const r = firstOf(results, 'read');
    if (!r) {
      return voice.compose({
        headline: 'Could not read the file',
        body: [`${(allOf(results, 'read')[0] || {}).error || 'The read failed.'} Check the path and I will try again.`],
        confidence: false,
      });
    }
    const text = textOf(r);
    const syms = outline(text);
    const exported = syms.filter((s) => s.exported);
    const imports = (text.match(/^\s*(?:import|from|require|use)\b.*$/gm) || []).length;
    const bullets = (exported.length ? exported : syms).slice(0, 6)
      .map((s) => `\`${s.name}\` (${s.kind}, line ${s.line})`);
    return voice.compose({
      headline: `What \`${r.input.path}\` does`,
      body: [
        `It is ${fmtCount(text.split('\n').length, 'line')} with ${fmtCount(imports, 'import')} and ${fmtCount(syms.length, 'top-level declaration')}. The ${exported.length ? 'exported surface' : 'internal structure'} is what the rest of the code sees:`,
      ],
      bullets,
      // This reads as a comment *on* the list, so it has to follow it.
      note: exported.length
        ? `Everything else in the file exists to support ${exported.length === 1 ? 'that one export' : `those ${fmtCount(exported.length, 'export')}`}. If you want the line-by-line walkthrough${exported.length === 1 ? '' : ' of any one of them'}, say so.`
        : 'Nothing is exported, so this file is either an entry point or run for its side effects.',
      context: `In the wider project (\`${project.name}\`, ${project.kind}), this sits alongside whatever imports it; I can trace the callers next if that would help.`,
      confidence: false,
    });
  }));
  return steps;
}

function planReview({ cls, cwd, voice }) {
  const files = cls.entities.paths.filter((p) => !isDir(cwd, p)).slice(0, 2);
  if (!files.length) {
    return [
      think('A review needs a target. Without a path I would be reviewing my own imagination.'),
      tool('bash', { command: 'git diff --stat HEAD 2>/dev/null || ls -1' }),
      say('', ({ results }) => voice.compose({
        headline: 'Which files should I review?',
        body: [`Here is what has changed / what is here:\n\n${(results[0] && results[0].summary) || 'nothing obvious'}. Name one and I will read it properly and give you real notes.`],
        confidence: false,
      })),
    ];
  }
  const steps = [think(`Reviewing ${files[0]}: read it fully, then report only what is actually in the file.`)];
  for (const f of files) steps.push(tool('read', { path: f }));
  steps.push(say('', ({ results }) => {
    const rs = allOf(results, 'read').filter((r) => r.ok);
    if (!rs.length) {
      return voice.compose({ headline: 'Nothing to review', body: ['The file could not be read, so there is nothing for me to look at yet.'], confidence: false });
    }
    const bullets = [];
    for (const r of rs) bullets.push(...reviewNotes(textOf(r), r.input.path));
    const total = rs.reduce((a, r) => a + textOf(r).split('\n').length, 0);
    return voice.compose({
      headline: `Review of ${rs.map((r) => `\`${r.input.path}\``).join(', ')}`,
      body: [`${fmtCount(total, 'line')} read. These are the things I would raise in a pull request — everything below points at a specific line rather than a general principle.`],
      bullets,
      note: 'Nothing here is blocking unless you want it to be; I have not changed anything.',
      confidence: false,
    });
  }));
  return steps;
}

function planSearch({ cls, cwd, voice }) {
  const pat = searchPattern(cls);
  const globHint = cls.prompt.match(/\*\*?\/?[\w*.{},]+/);
  const dirHint = cls.entities.paths.find((p) => isDir(cwd, p));

  if (!pat) {
    return [
      think('No searchable term survived parsing, so I fall back to listing the tree.'),
      tool('glob', { pattern: globHint ? globHint[0] : '**/*', path: dirHint || undefined }),
      say('', ({ results }) => voice.compose({
        headline: 'Nothing specific to search for',
        body: [`${(results[0] && results[0].summary) || 'No files matched.'} Give me a string or a symbol and I will grep for it properly.`],
        confidence: false,
      })),
    ];
  }

  const input = { pattern: pat.pattern, maxResults: 200 };
  if (dirHint) input.path = dirHint;
  if (globHint) input.glob = globHint[0];
  return [
    think(`Searching for \`${pat.literal}\` with a real grep across ${dirHint || 'the working directory'} — case-sensitive first, since that is the honest match.`),
    tool('grep', input),
    say('', ({ results }) => {
      const r = results[0];
      if (!r || !r.ok) {
        return voice.compose({
          headline: `Search for \`${pat.literal}\` failed`,
          body: [(r && r.error) || 'The grep tool returned nothing at all.'],
          confidence: false,
        });
      }
      const matches = (r.meta && r.meta.matches) || [];
      if (!matches.length) {
        return voice.compose({
          headline: `No matches for \`${pat.literal}\``,
          body: ['Nothing in the working directory contains that string. If it should exist, it is either spelled differently, generated at build time, or in a directory the search skips (`node_modules`, `dist`, `.git`).'],
          confidence: false,
        });
      }
      const byFile = new Map();
      for (const m of matches) byFile.set(m.file, (byFile.get(m.file) || 0) + 1);
      const top = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      return voice.compose({
        headline: `${fmtCount(matches.length, 'match')} for \`${pat.literal}\` across ${fmtCount(byFile.size, 'file')}`,
        body: [`The densest hits are the ones worth reading first — a file with many matches is usually where the thing is defined rather than merely used.`],
        bullets: top.map(([f, n]) => `\`${f}\` — ${fmtCount(n, 'hit')}${n === 1 ? ` (line ${(matches.find((m) => m.file === f) || {}).line})` : ''}`),
        note: 'Say the word and I will open whichever of these looks right.',
        confidence: false,
      });
    }),
  ];
}

function planCreate({ cls, cwd, voice, prompt, project }) {
  let target = cls.entities.paths.find((p) => !isDir(cwd, p));
  if (!target) {
    const guess = prompt.match(/\b(?:called|named)\s+["'`]?([\w./-]+)["'`]?/i);
    target = guess ? guess[1] : '';
  }
  if (!target) {
    return [
      think('A create with no filename is not actionable — I need the path before I write anything.'),
      say('', () => voice.compose({
        headline: 'Name the file and I will write it',
        body: [
          `I can generate the starter content for a ${project.kind === 'unknown' ? 'plain' : project.kind} project, but I will not invent a path and write to it. Say something like \`create src/queue.js that batches jobs\` and I will scaffold it from the extension and the description.`,
        ],
        confidence: false,
      })),
    ];
  }
  if (!/\.\w+$/.test(target) && !target.endsWith('/')) target += project.kind === 'python' ? '.py' : '.js';

  const already = exists(cwd, target);
  const force = /\b(overwrite|replace|recreate|clobber|force)\b/i.test(prompt);

  if (already && !force) {
    return [
      think(`${target} already exists. Overwriting it uninvited is the worst outcome here, so I read it and ask.`),
      tool('read', { path: target }),
      say('', ({ results }) => {
        const r = results[0];
        const n = r && r.ok ? textOf(r).split('\n').length : 0;
        return voice.compose({
          headline: `\`${target}\` already exists`,
          body: [
            `It is ${fmtCount(n, 'line')} long and I have read it rather than replaced it. Tell me to overwrite it and I will, or describe the change and I will edit it in place.`,
          ],
          confidence: false,
        });
      }),
    ];
  }

  const content = scaffold(target, prompt, { esm: project.esm !== false });
  return [
    think(`Writing ${target}. The content has to actually parse — real imports, real exports, no ellipsis standing in for code.`),
    tool('write', { path: target, content }),
    say('', ({ results }) => {
      const r = results[0];
      if (!r || !r.ok) {
        return voice.compose({
          headline: `Could not write \`${target}\``,
          body: [(r && r.error) || 'The write tool refused.'],
          confidence: false,
        });
      }
      const meta = r.meta || {};
      const syms = outline(content).filter((s) => s.exported).map((s) => `\`${s.name}\``);
      return voice.compose({
        headline: `${meta.created === false ? 'Rewrote' : 'Created'} \`${target}\``,
        body: [
          `${meta.bytes ? `${meta.bytes} bytes, ` : ''}${fmtCount(content.split('\n').length, 'line')}. ${syms.length ? `It exports ${syms.join(', ')}.` : 'It is a starting point, not a finished feature.'}`,
          'The content is derived from the filename and what you asked for, so treat it as a skeleton with the right shape rather than working behaviour.',
        ],
        bullets: [
          'Read it back and tell me what to change.',
          project.testCommand ? `Wire it in, then \`${project.testCommand}\`.` : 'Wire it into an entry point when you are ready.',
        ],
        confidence: false,
      });
    }),
  ];
}

function planEdit({ cls, cwd, voice, prompt }) {
  const target = cls.entities.paths.find((p) => !isDir(cwd, p));
  const pair = replacementPair(prompt);

  if (!target) {
    return [
      think('An edit needs a file. Nothing in the request resolves to one.'),
      say('', () => voice.compose({
        headline: 'Which file?',
        body: ['Tell me the path and the exact change — `in src/app.js change PORT to 8080` is enough for me to do it as a real string replacement rather than a rewrite.'],
        confidence: false,
      })),
    ];
  }

  if (pair) {
    const steps = [
      think(`Replacing \`${pair.from}\` with \`${pair.to}\` in ${target}${pair.all ? ', every occurrence' : ', and it must be unambiguous'}.`),
      tool('read', { path: target }),
      tool('edit', { path: target, old_string: pair.from, new_string: pair.to, replace_all: pair.all }),
    ];
    steps.push(say('', ({ results }) => {
      const ed = results.find((r) => r.tool === 'edit');
      if (!ed || !ed.ok) {
        const err = (ed && ed.error) || 'The edit did not run.';
        return voice.compose({
          headline: 'Edit not applied',
          body: [
            `${err}`,
            /ambiguous|multiple/i.test(err)
              ? 'Give me a longer, unique snippet to anchor on, or say "every occurrence" and I will use replace_all.'
              : 'The string I was told to replace is not in the file exactly as written — whitespace and case both count.',
          ],
          confidence: false,
        });
      }
      return voice.compose({
        headline: `Updated \`${target}\``,
        body: [`Replaced \`${pair.from}\` with \`${pair.to}\`${pair.all ? ' everywhere in the file' : ''}. ${ed.summary || ''}`.trim()],
        bullets: ['The diff is above — check it before you commit.'],
        confidence: false,
      });
    }));
    return steps;
  }

  return [
    think(`${target} needs a change I cannot pin to an exact string yet, so I read it first and propose the precise edit.`),
    tool('read', { path: target }),
    say('', ({ results }) => {
      const r = results[0];
      if (!r || !r.ok) {
        return voice.compose({ headline: `Could not read \`${target}\``, body: [(r && r.error) || 'read failed'], confidence: false });
      }
      const text = textOf(r);
      const syms = outline(text).slice(0, 5).map((s) => `\`${s.name}\` (line ${s.line})`);
      return voice.compose({
        headline: `Read \`${target}\` — tell me the exact change`,
        body: [
          `${fmtCount(text.split('\n').length, 'line')}. I deliberately did not guess at an edit: an inexact string replacement is how files get quietly corrupted.`,
          'Phrase it as "change X to Y" and I will apply it as a real, anchored replacement.',
        ],
        bullets: syms.length ? [`Candidates in this file: ${syms.join(', ')}`] : [],
        confidence: false,
      });
    }),
  ];
}

function planFix({ cls, cwd, voice, project, prompt }) {
  const target = cls.entities.paths.find((p) => !isDir(cwd, p));
  const term = searchPattern(cls);
  const steps = [think(`Something is failing. Evidence before theory: ${target ? `read ${target}` : 'find where the symptom is produced'} first.`)];

  if (target) steps.push(tool('read', { path: target }));
  else if (term) steps.push(tool('grep', { pattern: term.pattern, maxResults: 40 }));

  const wantsRun = /\btests?\b|\bfail/i.test(prompt) && project.testCommand;
  if (wantsRun) steps.push(tool('bash', { command: project.testCommand }));

  steps.push(say('', ({ results }) => {
    const read = firstOf(results, 'read');
    const grep = firstOf(results, 'grep');
    const run = results.find((r) => r.tool === 'bash');
    const bullets = [];
    if (read) bullets.push(...reviewNotes(textOf(read), read.input.path).slice(0, 3));
    if (grep) {
      const ms = (grep.meta && grep.meta.matches) || [];
      bullets.push(ms.length ? `\`${term.literal}\` appears in ${fmtCount(new Set(ms.map((m) => m.file)).size, 'file')}; first at ${ms[0].file}:${ms[0].line}.` : `\`${term.literal}\` does not appear anywhere in the tree, which is itself a clue.`);
    }
    if (run) {
      const meta = run.meta || {};
      const firstErr = String(meta.stderr || meta.stdout || '').split('\n').find((l) => /error|fail|assert|throw|expected/i.test(l));
      bullets.push(`\`${run.input.command}\` exited ${meta.code}${meta.timedOut ? ' (timed out)' : ''}${firstErr ? ` — first failure: ${firstErr.trim().slice(0, 140)}` : ''}.`);
    }
    return voice.compose({
      headline: run && run.meta && run.meta.code === 0 ? 'It passes right now' : 'Here is what the evidence says',
      body: [
        bullets.length
          ? 'Everything below comes from the tool output above, not from assumption. I have not changed any code yet — tell me which of these to act on and I will make the edit.'
          : 'I could not gather evidence: nothing was named that I could read, and no search term survived parsing. Give me the file, the error text, or the command that fails.',
      ],
      bullets,
      note: 'If you paste the actual error output I can anchor the fix on the exact line it names.',
      confidence: false,
    });
  }));
  return steps;
}

function planRefactor({ cls, cwd, voice, prompt }) {
  const target = cls.entities.paths.find((p) => !isDir(cwd, p));
  const pair = replacementPair(prompt);
  if (!target) {
    return [
      think('Refactoring without a target file is just opinion. Ask for the path.'),
      say('', () => voice.compose({
        headline: 'Point me at the file',
        body: ['Give me the path and I will read it and propose a concrete split — with line numbers, not principles.'],
        confidence: false,
      })),
    ];
  }
  const steps = [
    think(`Refactor of ${target}: read it, find the seams, and propose rather than perform. A refactor that arrives as a surprise diff is not a favour.`),
    tool('read', { path: target }),
  ];
  if (pair && /\brename\b/i.test(prompt)) {
    steps.push(tool('edit', { path: target, old_string: pair.from, new_string: pair.to, replace_all: true }));
  }
  steps.push(say('', ({ results }) => {
    const r = firstOf(results, 'read');
    if (!r) return voice.compose({ headline: `Could not read \`${target}\``, body: ['read failed'], confidence: false });
    const text = textOf(r);
    const syms = outline(text);
    const lines = text.split('\n').length;
    const big = syms.map((s, i) => ({ ...s, span: (syms[i + 1] ? syms[i + 1].line : lines) - s.line }))
      .sort((a, b) => b.span - a.span).slice(0, 4);
    const ed = results.find((x) => x.tool === 'edit');
    return voice.compose({
      headline: `Refactor plan for \`${target}\``,
      body: [
        `${fmtCount(lines, 'line')}, ${fmtCount(syms.length, 'top-level declaration')}. The largest units are the natural seams — split there and nothing else has to move.`,
        ed ? (ed.ok ? `I also applied the rename you asked for: ${ed.summary || 'done'}.` : `The rename did not apply: ${ed.error}`) : 'I have not changed anything yet; say which of these to do and it happens in one edit.',
      ],
      bullets: big.map((s) => `\`${s.name}\` spans about ${fmtCount(s.span, 'line')} from line ${s.line} — ${s.span > 60 ? 'a good extraction candidate' : 'small enough to leave alone'}.`),
      confidence: false,
    });
  }));
  return steps;
}

function planTest({ voice, project, cls }) {
  const cmd = cls.entities.commands.find((c) => /test|jest|vitest|pytest/.test(c)) || project.testCommand;
  if (!cmd) {
    return [
      think('No test command is discoverable: no package script, no pytest, no Cargo, no Makefile.'),
      tool('ls', { path: '.' }),
      say('', () => voice.compose({
        headline: 'No test command found',
        body: [`Nothing in \`${project.name}\` declares one — no \`scripts.test\`, no \`pyproject.toml\`, no \`Cargo.toml\`, no \`Makefile\`. Tell me the command and I will run it.`],
        confidence: false,
      })),
    ];
  }
  return [
    think(`\`${cmd}\` is the project's own test command. Run it and read the exit code before drawing any conclusion.`),
    tool('bash', { command: cmd, timeout: 180000 }),
    say('', ({ results }) => {
      const r = results[0];
      const meta = (r && r.meta) || {};
      const out = `${meta.stdout || ''}\n${meta.stderr || ''}`;
      const pass = meta.code === 0;
      const fails = out.split('\n').filter((l) => /^\s*(?:not ok|FAIL|✗|×|E\s|AssertionError|Error:)/.test(l)).slice(0, 5);
      const counts = out.match(/(\d+)\s+(?:passing|passed|pass)\b/i);
      return voice.compose({
        headline: pass ? `\`${cmd}\` passed` : `\`${cmd}\` failed (exit ${meta.code})`,
        body: [
          pass
            ? `Exit code 0${counts ? `, ${counts[1]} passing` : ''}${meta.durationMs ? ` in ${(meta.durationMs / 1000).toFixed(1)}s` : ''}. Note that a suite which ran nothing also exits 0, so it is worth checking the count is what you expect.`
            : `${meta.timedOut ? 'It timed out rather than finishing. ' : ''}The first failure is the one to fix; the rest are usually downstream of it.`,
        ],
        bullets: fails.map((f) => `\`${f.trim().slice(0, 120)}\``),
        note: pass ? undefined : 'Say "fix it" and I will read the failing file and propose an anchored edit.',
        confidence: false,
      });
    }),
  ];
}

function planRun({ cls, voice, project }) {
  const cmd = cls.entities.commands[0] || project.runCommand;
  if (!cmd) {
    return [
      think('No command was given and the project does not declare a runnable script.'),
      tool('read', { path: 'package.json' }),
      say('', ({ results }) => {
        const r = results[0];
        let scripts = [];
        if (r && r.ok) {
          try {
            scripts = Object.entries(JSON.parse(textOf(r)).scripts || {}).map(([k, v]) => `\`${k}\` → \`${v}\``);
          } catch (err) {
            scripts = [`package.json did not parse: ${err.message}`];
          }
        }
        return voice.compose({
          headline: 'Which command?',
          body: [scripts.length ? 'These are the scripts this project declares:' : `I could not find a runnable script in \`${project.name}\`. Give me the exact command and I will run it.`],
          bullets: scripts.slice(0, 10),
          confidence: false,
        });
      }),
    ];
  }
  return [
    think(`Running \`${cmd}\`. Exit code first, output second — that ordering stops me over-reading a noisy log.`),
    tool('bash', { command: cmd }),
    say('', ({ results }) => {
      const r = results[0];
      const meta = (r && r.meta) || {};
      const out = String(meta.stdout || '').trim();
      const err = String(meta.stderr || '').trim();
      const tail = (out || err).split('\n').slice(-6).join('\n');
      return voice.compose({
        headline: meta.code === 0 ? `\`${cmd}\` succeeded` : `\`${cmd}\` exited ${meta.code}`,
        body: [
          meta.timedOut
            ? 'It hit the timeout, which means it is long-running rather than broken — a dev server, most likely.'
            : `${meta.durationMs ? `Finished in ${(meta.durationMs / 1000).toFixed(1)}s. ` : ''}${out || err ? 'The tail of the output:' : 'It produced no output at all.'}`,
        ],
        code: (out || err) ? { lang: 'text', text: tail } : undefined,
        confidence: false,
      });
    }),
  ];
}

function planCommit({ voice, project, ctx }) {
  const model = (ctx && ctx.model) || (voice && voice.model);
  const author = model ? `${model.name} - Tripplet` : 'Astro 5 Code - Tripplet';
  return [
    think('Before proposing a message I need the actual change set — status and a stat diff, not a guess at what was edited.'),
    tool('bash', { command: 'git status --short' }),
    tool('bash', { command: 'git diff --stat HEAD' }),
    say('', ({ results }) => {
      const st = results[0];
      const stat = results[1];
      const dirty = String((st && st.meta && st.meta.stdout) || '').trim();
      if (!project.hasGit) {
        return voice.compose({
          headline: 'Not a git repository',
          body: [`\`${project.cwd}\` has no \`.git\`, so there is nothing to commit into. Run \`git init\` first.`],
          confidence: false,
        });
      }
      if (!dirty) {
        return voice.compose({
          headline: 'Nothing to commit',
          body: ['The working tree is clean — `git status --short` returned no entries.'],
          confidence: false,
        });
      }
      const files = dirty.split('\n').filter(Boolean);
      const subject = suggestSubject(files);
      return voice.compose({
        headline: `${fmtCount(files.length, 'file')} ready to commit`,
        body: [
          `Here is the message I would use. Run \`/commit\` to stage everything and apply it — that path builds the trailer properly rather than trusting me to retype it.`,
        ],
        code: {
          lang: 'text',
          text: `${subject}\n\n${(stat && stat.meta && String(stat.meta.stdout).trim().split('\n').slice(-1)[0]) || ''}\n\n🚀 Generated with Astrocode\n\nCo-Authored by ${author}`.replace(/\n{3,}/g, '\n\n'),
        },
        bullets: files.slice(0, 8).map((f) => `\`${f.trim()}\``),
        confidence: false,
      });
    }),
  ];
}

/** A conventional-commit-ish subject from the porcelain status lines. */
function suggestSubject(statusLines) {
  const files = statusLines.map((l) => l.trim().split(/\s+/).slice(-1)[0]);
  const added = statusLines.filter((l) => /^\?\?|^A/.test(l.trim())).length;
  const dirs = new Set(files.map((f) => (f.includes('/') ? f.split('/')[0] : 'root')));
  const scope = dirs.size === 1 ? [...dirs][0] : '';
  const kind = added === files.length ? 'feat' : added ? 'feat' : 'fix';
  const what = files.length === 1
    ? `update ${path.basename(files[0])}`
    : `update ${fmtCount(files.length, 'file')}${scope && scope !== 'root' ? ` in ${scope}` : ''}`;
  return `${kind}${scope && scope !== 'root' ? `(${scope})` : ''}: ${what}`;
}

function planPlan({ cls, voice, project, prompt }) {
  return [
    think(`This is explicitly a planning request, so no tool may mutate anything. Think it through, write it down, stop.`),
    tool('ls', { path: '.' }),
    say('', ({ results }) => {
      const listing = (results[0] && results[0].summary) || '';
      const steps = proposeSteps(prompt, cls, project);
      return voice.compose({
        headline: 'Plan',
        body: [
          `Working from what is actually here (${listing || `${project.kind} project \`${project.name}\``}), this is the order I would do it in. Nothing below has been executed.`,
        ],
        bullets: steps,
        note: 'Say "do it" and I will start at step one. In `plan` permission mode every mutating tool is denied, so you can iterate on this safely.',
        confidence: false,
      });
    }),
  ];
}

function proposeSteps(prompt, cls, project) {
  const steps = [];
  const p = cls.entities.paths[0];
  steps.push(p ? `Read \`${p}\` and whatever it imports, to fix the current behaviour in place.` : 'Read the entry point and the module the change lands in, so the starting state is known rather than assumed.');
  steps.push('Write the smallest change that could work, in one file, with no refactoring alongside it.');
  if (project.testCommand) steps.push(`Run \`${project.testCommand}\` and read the first failure only.`);
  else steps.push('Add a test that fails before the change and passes after it — otherwise "done" is a feeling.');
  steps.push('Re-read the diff as a reviewer would: is anything in it unrelated to the request?');
  if (project.hasGit) steps.push('Commit with a subject that says what changed and a body that says why.');
  const risk = /\bmigrat|\bdatabase\b|\bauth|\bdeploy|\bproduction\b/i.test(prompt);
  if (risk) steps.push('Because this touches something with real consequences, do it behind a flag and keep the old path until the new one is proven.');
  return steps;
}

function planChat({ cls, voice, project, prompt }) {
  const isGreeting = /^\s*(hi|hey|hello|yo|sup|good (morning|afternoon|evening))\b/i.test(prompt);
  const asksWhoAreYou = /\b(who are you|what are you|what can you do|help me|how do you work)\b/i.test(prompt);

  if (isGreeting) {
    return [
      think('A greeting. Answer it like a person, then get out of the way.'),
      say('', () => voice.compose({
        headline: undefined,
        body: [
          `Hello. You are in \`${project.name}\`${project.kind !== 'unknown' ? ` — a ${project.kind} project` : ''}, and I can read, search, edit and run things in it.`,
          'What do you want to do?',
        ],
        closing: false,
        confidence: false,
      })),
    ];
  }

  if (asksWhoAreYou) {
    return [
      think('Worth being straight about what I am: a simulated model driving real tools.'),
      say('', () => voice.compose({
        headline: `${voice.model.name}, running in Astrocode`,
        body: [
          `I am a simulated model — the reasoning and prose you see are generated locally by Astrocode, with no network call anywhere. The tools are not simulated: \`read\`, \`write\`, \`edit\`, \`bash\`, \`glob\` and \`grep\` genuinely touch \`${project.cwd}\`, gated by the permission mode in the status line.`,
          'That combination is the honest description: treat my reasoning as a well-informed suggestion, and the tool output as fact.',
        ],
        bullets: [
          'Ask me to read or explain a file and I will actually open it.',
          'Ask me to create one and I will write real, parseable content.',
          'Ask me to run the tests and I will run your project\'s own test command.',
          'Use `/model` to switch between Astro 5 Code, Taipei 4, Majuli 4 and Suzhou 4 — they behave differently.',
        ],
        confidence: false,
      })),
    ];
  }

  return [
    think(`No file, no command, no obvious task in "${prompt.slice(0, 60)}". Answer conversationally and be honest about the limits.`),
    say('', () => voice.compose({
      headline: undefined,
      body: [
        `I do not have a tool call that would help with that, so this is me answering directly rather than pretending to investigate.`,
        `I am a simulated model, which means anything I state as fact about the world should be checked; anything I show you from \`${project.name}\` came from a real read of the disk. If you point me at a file, a symbol or a command, I can do genuine work on it.`,
      ],
      bullets: [
        cls.entities.symbols.length ? `I can grep for \`${cls.entities.symbols[0]}\` if that is what you meant.` : 'Name a path and I will read it.',
        project.testCommand ? `\`${project.testCommand}\` is this project's test command if you want it run.` : 'Give me a shell command and I will run it.',
      ],
      confidence: false,
    })),
  ];
}
