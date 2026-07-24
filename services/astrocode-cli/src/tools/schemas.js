/**
 * schemas.js — the tools as the model sees them.
 *
 * `index.js` defines what each tool *does*; this file describes it in the
 * OpenAI function-calling shape so a real model can choose one. The two must
 * agree: every property here is a field the matching `run(input, ctx)` actually
 * reads, with the same name and the same meaning. When you add a parameter to a
 * tool, add it here or the model will never pass it.
 *
 * Descriptions are written for the model, not for a human reading the code —
 * they say when to reach for the tool and what the sharp edges are, because
 * that is what stops a model from calling `bash cat` instead of `read`.
 */

import { TOOLS } from './index.js';

const str = (description) => ({ type: 'string', description });
const int = (description) => ({ type: 'integer', description });

/** @type {Array<{type:'function', function:{name:string, description:string, parameters:object}}>} */
export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'read',
      description:
        'Read a UTF-8 text file from the working directory. Prefer this over `bash cat` — ' +
        'it returns numbered lines and refuses binaries and files over 10MB. ' +
        'Read a file before editing it.',
      parameters: {
        type: 'object',
        properties: {
          path: str('File path, relative to the working directory or absolute inside it.'),
          offset: int('1-based line to start at. Omit to start at the beginning.'),
          limit: int('How many lines to return. Omit for the default cap.'),
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write',
      description:
        'Create a file, or replace one entirely. For a file that already exists, prefer `edit` — ' +
        'a whole-file rewrite loses anything you did not reproduce exactly.',
      parameters: {
        type: 'object',
        properties: {
          path: str('File path to write.'),
          content: str('The complete new contents of the file.'),
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit',
      description:
        'Replace one exact string in a file. `old_string` must appear exactly once unless ' +
        'replace_all is true, so include enough surrounding context to be unambiguous. ' +
        'Read the file first — the match is literal, including whitespace.',
      parameters: {
        type: 'object',
        properties: {
          path: str('File to edit.'),
          old_string: str('Exact text to replace, including indentation.'),
          new_string: str('Replacement text.'),
          replace_all: {
            type: 'boolean',
            description: 'Replace every occurrence instead of requiring a unique match.',
          },
        },
        required: ['path', 'old_string', 'new_string'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'multiedit',
      description:
        'Several exact-string replacements in one file, applied in order and atomically — ' +
        'if any edit fails the file is left untouched. Use when one file needs multiple changes.',
      parameters: {
        type: 'object',
        properties: {
          path: str('File to edit.'),
          edits: {
            type: 'array',
            description: 'Edits to apply in order.',
            items: {
              type: 'object',
              properties: {
                old_string: str('Exact text to replace.'),
                new_string: str('Replacement text.'),
                replace_all: { type: 'boolean', description: 'Replace every occurrence.' },
              },
              required: ['old_string', 'new_string'],
              additionalProperties: false,
            },
          },
        },
        required: ['path', 'edits'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description:
        'Run a shell command in the working directory and return its output. Use it for builds, ' +
        'tests, git and anything without a dedicated tool — but not for reading or searching ' +
        'files, where `read`, `glob` and `grep` are faster and safer. The user may be asked to ' +
        'approve the command before it runs.',
      parameters: {
        type: 'object',
        properties: {
          command: str('The command line to execute.'),
          cwd: str('Directory to run in, relative to the working directory. Defaults to it.'),
          timeout: int('Milliseconds before the command is killed (1000–600000, default 120000).'),
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ls',
      description: 'List one directory. Use `glob` when you want to find files by name across a tree.',
      parameters: {
        type: 'object',
        properties: {
          path: str('Directory to list. Defaults to the working directory.'),
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description:
        'Find files by name pattern (e.g. "src/**/*.js"), newest first. This is how you locate ' +
        'files when you know roughly what they are called.',
      parameters: {
        type: 'object',
        properties: {
          pattern: str('Glob pattern, matched against paths and basenames. Supports ** and *.'),
          path: str('Directory to search under. Defaults to the working directory.'),
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description:
        'Search file contents by regular expression and return matching lines with their paths. ' +
        'This is how you find code when you know what it says but not where it lives.',
      parameters: {
        type: 'object',
        properties: {
          pattern: str('JavaScript regular expression source.'),
          path: str('Directory or file to search. Defaults to the working directory.'),
          glob: str('Only search files matching this name pattern, e.g. "*.ts".'),
          ignoreCase: { type: 'boolean', description: 'Case-insensitive matching.' },
          maxResults: int('Stop after this many matches.'),
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'todo',
      description:
        'Record the task list for the current piece of work, replacing any previous list. ' +
        'Use it for multi-step work so the user can see the plan and what is left.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'The full list, in order. Sending a list replaces the old one.',
            items: {
              type: 'object',
              properties: {
                content: str('What the step is.'),
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed'],
                  description: 'Defaults to pending when omitted.',
                },
              },
              required: ['content'],
              additionalProperties: false,
            },
          },
        },
        required: ['todos'],
        additionalProperties: false,
      },
    },
  },
];

/**
 * The schemas for `names`, or all of them. Unknown names are dropped rather
 * than throwing: a caller filtering by permission mode should not have to know
 * which tools exist.
 */
export function toolSchemas(names) {
  if (!names) return TOOL_SCHEMAS;
  const want = new Set([...names].map((n) => String(n).toLowerCase()));
  return TOOL_SCHEMAS.filter((s) => want.has(s.function.name));
}

/** Every schema names a real tool — guards against the two files drifting. */
export const schemaNames = () => TOOL_SCHEMAS.map((s) => s.function.name);
export const unknownSchemas = () => schemaNames().filter((n) => !TOOLS[n]);

export default TOOL_SCHEMAS;
