/**
 * engine.js — the simulated model loop.
 *
 * There is no backend. What this does instead is take the classification and
 * plan from `planner.js`, dress it in the model's voice from `personas.js`, and
 * emit it as a character-paced event stream so the UI has something real to
 * render incrementally. The tools it calls along the way are genuinely real, so
 * a turn has actual effects even though the "thinking" is scripted.
 *
 * Determinism is a feature: same seed + same prompt + same repo state produces
 * the same run, which is what makes `--seed` useful and the tests possible.
 */

import { voiceFor, makeRng, intBetween } from './personas.js';
import { classify, planFor } from './planner.js';
import { runTool, getTool } from '../tools/index.js';
import { estimateTokens } from '../core/tokens.js';

/** Chunk size when streaming; big enough to be cheap, small enough to look typed. */
const CHUNK = 4;
const MIN_TICK = 12;

export class Engine {
  constructor({ session, tools, permissions, theme, seed } = {}) {
    this.session = session;
    this.tools = tools;
    this.permissions = permissions;
    this.theme = theme;
    this.seed = seed ?? 1;
    this.turn = 0;
    this._abort = null;
  }

  abort() {
    this._abort?.abort();
  }

  /**
   * Run one turn.
   * @param {string} prompt
   * @param {{signal?: AbortSignal}} opts
   * @returns {AsyncGenerator<object>}
   */
  async *send(prompt, { signal } = {}) {
    const session = this.session;
    const model = session.model;
    const effort = session.effort;
    this.turn += 1;

    // Seed from the session seed *and* the turn so successive turns differ but
    // a replay of the whole session is still identical.
    const rng = makeRng(`${this.seed}:${this.turn}:${prompt}`);
    const voice = voiceFor(model, effort, { rng });

    yield { type: 'start', model: model.id, effort: effort.id };

    const inputTokens = estimateTokens(prompt) + session.contextTokens;
    let outputTokens = 0;

    const aborted = () => signal?.aborted;
    // These deliberately keep the event loop alive: in headless mode nothing
    // else does, and an unref'd timer would let the process exit mid-turn.
    const sleep = (ms) => new Promise((resolve) => {
      if (ms <= 0) { resolve(); return; }
      const t = setTimeout(resolve, ms);
      const onAbort = () => { clearTimeout(t); resolve(); };
      signal?.addEventListener('abort', onAbort, { once: true });
    });

    try {
      await sleep(intBetween(rng, voice.latency[0], voice.latency[1]));
      if (aborted()) { yield { type: 'done', reason: 'aborted' }; return; }

      const cls = classify(prompt, { cwd: session.cwd });
      const steps = planFor(cls, {
        cwd: session.cwd, session, model, effort, voice, prompt,
      });

      // ── reasoning ──────────────────────────────────────────────────────────
      if (effort.showThinking) {
        const planThoughts = steps.filter((s) => s.kind === 'think').map((s) => s.text);
        const pool = voice.thinkingLines(cls.intent, {
          prompt,
          entities: cls.entities,
          confidence: cls.confidence,
          tools: steps.filter((s) => s.kind === 'tool').map((s) => s.tool),
        });

        const budget = voice.thinkChars;
        const chosen = [];
        let used = 0;
        for (const line of interleave(planThoughts, pool)) {
          if (used >= budget) break;
          if (chosen.includes(line)) continue;
          chosen.push(line);
          used += line.length + 1;
        }

        if (chosen.length) {
          const text = `${chosen.join('\n')}\n`;
          for await (const chunk of this._stream(text, voice.cps * 1.4, sleep, aborted)) {
            outputTokens += estimateTokens(chunk);
            yield { type: 'thinking-delta', text: chunk };
          }
          yield { type: 'thinking-end' };
        }
      }
      if (aborted()) { yield { type: 'done', reason: 'aborted' }; return; }

      // ── steps ──────────────────────────────────────────────────────────────
      const results = [];
      let toolSeq = 0;

      for (const step of steps) {
        if (aborted()) break;

        if (step.kind === 'think') continue;   // already streamed above

        if (step.kind === 'tool') {
          const def = getTool(step.tool);
          if (!def) {
            results.push({ tool: step.tool, input: step.input, ok: false, error: `unknown tool ${step.tool}` });
            continue;
          }
          const id = `t${this.turn}_${++toolSeq}`;
          const describe = safeDescribe(def, step.input);

          yield { type: 'tool-start', id, tool: step.tool, title: def.title, describe };

          const verdict = this.permissions.explain(step.tool, step.input);
          let decision = verdict.decision;

          if (decision === 'ask') {
            let resolve;
            const answer = new Promise((r) => { resolve = r; });
            yield {
              type: 'tool-permission',
              id,
              tool: step.tool,
              request: {
                key: verdict.key,
                title: def.title,
                tool: step.tool,
                preview: previewOf(step.tool, step.input),
                reason: verdict.reason,
              },
              resolve,
            };
            const choice = await answer;
            if (choice === 'session') { this.permissions.allowSession(verdict.key); decision = 'allow'; }
            else if (choice === 'once') { decision = 'allow'; }
            else decision = 'deny';
          }

          if (decision !== 'allow') {
            const summary = verdict.decision === 'deny'
              ? (verdict.reason || 'Blocked by permission rules')
              : 'You declined this action';
            results.push({ tool: step.tool, input: step.input, ok: false, error: summary, denied: true });
            yield { type: 'tool-end', id, ok: false, denied: true, summary };
            // A refused mutation invalidates the rest of the plan.
            if (def.mutating) {
              yield {
                type: 'text-delta',
                text: `\nStopped: \`${def.title}\` was not permitted. Tell me what to do instead, or rerun with \`--permission-mode acceptEdits\`.\n`,
              };
              break;
            }
            continue;
          }

          const res = await runTool(step.tool, step.input, {
            cwd: session.cwd, session, theme: this.theme, signal,
          });
          const annotated = { ...res, tool: step.tool, input: step.input };
          results.push(annotated);

          yield {
            type: 'tool-end',
            id,
            ok: !!res.ok,
            summary: res.summary || res.error || '',
            detail: res.detail ?? null,
            meta: res.meta ?? null,
          };

          // A small pause after a tool reads as the model considering the result.
          await sleep(intBetween(rng, 40, 140));
          continue;
        }

        if (step.kind === 'say') {
          let markdown = step.markdown || '';
          if (typeof step.build === 'function') {
            try {
              markdown = step.build({ results, cls, session, voice, prompt });
            } catch (err) {
              markdown = `I hit an internal error composing that answer: ${err.message}`;
            }
          }
          markdown = voice.sign(markdown);
          if (!markdown) continue;
          for await (const chunk of this._stream(markdown, voice.cps, sleep, aborted)) {
            outputTokens += estimateTokens(chunk);
            yield { type: 'text-delta', text: chunk };
          }
        }
      }

      yield { type: 'usage', input: inputTokens, output: Math.max(1, outputTokens), total: inputTokens + outputTokens };
      yield { type: 'done', reason: aborted() ? 'aborted' : 'end' };
    } catch (err) {
      yield { type: 'done', reason: 'error', error: err.message };
    }
  }

  /** Character-paced generator over `text`. */
  async *_stream(text, cps, sleep, aborted) {
    const src = String(text);
    const perChar = 1000 / Math.max(40, cps);
    const chunk = Math.max(CHUNK, Math.ceil(MIN_TICK / perChar));
    const delay = Math.max(0, Math.round(perChar * chunk));
    for (let i = 0; i < src.length; i += chunk) {
      if (aborted()) return;
      yield src.slice(i, i + chunk);
      if (delay) await sleep(delay);
    }
  }
}

/** Alternate plan-derived thoughts with voice lines so both are represented. */
function interleave(a, b) {
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

export function safeDescribe(def, input) {
  try {
    return def.describe(input || {}) || '';
  } catch {
    return '';
  }
}

/** What the permission prompt shows the user before they say yes. */
export function previewOf(tool, input = {}) {
  switch (tool) {
    case 'bash': return input.command || '';
    case 'write': {
      const body = String(input.content ?? '');
      const lines = body.split('\n');
      const head = lines.slice(0, 4).join('\n');
      return `${input.path}\n${head}${lines.length > 4 ? `\n… ${lines.length - 4} more lines` : ''}`;
    }
    case 'edit':
      return `${input.path}\n- ${firstLine(input.old_string)}\n+ ${firstLine(input.new_string)}`;
    case 'multiedit':
      return `${input.path} — ${(input.edits || []).length} edits`;
    default:
      return Object.entries(input)
        .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`)
        .join('\n');
  }
}

const firstLine = (s) => String(s ?? '').split('\n')[0].slice(0, 70);

export default Engine;
