/**
 * headless.js — `astrocode -p "..."`.
 *
 * Runs a turn with no TUI and prints the result to stdout, so Astrocode can be
 * piped, scripted or dropped into a CI step. Permission prompts cannot be
 * answered here, so anything that would ask is refused unless the caller opted
 * into a non-interactive mode.
 */

import process from 'node:process';

import { Engine } from '../engine/engine.js';
import { RemoteEngine } from '../engine/remote.js';
import { loadAuth, isSignedIn } from '../auth/store.js';
import { TOOLS } from '../tools/index.js';
import { Permissions } from '../tools/permissions.js';
import { markdownToText } from '../ui/markdown.js';
import { toAnsi, run, stripAnsi } from '../ui/text.js';
import { formatCost, formatTokens } from '../core/tokens.js';

/**
 * @returns {Promise<number>} exit code
 */
export async function runHeadless({ session, config, theme, prompt, json = false, quiet = false, maxTurns = 1 }) {
  const permissions = new Permissions({
    // Without a terminal there is nobody to ask, so `ask` degrades to plan mode
    // (read-only) rather than silently doing something destructive.
    mode: config.permissionMode === 'ask' ? 'plan' : config.permissionMode,
    allow: config.allow,
    deny: config.deny,
    cwd: session.cwd,
  });

  // Same rule as the TUI: a signed-in user gets the real model, everyone else
  // gets the local simulation rather than an error. `config.engine` pins it.
  const pin = config.engine;
  const useRemote = pin === 'remote' || (pin !== 'local' && isSignedIn(loadAuth()));
  const engine = useRemote
    ? new RemoteEngine({ session, tools: TOOLS, permissions, theme })
    : new Engine({ session, tools: TOOLS, permissions, theme, seed: session.seed });
  const out = process.stdout;
  const colour = (line) => toAnsi(line);

  const record = {
    session: session.id,
    model: session.model.id,
    effort: session.effort.id,
    cwd: session.cwd,
    prompt,
    thinking: '',
    text: '',
    tools: [],
    usage: null,
  };

  session.user(prompt);
  const controller = new AbortController();
  const onSig = () => controller.abort();
  process.once('SIGINT', onSig);

  let failed = false;

  try {
    for await (const ev of engine.send(prompt, { signal: controller.signal })) {
      switch (ev.type) {
        case 'thinking-delta':
          record.thinking += ev.text;
          break;
        case 'tool-start':
          if (!json && !quiet) {
            out.write(`${colour([run(`  · ${ev.title} `, { fg: theme.tool }), run(ev.describe, { fg: theme.dim })])}\n`);
          }
          record.tools.push({ tool: ev.tool, describe: ev.describe });
          break;
        case 'tool-permission':
          // Nobody to ask; refuse and let the engine unwind cleanly.
          ev.resolve('deny');
          break;
        case 'tool-end': {
          const last = record.tools[record.tools.length - 1];
          if (last) { last.ok = ev.ok; last.summary = ev.summary; }
          if (!ev.ok) failed = true;
          if (!json && !quiet) {
            const mark = ev.ok ? '✓' : '✕';
            out.write(`${colour([run(`  ${mark} ${ev.summary}`, { fg: ev.ok ? theme.success : theme.error })])}\n`);
          }
          break;
        }
        case 'text-delta':
          record.text += ev.text;
          break;
        case 'usage':
          record.usage = { input: ev.input, output: ev.output, total: ev.total };
          session.addUsage(session.model.id, ev.input, ev.output);
          break;
        case 'notice':
          // "You are out of messages until 6pm" is the whole answer in that
          // case — dropping it would leave a script with empty output and no
          // idea why. Warnings go to stderr so piped stdout stays clean.
          record.notices = [...(record.notices || []), { text: ev.text, level: ev.level || 'info' }];
          if (ev.level === 'error' || ev.level === 'warn') {
            if (!json) process.stderr.write(`${stripAnsi(ev.text)}\n`);
            if (ev.level === 'error') { failed = true; record.error = record.error || ev.text; }
          }
          break;
        case 'done':
          if (ev.reason === 'error') { failed = true; record.error = ev.error; }
          if (ev.reason === 'aborted') { failed = true; record.error = 'aborted'; }
          break;
        default:
          break;
      }
    }
  } finally {
    process.off('SIGINT', onSig);
  }

  void maxTurns;

  if (json) {
    out.write(`${JSON.stringify(record, null, 2)}\n`);
  } else {
    if (!quiet && record.tools.length) out.write('\n');
    out.write(`${markdownToText(record.text, Math.min(100, process.stdout.columns || 80)).join('\n').trimEnd()}\n`);
    if (!quiet && record.usage) {
      out.write(`${colour([run(
        `\n${session.model.name} · ${formatTokens(record.usage.total)} tokens · ${formatCost(session.totalCost)}\n`,
        { fg: theme.faint },
      )])}`);
    }
  }

  if (config.autosave !== false) session.save();
  return failed ? 1 : 0;
}

export { stripAnsi };
