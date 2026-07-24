/**
 * remote.js — the real model loop.
 *
 * Same event stream as `engine.js`, different source of truth: instead of a
 * scripted plan, the text comes from a Tripplet model over `/api/cli/chat` and
 * the tool calls are the model's own. The UI cannot tell the two apart, which
 * is the point — `app.js` picks one at construction time and nothing else in
 * the codebase changes.
 *
 * The agent loop lives here rather than on the server because the tools touch
 * the user's filesystem: the server proposes a call, this file asks permission,
 * runs it locally, and posts the result back as the next message. One HTTP
 * request per model turn, as many turns as the work needs.
 */

import { streamChat, ApiError } from '../core/api.js';
import { runTool, getTool } from '../tools/index.js';
import { toolSchemas } from '../tools/schemas.js';
import { estimateTokens } from '../core/tokens.js';
import { previewOf, safeDescribe } from './engine.js';

/** Tool rounds before we stop offering tools and demand prose. */
const MAX_ROUNDS = 12;
/** Tool output is context: past this the model gains nothing but cost. */
const MAX_TOOL_RESULT_CHARS = 8_000;
/** How much of the transcript to replay as history. */
const MAX_HISTORY_BLOCKS = 40;

/** CLI model ids to the deployment's persona ids. */
const PERSONA_BY_MODEL = {
  'astro-5-code': 'astro-5-code',
  'taipei-4': 'tura-3',
  'majuli-4': 'majuli-3',
  'suzhou-4': 'suzhou-3',
};

export const personaFor = (model) => PERSONA_BY_MODEL[model?.id] || 'astro-5-code';

function systemPrompt(session) {
  const names = toolSchemas().map((s) => s.function.name).join(', ');
  return [
    `You are ${session.model?.name || 'Astro 5 Code'}, the model behind Astrocode — an agentic coding CLI made by Tripplet.`,
    `You are working in the directory ${session.cwd} on the user's own machine.`,
    '',
    `Tools available: ${names}. Call them rather than guessing:`,
    'read a file before you edit it, grep or glob to find code instead of assuming a path,',
    'and run the project\'s own tests with bash when you change behaviour.',
    'Some tools ask the user for approval before they run; a denial is an instruction, not an error.',
    '',
    'Answer in GitHub-flavoured markdown, rendered in a terminal: be concise, skip preamble,',
    'and reference code as `path:line`. When you finish a change, say plainly what you did',
    'and what you verified. Never claim you ran something you did not run.',
  ].join('\n');
}

/** The conversation so far, in OpenAI shape. Tool blocks are already summarised
 *  into the assistant text the user saw, so they are not replayed separately. */
function historyFrom(session) {
  const blocks = session.transcript
    .filter((b) => (b.kind === 'user' || b.kind === 'text') && b.text?.trim())
    .slice(-MAX_HISTORY_BLOCKS);
  return blocks.map((b) => ({
    role: b.kind === 'user' ? 'user' : 'assistant',
    content: b.text,
  }));
}

/** What the model is told a tool did. Compact, and honest about truncation. */
function toolResultText(res) {
  if (!res) return 'The tool returned nothing.';
  const parts = [];
  if (res.ok === false) parts.push(`FAILED: ${res.error || res.summary || 'unknown error'}`);
  else if (res.summary) parts.push(res.summary);

  const meta = res.meta || {};
  if (typeof meta.content === 'string' && meta.content) parts.push(meta.content);
  else if (Array.isArray(meta.lines) && meta.lines.length) {
    parts.push(meta.lines.map((l) => (l.n ? `${l.n}\t${l.text}` : l.text)).join('\n'));
  } else if (Array.isArray(meta.files) && meta.files.length) {
    parts.push(meta.files.join('\n'));
  } else if (Array.isArray(meta.entries) && meta.entries.length) {
    parts.push(meta.entries.map((e) => (typeof e === 'string' ? e : e.name)).join('\n'));
  }
  if (typeof meta.stdout === 'string' && meta.stdout) parts.push(meta.stdout);
  if (typeof meta.stderr === 'string' && meta.stderr) parts.push(`stderr:\n${meta.stderr}`);
  if (typeof meta.exitCode === 'number') parts.push(`exit ${meta.exitCode}`);

  const text = parts.filter(Boolean).join('\n').trim() || 'Done.';
  return text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n… truncated, ${text.length - MAX_TOOL_RESULT_CHARS} more characters`
    : text;
}

/** An ApiError turned into something worth reading in a terminal. */
function explain(err) {
  if (!(err instanceof ApiError)) return err.message || String(err);
  if (err.code === 'usage_limit') {
    const when = err.resetsAt ? ` It resets ${relativeTime(err.resetsAt)}.` : '';
    return `${err.message}${when} Run /usage for the details.`;
  }
  if (err.code === 'not_signed_in') return 'You are signed out — run /login to use the models.';
  if (err.code === 'unauthorized') return 'Your Tripplet session expired — run /login to sign in again.';
  return err.hint ? `${err.message} ${err.hint}` : err.message;
}

function relativeTime(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return 'soon';
  if (ms <= 0) return 'now';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return rem ? `in ${hours}h ${rem}m` : `in ${hours}h`;
  return `in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export class RemoteEngine {
  /** `authFile` overrides the credential path, as `login.js` does, for tests. */
  constructor({ session, tools, permissions, theme, authFile } = {}) {
    this.session = session;
    this.tools = tools;
    this.permissions = permissions;
    this.theme = theme;
    this.authFile = authFile;
    this.turn = 0;
    this._abort = null;
  }

  abort() {
    this._abort?.abort();
  }

  /**
   * Run one turn against the real model.
   * @returns {AsyncGenerator<object>} the same events `engine.js` yields.
   */
  async *send(prompt, { signal } = {}) {
    const session = this.session;
    const model = session.model;
    this.turn += 1;

    yield { type: 'start', model: model?.id, effort: session.effort?.id };

    const messages = [
      { role: 'system', content: systemPrompt(session) },
      ...historyFrom(session),
      { role: 'user', content: prompt },
    ];

    const inputTokens = estimateTokens(prompt) + session.contextTokens;
    let outputTokens = 0;
    let toolSeq = 0;
    let thinkingOpen = false;
    const aborted = () => signal?.aborted;

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (aborted()) break;

        // The last round is deliberately tool-less: whatever state the work is
        // in, the turn has to end with the model telling the user about it.
        const lastRound = round === MAX_ROUNDS - 1;
        const calls = [];
        let assistantText = '';

        for await (const ev of streamChat({
          messages,
          tools: lastRound ? undefined : toolSchemas(),
          model: personaFor(model),
          signal,
          file: this.authFile,
        })) {
          if (aborted()) break;

          if (ev.type === 'thinking') {
            if (!ev.delta) continue;
            thinkingOpen = true;
            outputTokens += estimateTokens(ev.delta);
            yield { type: 'thinking-delta', text: ev.delta };
          } else if (ev.type === 'content') {
            if (!ev.delta) continue;
            if (thinkingOpen) { thinkingOpen = false; yield { type: 'thinking-end' }; }
            assistantText += ev.delta;
            outputTokens += estimateTokens(ev.delta);
            yield { type: 'text-delta', text: ev.delta };
          } else if (ev.type === 'tool_call') {
            calls.push(ev);
          } else if (ev.type === 'error') {
            if (thinkingOpen) { thinkingOpen = false; yield { type: 'thinking-end' }; }
            yield { type: 'notice', text: ev.message || 'The model backend failed.', level: 'error' };
          }
        }

        if (thinkingOpen) { thinkingOpen = false; yield { type: 'thinking-end' }; }
        if (aborted()) break;

        // No tool calls means the model answered — the turn is over.
        if (!calls.length) break;

        // Everything the model asked for, in the order it asked, so the
        // assistant/tool message pairing stays valid for the next request.
        messages.push({
          role: 'assistant',
          content: assistantText,
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
          })),
        });

        let stopped = false;
        for (const call of calls) {
          if (aborted()) break;
          const def = getTool(call.name);
          const id = `t${this.turn}_${++toolSeq}`;

          if (!def) {
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: `FAILED: unknown tool "${call.name}".`,
            });
            continue;
          }

          const input = call.args && typeof call.args === 'object' ? call.args : {};
          yield { type: 'tool-start', id, tool: call.name, title: def.title, describe: safeDescribe(def, input) };

          const verdict = this.permissions.explain(call.name, input);
          let decision = verdict.decision;

          if (decision === 'ask') {
            let resolve;
            const answer = new Promise((r) => { resolve = r; });
            yield {
              type: 'tool-permission',
              id,
              tool: call.name,
              request: {
                key: verdict.key,
                title: def.title,
                tool: call.name,
                preview: previewOf(call.name, input),
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
            yield { type: 'tool-end', id, ok: false, denied: true, summary };
            messages.push({ role: 'tool', tool_call_id: call.id, content: `DENIED: ${summary}.` });
            // A refused mutation invalidates whatever the model planned next,
            // so hand the turn back rather than letting it improvise around it.
            if (def.mutating) {
              yield {
                type: 'text-delta',
                text: `\nStopped: \`${def.title}\` was not permitted. Tell me what to do instead, or rerun with \`--permission-mode acceptEdits\`.\n`,
              };
              stopped = true;
              break;
            }
            continue;
          }

          const res = await runTool(call.name, input, {
            cwd: session.cwd, session, theme: this.theme, signal,
          });

          yield {
            type: 'tool-end',
            id,
            ok: !!res.ok,
            summary: res.summary || res.error || '',
            detail: res.detail ?? null,
            meta: res.meta ?? null,
          };
          messages.push({ role: 'tool', tool_call_id: call.id, content: toolResultText(res) });
        }

        if (stopped) break;
      }

      yield { type: 'usage', input: inputTokens, output: Math.max(1, outputTokens), total: inputTokens + outputTokens };
      yield { type: 'done', reason: aborted() ? 'aborted' : 'end' };
    } catch (err) {
      if (aborted()) { yield { type: 'done', reason: 'aborted' }; return; }
      const message = explain(err);
      yield { type: 'notice', text: message, level: err instanceof ApiError && err.code === 'usage_limit' ? 'warn' : 'error' };
      yield { type: 'done', reason: 'error', error: message };
    }
  }
}

export default RemoteEngine;
