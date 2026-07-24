/**
 * personas.js — what makes the four models feel like four different minds.
 *
 * `models.js` carries the numbers (cps, thinkRatio, latency); this module
 * carries the *register*. Astro states and acts, Taipei clips everything down
 * to fragments, Majuli keeps pulling in the surrounding repo, Suzhou lists
 * hypotheses and knocks them over. Same plan, four very different transcripts.
 *
 * The seeded PRNG lives here rather than in its own module because voice is
 * the only thing that needs randomness and it must stay reproducible: nothing
 * in this file (or anything downstream of it) may call Math.random or Date.now,
 * or `--seed` would stop reproducing a run exactly.
 */

import { getModel, DEFAULT_MODEL_ID } from '../core/models.js';
import { getEffort, DEFAULT_EFFORT } from '../core/effort.js';

// ── seeded randomness ───────────────────────────────────────────────────────

/** Classic mulberry32 — 32 bits of state, good enough and fast. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, so a string seed (`--seed hello`) is as usable as a number. */
export function hashString(str) {
  let h = 0x811c9dc5;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Accepts a number, a string, or nothing (nothing still yields a fixed run). */
export function makeRng(seed) {
  if (typeof seed === 'function') return seed;
  if (typeof seed === 'number' && Number.isFinite(seed)) return mulberry32(seed);
  return mulberry32(hashString(seed === undefined || seed === null ? 'astrocode' : seed));
}

export const intBetween = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
export const chance = (rng, p) => rng() < p;
export const pick = (rng, arr) => (arr && arr.length ? arr[Math.floor(rng() * arr.length) % arr.length] : undefined);

/** Fisher-Yates on a copy — the input array is shared bank data. */
export function shuffled(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pickN(rng, arr, n) {
  return shuffled(rng, arr).slice(0, Math.max(0, n));
}

// ── facts the voices talk about ─────────────────────────────────────────────

const LANGS = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'React',
  ts: 'TypeScript', tsx: 'React + TypeScript', py: 'Python', rb: 'Ruby',
  go: 'Go', rs: 'Rust', java: 'Java', c: 'C', h: 'C', cpp: 'C++', cs: 'C#',
  sh: 'shell', bash: 'shell', zsh: 'shell', json: 'JSON', md: 'Markdown',
  html: 'HTML', css: 'CSS', scss: 'SCSS', yml: 'YAML', yaml: 'YAML',
  toml: 'TOML', sql: 'SQL', swift: 'Swift', kt: 'Kotlin', php: 'PHP',
};

/** Intents collapse into four narrative shapes — that is what the banks key on. */
export const GROUPS = {
  read: 'inspect', explain: 'inspect', review: 'inspect', search: 'inspect',
  create: 'mutate', edit: 'mutate', fix: 'mutate', refactor: 'mutate',
  run: 'exec', test: 'exec', commit: 'exec',
  chat: 'talk', plan: 'talk',
};

export const groupOf = (intent) => GROUPS[intent] || 'talk';

function splitPath(p) {
  const s = String(p || '');
  const i = s.lastIndexOf('/');
  const dir = i === -1 ? '' : s.slice(0, i);
  const base = i === -1 ? s : s.slice(i + 1);
  const d = base.lastIndexOf('.');
  const ext = d > 0 ? base.slice(d + 1).toLowerCase() : '';
  return { dir, base, ext };
}

/** Everything a bank line is allowed to reference, derived once per burst. */
export function factsFor(intent, ctx = {}) {
  const ents = ctx.entities || {};
  const paths = (ents.paths || []).slice();
  const symbols = (ents.symbols || []).slice();
  const commands = (ents.commands || []).slice();
  const path = paths[0] || '';
  const { dir, base, ext } = splitPath(path);
  const prompt = String(ctx.prompt || '').trim();
  return {
    intent,
    group: groupOf(intent),
    prompt,
    subject: shortSubject(prompt),
    hint: String(ctx.hint || '').trim(),
    path,
    paths,
    other: paths[1] || '',
    dir: dir || '.',
    base: base || '',
    ext,
    lang: LANGS[ext] || '',
    sym: symbols[0] || '',
    syms: symbols,
    cmd: commands[0] || '',
    n: paths.length,
    tools: ctx.tools || [],
    project: ctx.project || '',
    confidence: ctx.confidence ?? 0.7,
    phase: ctx.phase || 0,
  };
}

/** A short, quotable version of the request for lines that echo it back. */
function shortSubject(prompt) {
  const one = prompt.replace(/\s+/g, ' ').trim();
  if (one.length <= 58) return one;
  const cut = one.slice(0, 58);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 24 ? cut.slice(0, sp) : cut).trim()}…`;
}

const has = (f, need) => {
  if (!need) return true;
  if (need === 'path') return !!f.path;
  if (need === 'sym') return !!f.sym;
  if (need === 'cmd') return !!f.cmd;
  if (need === 'many') return f.n > 1;
  if (need === 'lang') return !!f.lang;
  if (need === 'hint') return !!f.hint;
  return true;
};

const L = (need, text) => (typeof need === 'function' ? { text: need } : { need, text });

// ── the four banks ──────────────────────────────────────────────────────────
//
// Head variants are the only place a seed changes *which* sentence opens a
// burst; the rest of a group runs in written order so the reasoning still
// reads as a progression, and the generic tail is shuffled for texture.

const PRECISE = {
  label: 'precise',
  openers: ['Done.', 'Here it is.', 'That is handled.', 'Ready.'],
  closers: [
    'Say the word if you want the follow-up change too.',
    'Tell me if you want this taken further.',
    'I can wire up the rest on request.',
  ],
  heads: {
    inspect: [
      L('path', (f) => `Reading ${f.path} before I say anything about it — guessing at file contents is how wrong answers start.`),
      L(null, (f) => `Scope first: ${f.subject}. That is an inspection, so nothing gets written this turn.`),
      L('sym', (f) => `The target is ${f.sym}. Definition first, then whoever calls it.`),
    ],
    mutate: [
      L('path', (f) => `The change lands in ${f.path}. I want the exact current contents before I touch it.`),
      L(null, (f) => `Plan: read, patch, verify. In that order, no speculative edits.`),
      L('hint', (f) => `${f.hint} That is the whole job — I will not widen it.`),
    ],
    exec: [
      L('cmd', (f) => `I will run \`${f.cmd}\` and read the exit code before drawing any conclusion.`),
      L(null, () => 'Running it is cheaper than reasoning about what it would print. Run first.'),
    ],
    talk: [
      L(null, (f) => `No file was named, so this is a conversation rather than a task: ${f.subject}`),
      L(null, () => 'Nothing here needs a tool. I should answer directly and keep it short.'),
    ],
  },
  groups: {
    inspect: [
      L(null, () => 'Read the whole file rather than the part that looks relevant — the interesting bit is usually two functions away.'),
      L('many', (f) => `${f.n} files are in scope. I will take them in the order they were named and stop when the answer is complete.`),
      L('lang', (f) => `${f.lang}, so the things worth reporting are the exports, the side effects at import time, and anything async.`),
      L(null, () => 'The answer should be a summary with line references, not a paste of the file back at the user.'),
      L('sym', (f) => `If ${f.sym} turns out to be re-exported rather than defined here, I follow it one hop and no further.`),
      L(null, () => 'Structure first, details second. If the file is long I describe the shape and quote only what matters.'),
    ],
    mutate: [
      L('path', (f) => `${f.base} may already exist. If it does, I edit rather than overwrite — clobbering someone's file is not a fix.`),
      L('lang', (f) => `It is ${f.lang}. The stub has to actually parse: real imports, real exports, no ellipsis.`),
      L(null, () => 'Match the surrounding style rather than my own. Consistency beats preference in someone else\'s repo.'),
      L(null, () => 'One change per turn. If a second edit suggests itself, I mention it instead of doing it uninvited.'),
      L('sym', (f) => `${f.sym} is the anchor. Everything I write hangs off that name so the diff stays readable.`),
      L(null, () => 'After the write I state precisely what changed, so the user can undo it without reading the diff.'),
    ],
    exec: [
      L(null, () => 'Exit code first, output second. A zero with warnings is a pass; a non-zero with a tidy log is not.'),
      L('cmd', (f) => `\`${f.cmd}\` may take a while. I let it finish rather than guessing from partial output.`),
      L(null, () => 'If it fails I quote the first real error, not the last line — stack tails are noise.'),
      L(null, () => 'No retries with different flags. If the command is wrong, the user should hear that from me.'),
    ],
    talk: [
      L(null, () => 'Answer the question that was asked. Not the adjacent question I would prefer to answer.'),
      L(null, () => 'I am a simulated model, so I should be plain about what I actually know versus what the tools can check.'),
      L(null, () => 'Short paragraphs. If the reply needs a list, it should be three items, not nine.'),
    ],
  },
  generic: [
    L(null, () => 'Confidence is high enough to act. If it drops mid-way I stop and say so.'),
    L(null, () => 'Every claim I make in the answer should be traceable to something a tool returned.'),
    L(null, () => 'Nothing outside the working directory gets touched. That boundary is not negotiable.'),
    L(null, () => 'Worth deciding now what "done" looks like, so I stop at it rather than past it.'),
    L('path', (f) => `Failure mode to avoid: describing ${f.base} from its name instead of its contents.`),
    L(null, () => 'The user is a developer. No preamble, no restating the request back at them.'),
    L(null, () => 'If a tool comes back with an error, that error is the answer — I do not paper over it.'),
    L(null, () => 'Keep the reply short enough to read in one screen.'),
    L(null, () => 'Check the obvious explanation before the clever one. It is usually the obvious one.'),
    L(null, () => 'No new dependencies. Whatever this needs, the standard library already has.'),
  ],
  hint: (h) => h,
  narrate: (label) => `${label}.`,
  compose(parts, rng) {
    const out = [];
    if (parts.headline) out.push(`**${parts.headline}**`);
    for (const p of parts.body || []) out.push(p);
    if (parts.code) out.push(fence(parts.code));
    if (parts.bullets && parts.bullets.length) out.push(parts.bullets.map((b) => `- ${b}`).join('\n'));
    if (parts.note) out.push(parts.note);
    if (parts.closing !== false && (parts.body || []).length) out.push(pick(rng, this.closers));
    return out.filter(Boolean).join('\n\n');
  },
  sign(text, rng) {
    return text;
  },
};

const TERSE = {
  label: 'terse',
  openers: ['Done.', 'Yep.', 'Handled.', 'Fixed.'],
  closers: ['Anything else?', 'Next?', 'That is it.'],
  heads: {
    inspect: [
      L('path', (f) => `${f.path}. Open it.`),
      L('sym', (f) => `Looking for ${f.sym}. Nothing else.`),
      L(null, () => 'Read. Answer. Done.'),
    ],
    mutate: [
      L('path', (f) => `One file: ${f.base}.`),
      L(null, () => 'Small change. No survey needed.'),
      L('hint', (f) => `${f.hint} Fine.`),
    ],
    exec: [
      L('cmd', (f) => `Run \`${f.cmd}\`. Read the code.`),
      L(null, () => 'Just run it.'),
    ],
    talk: [
      L(null, () => 'No files named. Talk, not tools.'),
      L(null, () => 'Straight answer. Short.'),
    ],
  },
  groups: {
    inspect: [
      L(null, () => 'Whole file. Faster than seeking.'),
      L('many', (f) => `${f.n} files. In order.`),
      L('lang', (f) => `${f.lang}. Exports matter, rest is noise.`),
      L(null, () => 'Summarise. Do not paste it back.'),
      L(null, () => 'Line numbers or it did not happen.'),
    ],
    mutate: [
      L('path', (f) => `Exists? Edit. Missing? Write.`),
      L('lang', (f) => `${f.lang}. Must parse.`),
      L(null, () => 'Match local style. Not mine.'),
      L(null, () => 'One edit. No drive-by cleanups.'),
      L('sym', (f) => `${f.sym} is the anchor.`),
      L(null, () => 'Say what changed. Two lines.'),
    ],
    exec: [
      L(null, () => 'Exit code. Then output.'),
      L(null, () => 'Fails? First error only.'),
      L('cmd', (f) => `No flag roulette on \`${f.cmd}\`.`),
      L(null, () => 'Do not narrate the wait.'),
    ],
    talk: [
      L(null, () => 'Answer asked question. Not a nearby one.'),
      L(null, () => 'Simulated model. Say so if it matters.'),
      L(null, () => 'No preamble.'),
    ],
  },
  generic: [
    L(null, () => 'Enough to act.'),
    L(null, () => 'Cheap turn. Keep it cheap.'),
    L('path', (f) => `${f.dir} scope. Nothing wider.`),
    L(null, () => 'Obvious cause first.'),
    L(null, () => 'No new deps.'),
    L(null, () => 'Stop at done.'),
    L(null, () => 'Errors are the answer. Pass them through.'),
    L(null, () => 'Short reply. Developer audience.'),
  ],
  hint: (h) => {
    const first = h.split(/(?<=[.;])\s/)[0] || h;
    return first.replace(/^(I(?:'ll| will| should| want to)|Then|Next,?)\s+/i, '').replace(/^./, (c) => c.toUpperCase());
  },
  narrate: (label) => label,
  compose(parts) {
    const out = [];
    if (parts.headline) out.push(`**${parts.headline}**`);
    const body = (parts.body || []).slice(0, 1);
    for (const p of body) out.push(clipSentences(p, 2));
    if (parts.code) out.push(fence(parts.code));
    if (parts.bullets && parts.bullets.length) {
      out.push(parts.bullets.slice(0, 4).map((b) => `- ${clipSentences(b, 1)}`).join('\n'));
    }
    return out.filter(Boolean).join('\n\n');
  },
  sign(text) {
    return text.replace(/\n{3,}/g, '\n\n').trimEnd();
  },
};

const EXPANSIVE = {
  label: 'expansive',
  openers: ['Here is what I found.', 'Right — here is the picture.', 'Done, and here is the context around it.'],
  closers: [
    'Happy to widen this to the rest of the module if that would help.',
    'If you want, I can trace the callers next and check nothing else assumes the old shape.',
    'There are a couple of neighbouring files I would look at next — say the word.',
  ],
  heads: {
    inspect: [
      L('path', (f) => `${f.path} sits in ${f.dir}, so before reading it I want a rough map of what else lives alongside it — files rarely mean much alone.`),
      L(null, (f) => `The request is "${f.subject}", which in a repo this shape usually means the answer spans more than the one file that was named.`),
      L('sym', (f) => `${f.sym} is the thread to pull. Where it is defined matters less than where it is depended on.`),
    ],
    mutate: [
      L('path', (f) => `Editing ${f.base} means thinking about its neighbours in ${f.dir}: an index that re-exports it, a test beside it, a caller upstream.`),
      L(null, () => 'A change is never local in practice. I want to know what the change implies before I make it.'),
      L('hint', (f) => `${f.hint} That is the core of it, though the interesting part is usually what surrounds the change rather than the change itself.`),
    ],
    exec: [
      L('cmd', (f) => `\`${f.cmd}\` is the entry point, but what it means depends on how this project is wired — scripts, config, and whatever the runner assumes.`),
      L(null, () => 'Running it tells me the truth about this repo, which is more reliable than what the README believes about it.'),
    ],
    talk: [
      L(null, (f) => `No path was named, so I am answering from context: "${f.subject}". That is fine — it just means the repo is background rather than subject.`),
      L(null, () => 'This is conversation, not a task. Still worth grounding the answer in what this project actually looks like.'),
    ],
  },
  groups: {
    inspect: [
      L(null, () => 'Reading a file well means reading its imports as a table of contents: they tell you what the author thought the file was for.'),
      L('many', (f) => `${f.n} files were named, which is enough that the relationships between them are probably the actual question.`),
      L('lang', (f) => `${f.lang} conventions matter here — module boundaries, what is exported versus internal, and whether side effects happen at import time.`),
      L(null, () => 'I want to notice what is missing as much as what is there: no tests, no error handling, a TODO that outlived its author.'),
      L(null, () => 'Naming conventions in a repo are load-bearing. If this one has a house style, my answer should speak it.'),
      L('path', (f) => `If ${f.base} has a sibling test file, that test is often a better description of intent than the implementation is.`),
      L(null, () => 'The honest summary includes the parts I am unsure about, not just the parts that were easy to read.'),
    ],
    mutate: [
      L('path', (f) => `First question: does ${f.path} already exist? Writing over someone's work is a much worse failure than refusing to write.`),
      L('lang', (f) => `As ${f.lang}, the file has obligations beyond parsing — imports resolvable, exports matching how the rest of the repo imports things.`),
      L(null, () => 'I would rather write something small and correct that the user extends than something broad and speculative they have to delete.'),
      L(null, () => 'Style is a form of documentation. Two-space indent or four, semicolons or not — I follow whatever is already here.'),
      L('many', (f) => `Touching ${f.n} files at once raises the odds of a partial failure, so the order matters: least dependent first.`),
      L(null, () => 'Afterwards the summary should say what changed and, just as importantly, what I deliberately left alone.'),
      L('sym', (f) => `If ${f.sym} is exported, renaming it is an API change, and API changes deserve a sentence of their own in the reply.`),
    ],
    exec: [
      L(null, () => 'Before trusting a command I want to know where it came from: a package script, a Makefile, or a guess on my part.'),
      L(null, () => 'Test output is a document. The first failure usually explains the next six, so I read from the top.'),
      L(null, () => 'A slow command is not a stuck command. I let it run and report the duration honestly.'),
      L(null, () => 'If the environment is the problem — missing binary, wrong node version — that is worth saying plainly rather than retrying.'),
      L('cmd', (f) => `\`${f.cmd}\` runs in the project root, which matters: relative paths in config will resolve from there, not from wherever the user is.`),
    ],
    talk: [
      L(null, () => 'The useful version of this answer connects the general point to this specific repo, otherwise it is just documentation.'),
      L(null, () => 'I am a simulated model in a real CLI: the reasoning is generated, the tools genuinely touch the disk. Worth being clear on which is which.'),
      L(null, () => 'Two or three paragraphs, then stop. Length is not the same thing as thoroughness.'),
    ],
  },
  generic: [
    L(null, () => 'Worth stating my assumptions in the reply, since an unstated wrong assumption is the most expensive kind.'),
    L('path', (f) => `Everything stays inside the working directory. ${f.dir} is the blast radius and it should stay that way.`),
    L(null, () => 'If I hit something surprising I would rather stop and describe it than smooth it over and continue.'),
    L(null, () => 'The repo has its own history and its own reasons. Anything that looks wrong might just be context I do not have.'),
    L(null, () => 'A good answer leaves the user able to do the next step themselves, not dependent on me for it.'),
    L(null, () => 'No new dependencies — a zero-dependency project stays that way by refusing every individually reasonable exception.'),
    L(null, () => 'I should distinguish what I observed from what I inferred. They read the same in prose and they are not the same.'),
    L(null, () => 'If there is a cheaper way to get the same certainty, take the cheaper way.'),
    L(null, () => 'The failure mode for a long-context model is answering at length instead of answering well.'),
    L(null, () => 'Precision about line numbers and paths is what makes the rest of the answer checkable.'),
  ],
  hint: (h) => h,
  narrate: (label) => `${label} — and noting what surrounds it.`,
  compose(parts, rng) {
    const out = [];
    if (parts.headline) out.push(`**${parts.headline}**`);
    for (const p of parts.body || []) out.push(p);
    if (parts.code) out.push(fence(parts.code));
    if (parts.bullets && parts.bullets.length) out.push(parts.bullets.map((b) => `- ${b}`).join('\n'));
    if (parts.context) out.push(parts.context);
    if (parts.note) out.push(parts.note);
    if (parts.closing !== false) out.push(pick(rng, this.closers));
    return out.filter(Boolean).join('\n\n');
  },
  sign(text) {
    return text;
  },
};

const ANALYTICAL = {
  label: 'analytical',
  openers: ['Result below, with the reasoning that got there.', 'Here is the conclusion and how it was reached.'],
  closers: [
    'If any of the ruled-out branches turn out to matter, say so and I will reopen them.',
    'The weakest link above is the assumption I could not test — flag it if it looks wrong to you.',
  ],
  heads: {
    inspect: [
      L('path', (f) => `Three ways this question resolves: (a) the answer is entirely inside ${f.base}, (b) it depends on a caller, (c) it depends on config. Start with (a) because it is cheapest to falsify.`),
      L(null, (f) => `Restating precisely, so I can test it: "${f.subject}". Anything I answer beyond that restatement is scope creep.`),
      L('sym', (f) => `Candidate readings of "${f.sym}": a function, a type, or a string constant. The file itself decides which, so read before asserting.`),
    ],
    mutate: [
      L('path', (f) => `Two failure modes dominate here: (a) writing to ${f.path} when it already exists, (b) writing content that does not parse. Both are checkable before I act.`),
      L(null, () => 'Enumerate first: the change is either additive, a replacement, or a rename. Each has a different safe procedure, so I should decide which one this is.'),
      L('hint', (f) => `Given: ${f.hint} The question is what that implies that has not been stated.`),
    ],
    exec: [
      L('cmd', (f) => `Possible outcomes of \`${f.cmd}\`: pass, fail on assertions, fail to start. Only the third would mean my premise is wrong, so that is the one I check first.`),
      L(null, () => 'An untested belief about what a command prints is worth nothing. Running it converts a belief into evidence.'),
    ],
    talk: [
      L(null, (f) => `No tool call is justified by "${f.subject}" — I checked whether one was, which is itself the first step.`),
      L(null, () => 'Question type: informational. Correct response: direct answer, plus the boundary of what I actually know.'),
    ],
  },
  groups: {
    inspect: [
      L(null, () => 'Discarding (c) for now: nothing in the request mentions configuration, and inventing a config dependency would be unfalsifiable.'),
      L(null, () => 'The cheapest discriminating test is simply reading the file. If (a) holds, (b) never needs investigating.'),
      L('many', (f) => `With ${f.n} files, the pairwise relationships are the likely content of the answer, not the files themselves.`),
      L('lang', (f) => `For ${f.lang}, the evidence I trust most is the export surface; comments are claims, not evidence.`),
      L(null, () => 'I should distinguish observation from inference explicitly, because conflating them is how a plausible wrong answer gets written.'),
      L(null, () => 'If the file contradicts what the user described, the file wins and I say so directly.'),
      L(null, () => 'Remaining uncertainty after reading: whatever depends on runtime state. That does not get resolved by reading and I will not pretend otherwise.'),
    ],
    mutate: [
      L(null, () => 'Ruling out the additive case if the file already exists — the safe procedure there is a replace with an exact anchor, not a write.'),
      L('lang', (f) => `Correctness bar for ${f.lang}: it parses, imports resolve, and nothing at module scope has side effects the user did not ask for.`),
      L(null, () => 'A rename that is not exhaustive is worse than no rename. So either every occurrence, or none, and I state which.'),
      L('sym', (f) => `If ${f.sym} appears more than once, an unanchored replace is ambiguous, and ambiguity here is a silent corruption, not an error.`),
      L(null, () => 'Second-order effect worth checking: does anything import this by path, such that a move would break it?'),
      L(null, () => 'Reversibility test: could the user undo this from my summary alone? If not, the summary is incomplete.'),
      L(null, () => 'The hypothesis I would most like to be wrong about is that the stated file is the right file. It usually is; it is not always.'),
    ],
    exec: [
      L(null, () => 'Exit code zero is necessary but not sufficient — a suite that ran no tests also exits zero.'),
      L(null, () => 'If it fails, the branch point is: my invocation was wrong, versus the code is wrong. The error text usually separates those in one line.'),
      L(null, () => 'Ruling out flakiness as an explanation before I have any evidence for it: that is the explanation you reach for when you have stopped looking.'),
      L('cmd', (f) => `Prior on \`${f.cmd}\` succeeding: moderate. That is not high enough to write the summary before the result arrives.`),
      L(null, () => 'Timeouts and failures look identical in a transcript and are not the same event. I will label whichever one happens.'),
    ],
    talk: [
      L(null, () => 'Checking the question for a hidden premise before answering, since answering a badly-premised question fluently is the worst outcome.'),
      L(null, () => 'I am simulated. That is relevant precisely when the user is relying on me to know something rather than to check something.'),
      L(null, () => 'Confidence should be stated as a number when it is low and omitted when it is high — the reverse of what feels natural.'),
    ],
  },
  generic: [
    L(null, (f) => `Current confidence in the classification: ${Math.round(f.confidence * 100)}%. Below about 60 I should ask rather than act.`),
    L(null, () => 'Listing what would change my mind: a contradicting file, an error from a tool, or a constraint the user has not mentioned yet.'),
    L(null, () => 'Cost of being wrong here is low and recoverable, which justifies acting rather than asking.'),
    L(null, () => 'One assumption I cannot test from here: that the working directory is the project the user means.'),
    L(null, () => 'Avoiding the trap of a fluent answer that was never checked against anything.'),
    L(null, () => 'No new dependencies is a hard constraint, not a preference, so any design that needs one is already eliminated.'),
    L('path', (f) => `Path safety: ${f.path} must resolve inside the working directory. If it does not, the correct action is refusal.`),
    L(null, () => 'Stopping condition: the evidence answers the question as asked. Not when I run out of things to check.'),
    L(null, () => 'The residual risk is unstated context. I can name it but I cannot eliminate it.'),
    L(null, () => 'Two independent signals agreeing is worth more than one signal I trust a lot.'),
  ],
  hint: (h) => `Given: ${h}`,
  narrate: (label) => `${label} — testing the first hypothesis.`,
  compose(parts, rng) {
    const out = [];
    if (parts.headline) out.push(`**${parts.headline}**`);
    for (const p of parts.body || []) out.push(p);
    if (parts.code) out.push(fence(parts.code));
    if (parts.bullets && parts.bullets.length) {
      out.push(parts.bullets.map((b, i) => `${i + 1}. ${b}`).join('\n'));
    }
    if (parts.note) out.push(parts.note);
    if (parts.confidence !== false) {
      const c = Math.round((parts.confidenceValue ?? 0.9) * 100);
      out.push(`_Confidence ${c}%. ${parts.caveat || 'Everything above came from tool output rather than assumption.'}_`);
    }
    return out.filter(Boolean).join('\n\n');
  },
  sign(text) {
    return text;
  },
};

const BANKS = {
  precise: PRECISE,
  terse: TERSE,
  expansive: EXPANSIVE,
  analytical: ANALYTICAL,
};

function fence(code) {
  const lang = code.lang || '';
  return `\`\`\`${lang}\n${String(code.text ?? '').replace(/\s+$/, '')}\n\`\`\``;
}

/** Cut prose down to `n` sentences — the terse voice's whole personality. */
function clipSentences(text, n) {
  const parts = String(text).split(/(?<=[.!?])\s+/);
  return parts.slice(0, n).join(' ').trim();
}

// ── budget ──────────────────────────────────────────────────────────────────

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * How many characters of reasoning to surface for this pairing.
 * effort.thinkBudget is in tokens; only a fraction of internal reasoning is
 * ever shown, and thinkRatio is what makes Suzhou think three times as long as
 * Taipei at identical effort.
 */
export function thinkTarget(model, effort) {
  const m = typeof model === 'string' ? getModel(model) : model;
  const e = typeof effort === 'string' ? getEffort(effort) : effort;
  const persona = (m || getModel(DEFAULT_MODEL_ID)).persona;
  const budget = (e || getEffort(DEFAULT_EFFORT)).thinkBudget * (persona.thinkRatio ?? 1);
  return clamp(Math.round(budget * 0.11), 80, 2400);
}

// ── the voice object ────────────────────────────────────────────────────────

/**
 * @param {object|string} model   Model or model id
 * @param {object|string} effort  Effort or effort id
 * @param {{rng?:function}} opts  pass the engine's seeded rng so a run repeats
 */
export function voiceFor(model, effort, opts = {}) {
  const m = (typeof model === 'string' ? getModel(model) : model) || getModel(DEFAULT_MODEL_ID);
  const e = (typeof effort === 'string' ? getEffort(effort) : effort) || getEffort(DEFAULT_EFFORT);
  const persona = m.persona;
  const bank = BANKS[persona.voice] || PRECISE;
  const rng = opts.rng || makeRng(`${m.id}:${e.id}`);

  const render = (entry, f) => {
    try {
      return entry.text(f);
    } catch (err) {
      // A bank line referencing a fact that is not there is a bug, not a crash.
      return `Working through ${f.subject || 'the request'}. (${err.message})`;
    }
  };

  const usable = (list, f) => list.filter((entry) => has(f, entry.need));

  return {
    model: m,
    effort: e,
    persona,
    voice: persona.voice,
    label: bank.label,
    cps: persona.cps,
    thinkRatio: persona.thinkRatio,
    latency: persona.latency,
    confidence: persona.confidence,
    verbosity: persona.verbosity,
    showThinking: e.showThinking,
    thinkChars: thinkTarget(m, e),
    openers: bank.openers,
    closers: bank.closers,
    rng,

    /**
     * A pool of in-voice reasoning lines for this intent, longest-first-useful.
     * The caller takes from the front until its character budget runs out.
     */
    thinkingLines(intent, ctx = {}) {
      const f = factsFor(intent, { ...ctx, confidence: ctx.confidence ?? persona.confidence });
      const group = f.group;
      const out = [];

      const heads = usable(bank.heads[group] || bank.heads.talk, f);
      const head = pick(rng, heads);
      if (head) out.push(render(head, f));

      if (f.hint) out.push(bank.hint(f.hint));

      for (const entry of usable(bank.groups[group] || [], f)) {
        const t = render(entry, f);
        if (!out.includes(t)) out.push(t);
      }
      for (const entry of shuffled(rng, usable(bank.generic, f))) {
        const t = render(entry, f);
        if (!out.includes(t)) out.push(t);
      }
      return out;
    },

    /** One-line lead-in used before a tool runs. */
    narrate(label) {
      return bank.narrate(label);
    },

    /** Assemble a markdown answer in this voice from structured parts. */
    compose(parts) {
      return bank.compose({ confidenceValue: persona.confidence, ...parts }, rng);
    },

    /** Final pass over a finished answer — the flourish, if the voice has one. */
    sign(text) {
      const t = bank.sign(String(text ?? ''), rng);
      return t.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    },

    opener() {
      return pick(rng, bank.openers);
    },
  };
}

export const voiceNames = () => Object.keys(BANKS);
