// Single source of truth for reading/writing src/config.md — the user-editable
// app config. Shared by next.config.mjs (env injection at startup), the server
// backend router (src/lib/ai/llm.ts), and the setup TUI (scripts/setup-tui.mjs).
// Plain .mjs with JSDoc so all three can import it (tsconfig has allowJs).
//
// SERVER-ONLY: uses node:fs — never import from client components. Client code
// gets these values via the NEXT_PUBLIC_* env vars injected in next.config.mjs.

import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {Object} ModelEntry
 * @property {string} id           Persona/model id (heading text)
 * @property {string} [label]        Display name for the model picker
 * @property {string} [description]  One-liner under the name
 * @property {string} [endpoint]     OpenAI-compatible /chat/completions URL
 * @property {string} [model]        Upstream model name sent to the endpoint
 * @property {string} [keyEnv]       Env var name holding the API key
 * @property {string} [key]          Literal API key (discouraged — prefer keyEnv)
 * @property {boolean} [showInPicker] Add new ids to the model dropdown
 * @property {boolean} [enabled]     Entry is active (default true)
 */

/**
 * @typedef {Object} AppConfig
 * @property {{name: string, tagline: string, description: string, port: number}} app
 * @property {ModelEntry[]} models
 */

/** @returns {AppConfig} */
export function defaultConfig() {
    return {
        app: {
            name: 'Tripplet',
            tagline: 'AI that works the way you think',
            description:
                'Chat, generate images, and build apps — all in one AI platform. Powered by Taipei, Majuli, and Suzhou models.',
            port: 3000,
        },
        models: [],
    };
}

/** @param {string} [rootDir] @returns {string} */
export function configPath(rootDir) {
    return path.join(rootDir || process.cwd(), 'src', 'config.md');
}

const FIELD_ALIASES = {
    'name': 'name',
    'app name': 'name',
    'tagline': 'tagline',
    'description': 'description',
    'port': 'port',
    'default port': 'port',
    'label': 'label',
    'endpoint': 'endpoint',
    'url': 'endpoint',
    'model': 'model',
    'api key env': 'keyEnv',
    'key env': 'keyEnv',
    'api key': 'key',
    'show in picker': 'showInPicker',
    'in picker': 'showInPicker',
    'enabled': 'enabled',
};

/** @param {string} value @returns {boolean} */
function toBool(value) {
    return /^(yes|true|on|1)$/i.test(value.trim());
}

/**
 * Tolerant parser: `## App` / `## Model backends` sections, `- key: value`
 * bullets, `### id` model entries. Unknown lines are ignored so the file can
 * carry explanatory prose.
 * @param {string} text @returns {AppConfig}
 */
export function parseConfigMd(text) {
    const config = defaultConfig();
    /** @type {'app' | 'models' | null} */
    let section = null;
    /** @type {ModelEntry | null} */
    let entry = null;

    for (const rawLine of String(text).split(/\r?\n/)) {
        const line = rawLine.trim();

        const h2 = line.match(/^##\s+(.+)$/);
        if (h2 && !line.startsWith('###')) {
            const title = h2[1].trim().toLowerCase();
            section = title === 'app' ? 'app' : title.startsWith('model') ? 'models' : null;
            entry = null;
            continue;
        }

        const h3 = line.match(/^###\s+(.+)$/);
        if (h3) {
            if (section === 'models') {
                // Heading may carry a trailing note — the id is the first token.
                const id = h3[1].trim().split(/\s+/)[0];
                entry = { id };
                config.models.push(entry);
            } else {
                entry = null;
            }
            continue;
        }

        const kv = line.match(/^[-*]\s*`?([^:`]+)`?\s*:\s*(.*)$/);
        if (!kv) continue;
        const field = FIELD_ALIASES[kv[1].trim().toLowerCase()];
        const value = kv[2].trim();
        if (!field || value === '') continue;

        if (section === 'app' && !entry) {
            if (field === 'port') {
                const port = Number.parseInt(value, 10);
                if (Number.isInteger(port) && port > 0 && port < 65536) config.app.port = port;
            } else if (field === 'name' || field === 'tagline' || field === 'description') {
                config.app[field] = value;
            }
        } else if (section === 'models' && entry) {
            if (field === 'showInPicker' || field === 'enabled') entry[field] = toBool(value);
            else if (field !== 'port' && field !== 'name' && field !== 'tagline') entry[field] = value;
        }
    }
    return config;
}

/**
 * Regenerate config.md in the canonical format (used by the setup TUI when
 * saving edits). Keeps the explanatory header so a TUI-written file reads the
 * same as the hand-written original.
 * @param {AppConfig} config @returns {string}
 */
export function serializeConfigMd(config) {
    const lines = [
        '# App Config',
        '',
        'Customize the app here — no code changes needed. The dev server reads this',
        'file when it starts, so restart it (`./setup.sh` → Run server, or `npm run dev`)',
        'after editing. You can also edit everything below interactively with the',
        'setup TUI: run `./setup.sh` (Git Bash/WSL on Windows) or `npm run setup`.',
        '',
        '> Note: saving changes from the setup TUI rewrites this file in this exact',
        '> format, so keep extra notes in your own docs rather than inline here.',
        '',
        '## App',
        '',
        `- name: ${config.app.name}`,
        `- tagline: ${config.app.tagline}`,
        `- description: ${config.app.description}`,
        `- port: ${config.app.port}`,
        '',
        '## Model backends',
        '',
        'Each `###` entry defines a model backend. The heading is the model id. Use an',
        'id matching a built-in persona (`astro-5`, `tura-3`, `majuli-3`, `suzhou-3`)',
        'to reroute that persona to your own endpoint, or invent a new id to add a',
        'brand-new model to the app.',
        '',
        'Fields per entry:',
        '',
        '- `label` — display name shown in the model picker',
        '- `description` — one-liner shown under the name',
        '- `endpoint` — OpenAI-compatible `/chat/completions` URL',
        '- `model` — upstream model name sent to that endpoint',
        '- `api key env` — name of the environment variable holding the API key (put the key itself in `.env`)',
        '- `show in picker` — yes/no, adds new ids to the model dropdown (built-in ids are already there)',
        '- `enabled` — yes/no',
    ];
    for (const m of config.models) {
        lines.push('', `### ${m.id}`);
        if (m.label) lines.push(`- label: ${m.label}`);
        if (m.description) lines.push(`- description: ${m.description}`);
        if (m.endpoint) lines.push(`- endpoint: ${m.endpoint}`);
        if (m.model) lines.push(`- model: ${m.model}`);
        if (m.keyEnv) lines.push(`- api key env: ${m.keyEnv}`);
        if (m.key) lines.push(`- api key: ${m.key}`);
        if (m.showInPicker !== undefined) lines.push(`- show in picker: ${m.showInPicker ? 'yes' : 'no'}`);
        lines.push(`- enabled: ${m.enabled === false ? 'no' : 'yes'}`);
    }
    return lines.join('\n') + '\n';
}

/** @type {{mtimeMs: number, path: string, config: AppConfig} | null} */
let cache = null;

/**
 * Read src/config.md with an mtime cache; missing/unreadable file degrades to
 * defaults so the app never crashes over its config.
 * @param {string} [rootDir] @returns {AppConfig}
 */
export function loadAppConfig(rootDir) {
    const file = configPath(rootDir);
    try {
        const mtimeMs = fs.statSync(file).mtimeMs;
        if (cache && cache.path === file && cache.mtimeMs === mtimeMs) return cache.config;
        const config = parseConfigMd(fs.readFileSync(file, 'utf8'));
        cache = { mtimeMs, path: file, config };
        return config;
    } catch {
        return defaultConfig();
    }
}

/** @param {AppConfig} config @param {string} [rootDir] */
export function saveAppConfig(config, rootDir) {
    fs.writeFileSync(configPath(rootDir), serializeConfigMd(config), 'utf8');
    cache = null;
}
