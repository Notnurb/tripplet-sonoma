'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { CloudEnvironment, CloudFile } from '@/hooks/useCloudEnvironments';
import { cn } from '@/lib/utils';
import { formatBytes, fileIcon } from '../_lib/cloud-core';

export interface ConsoleLine { id: number; type: 'input' | 'output' | 'error'; text: string; }
let consoleId = 0;

export function ConsoleTab({ env, onAddFile, onRemoveFile, onSyncFiles }: {
    env: CloudEnvironment;
    onAddFile: (f: CloudFile) => void;
    onRemoveFile: (name: string) => void;
    onSyncFiles: (files: CloudFile[]) => void;
}) {
    const [lines, setLines] = useState<ConsoleLine[]>([
        { id: ++consoleId, type: 'output', text: `Tripplet Cloud Shell — ${env.name} — v1.0` },
        { id: ++consoleId, type: 'output', text: `Type 'help' for available commands. Python and pip use a real per-environment virtualenv.` },
        { id: ++consoleId, type: 'output', text: '' },
    ]);
    const [input, setInput] = useState('');
    const [history, setHistory] = useState<string[]>([]);
    const [historyIdx, setHistoryIdx] = useState(-1);
    const [isRunning, setIsRunning] = useState(false);
    const [envVars, setEnvVars] = useState<Record<string, string>>({ HOME: `/home/cloud/${env.slug}`, SHELL: '/bin/bash', USER: 'cloud-user', TERM: 'xterm-256color', PATH: '/usr/local/bin:/usr/bin:/bin' });
    const inputRef = useRef<HTMLInputElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    const push = useCallback((type: ConsoleLine['type'], text: string) => {
        setLines(prev => [...prev, { id: ++consoleId, type, text }]);
    }, []);

    const pushText = useCallback((type: ConsoleLine['type'], text: string) => {
        const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const parts = normalized.split('\n');
        const trimmedParts = parts[parts.length - 1] === '' ? parts.slice(0, -1) : parts;
        if (trimmedParts.length === 0) return;
        setLines(prev => [
            ...prev,
            ...trimmedParts.map((part) => ({ id: ++consoleId, type, text: part })),
        ]);
    }, []);

    const REMOTE_COMMANDS = useMemo(() => new Set(['python', 'python3', 'pip', 'pip3', 'which']), []);

    const COMMANDS = useMemo(() => ({
        help: (_args: string[]) => [
            'Available commands:',
            '',
            '  File system:',
            '    ls [dir]                list files',
            '    cat <file>              print file contents',
            '    head <file>             first 10 lines',
            '    tail <file>             last 10 lines',
            '    touch <file>            create empty file',
            '    rm <file>               delete a file',
            '    cp <src> <dst>          copy a file',
            '    mv <src> <dst>          rename a file',
            '    wc <file>               word/line/byte count',
            '    grep <pat> <file>       search in file',
            '    stat <file>             file info',
            '    find . -name <pattern>  find files by pattern',
            '',
            '  System:',
            '    pwd                     working directory',
            '    whoami                  current user',
            '    hostname                machine name',
            '    uptime                  system uptime',
            '    date                    current date/time',
            '    uname -a                system info',
            '    df                      disk usage',
            '    du <file>               file size',
            '    ps                      process list',
            '    top                     resource usage (snapshot)',
            '    ping <host>             ping a host',
            '    curl <url>              fetch a URL (simulated)',
            '',
            '  Environment:',
            '    env                     print all env vars',
            '    printenv [var]          print env var',
            '    export VAR=value        set env var',
            '    unset VAR               unset env var',
            '',
            '  Python environment (real PyPI-backed):',
            '    python --version        Python version in this environment',
            '    python -m pip install <pkg>',
            '    pip install <pkg>       install from PyPI into .venv',
            '    which <cmd>             locate installed command',
            '    <installed-cli> ...     run console scripts installed by pip',
            '',
            '  Runtime versions:',
            '    node -v                 Node.js version',
            '    deno --version          Deno version',
            '    bun --version           Bun version',
            '',
            '  Other:',
            '    echo <text>             print text',
            '    history                 command history',
            '    man <cmd>               manual page',
            '    clear                   clear console',
        ],

        ls: (_args: string[]) => {
            if (env.files.length === 0) return ['(empty directory)'];
            return env.files.map((file) => `  ${fileIcon(file.name)}  ${file.name}  (${formatBytes(file.size)})`);
        },

        cat: (args: string[]) => {
            if (!args[0]) return ['Usage: cat <filename>'];
            const file = env.files.find((candidate) => candidate.name === args[0]);
            if (!file) return [`cat: ${args[0]}: No such file`];
            if (!file.content.trim()) return ['(empty file)'];
            return file.content.split('\n');
        },

        head: (args: string[]) => {
            if (!args[0]) return ['Usage: head <filename>'];
            const file = env.files.find((candidate) => candidate.name === args[0]);
            if (!file) return [`head: ${args[0]}: No such file`];
            return file.content.split('\n').slice(0, 10);
        },

        tail: (args: string[]) => {
            if (!args[0]) return ['Usage: tail <filename>'];
            const file = env.files.find((candidate) => candidate.name === args[0]);
            if (!file) return [`tail: ${args[0]}: No such file`];
            const fileLines = file.content.split('\n');
            return fileLines.slice(Math.max(0, fileLines.length - 10));
        },

        touch: (args: string[]) => {
            if (!args[0]) return ['Usage: touch <filename>'];
            if (env.files.find((candidate) => candidate.name === args[0])) return [`touch: ${args[0]}: file already exists`];
            onAddFile({ name: args[0], content: '', size: 0, type: 'text/plain', uploadedAt: new Date().toISOString() });
            return [`Created: ${args[0]}`];
        },

        rm: (args: string[]) => {
            if (!args[0]) return ['Usage: rm <filename>'];
            const file = env.files.find((candidate) => candidate.name === args[0]);
            if (!file) return [`rm: ${args[0]}: No such file`];
            onRemoveFile(args[0]);
            return [`Removed: ${args[0]}`];
        },

        cp: (args: string[]) => {
            if (!args[0] || !args[1]) return ['Usage: cp <src> <dst>'];
            const source = env.files.find((candidate) => candidate.name === args[0]);
            if (!source) return [`cp: ${args[0]}: No such file`];
            onAddFile({ ...source, name: args[1], uploadedAt: new Date().toISOString() });
            return [`Copied ${args[0]} → ${args[1]}`];
        },

        mv: (args: string[]) => {
            if (!args[0] || !args[1]) return ['Usage: mv <src> <dst>'];
            const source = env.files.find((candidate) => candidate.name === args[0]);
            if (!source) return [`mv: ${args[0]}: No such file`];
            onAddFile({ ...source, name: args[1], uploadedAt: new Date().toISOString() });
            onRemoveFile(args[0]);
            return [`Renamed ${args[0]} → ${args[1]}`];
        },

        wc: (args: string[]) => {
            if (!args[0]) return ['Usage: wc <filename>'];
            const file = env.files.find((candidate) => candidate.name === args[0]);
            if (!file) return [`wc: ${args[0]}: No such file`];
            const lineCount = file.content.split('\n').length;
            const wordCount = file.content.split(/\s+/).filter(Boolean).length;
            return [`  ${lineCount} lines  ${wordCount} words  ${file.size} bytes  ${args[0]}`];
        },

        grep: (args: string[]) => {
            if (!args[0] || !args[1]) return ['Usage: grep <pattern> <filename>'];
            const file = env.files.find((candidate) => candidate.name === args[1]);
            if (!file) return [`grep: ${args[1]}: No such file`];
            const matches = file.content.split('\n').filter((line) => line.includes(args[0])).map((line) => `  ${line}`);
            return matches.length ? matches : ['(no matches)'];
        },

        stat: (args: string[]) => {
            if (!args[0]) return ['Usage: stat <filename>'];
            const file = env.files.find((candidate) => candidate.name === args[0]);
            if (!file) return [`stat: ${args[0]}: No such file`];
            return [
                `  File: ${file.name}`,
                `  Size: ${file.size} bytes (${formatBytes(file.size)})`,
                `  Type: ${file.type || 'text/plain'}`,
                `  Modified: ${new Date(file.uploadedAt).toLocaleString()}`,
                `  Lines: ${file.content.split('\n').length}`,
            ];
        },

        find: (args: string[]) => {
            const pattern = args.find((arg, index) => args[index - 1] === '-name') ?? args[2];
            if (!pattern) return ['Usage: find . -name <pattern>'];
            const matches = env.files.filter((file) => file.name.includes(pattern.replace(/\*/g, '')));
            return matches.length ? matches.map((file) => `  ./${file.name}`) : ['(no matches)'];
        },

        pwd: (_: string[]) => [`/home/cloud/${env.slug}`],
        whoami: (_: string[]) => ['cloud-user'],
        hostname: (_: string[]) => [`tripplet-cloud-${env.slug}.internal`],
        date: (_: string[]) => [new Date().toString()],
        uptime: (_: string[]) => ['up 0 days, 3 minutes, 42 seconds  load average: 0.12, 0.08, 0.05'],

        uname: (args: string[]) => {
            const full = args.includes('-a');
            return [full ? `Linux tripplet-cloud-${env.slug} 5.15.0-cloud #1 SMP Wed Jan 1 00:00:00 UTC 2025 x86_64 GNU/Linux` : 'Linux'];
        },

        df: (_: string[]) => [
            'Filesystem          Size    Used   Avail  Use%  Mounted on',
            `/dev/cloud      ${env.storageLimitMb}MB   3.2MB  ${env.storageLimitMb - 3}MB   13%   /`,
            'tmpfs              128MB     0MB  128MB    0%   /tmp',
        ],

        du: (args: string[]) => {
            if (!args[0]) return env.files.map((file) => `  ${formatBytes(file.size).padEnd(8)}  ${file.name}`);
            const file = env.files.find((candidate) => candidate.name === args[0]);
            return file ? [`  ${formatBytes(file.size).padEnd(8)}  ${file.name}`] : [`du: ${args[0]}: No such file`];
        },

        ps: (_: string[]) => [
            '  PID  CMD',
            '    1  /init',
            '   12  node server.js',
            '   23  nginx: master process',
            '   31  cron',
            `   ${consoleId % 99 + 40}  bash`,
        ],

        top: (_: string[]) => [
            `top - ${new Date().toLocaleTimeString()} up 3 min, 1 user`,
            'Tasks: 4 total, 1 running, 3 sleeping',
            'CPU: 0.3% us, 0.1% sy, 99.6% id',
            'Memory: 256MB total, 38MB used, 218MB free',
            '',
            '  PID  USER      %CPU  %MEM  CMD',
            '   12  cloud      0.2   1.4  node server.js',
            '   23  cloud      0.1   0.8  nginx',
            '    1  root       0.0   0.1  init',
        ],

        ping: (args: string[]) => {
            if (!args[0]) return ['Usage: ping <host>'];
            return [
                `PING ${args[0]}: 56 data bytes`,
                `64 bytes from ${args[0]}: icmp_seq=0 ttl=56 time=11.4ms`,
                `64 bytes from ${args[0]}: icmp_seq=1 ttl=56 time=12.1ms`,
                `64 bytes from ${args[0]}: icmp_seq=2 ttl=56 time=10.9ms`,
                `--- ${args[0]} ping statistics ---`,
                '3 packets transmitted, 3 received, 0% packet loss',
                'round-trip min/avg/max = 10.9/11.5/12.1ms',
            ];
        },

        curl: (args: string[]) => {
            const url = args.find((arg) => !arg.startsWith('-')) ?? '';
            if (!url) return ['Usage: curl <url>'];
            return [
                '  % Total    % Received  Xferd  Average Speed',
                '100  1234  100  1234    0     0   4567      0 --:--:-- --:--:-- --:--:-- 4600',
                `{"status":"ok","url":"${url}","timestamp":${Date.now()}}`,
            ];
        },

        env: (_: string[]) => Object.entries(envVars).map(([key, value]) => `  ${key}=${value}`),
        printenv: (args: string[]) => args[0] ? (envVars[args[0]] ? [envVars[args[0]]] : [`printenv: ${args[0]}: not set`]) : Object.entries(envVars).map(([key, value]) => `  ${key}=${value}`),

        export: (args: string[]) => {
            const kv = args[0]?.split('=');
            if (!kv || kv.length < 2) return ['Usage: export VAR=value'];
            setEnvVars((prev) => ({ ...prev, [kv[0]]: kv.slice(1).join('=') }));
            return [`export: ${kv[0]}=${kv.slice(1).join('=')}`];
        },

        unset: (args: string[]) => {
            if (!args[0]) return ['Usage: unset VAR'];
            setEnvVars((prev) => {
                const next = { ...prev };
                delete next[args[0]];
                return next;
            });
            return [`unset: ${args[0]}`];
        },

        echo: (args: string[]) => {
            const text = args.join(' ').replace(/\$(\w+)/g, (_match, key) => envVars[key] ?? `$${key}`);
            return [text];
        },

        history: (_: string[]) => history.slice(0, 20).map((entry, index) => `  ${String(index + 1).padStart(3)}  ${entry}`),

        node: (args: string[]) => args[0] === '-v' || args[0] === '--version' ? ['v22.9.0'] : ['node: use "node -v" for version'],
        deno: (args: string[]) => args[0] === '--version' ? ['deno 1.46.0', 'v8 12.9.202.2', 'typescript 5.5.2'] : ['deno: use "deno --version" for version'],
        bun: (args: string[]) => args[0] === '--version' ? ['1.1.29'] : ['bun: use "bun --version" for version'],
        npm: (args: string[]) => args[0] === '-v' || args[0] === '--version' ? ['10.8.2'] : [`npm ${args.join(' ')}: (simulated)`],

        man: (args: string[]) => {
            if (!args[0]) return ['Usage: man <command>'];
            return [
                `${args[0].toUpperCase()}(1)`,
                '',
                'NAME',
                `     ${args[0]} — cloud shell command`,
                '',
                'SYNOPSIS',
                `     ${args[0]} [options]`,
                '',
                'DESCRIPTION',
                `     This is a simulated manual page for ${args[0]}.`,
                '',
                'SEE ALSO',
                '     help(1)',
                '',
            ];
        },

        clear: (_: string[]) => {
            setLines([]);
            return [];
        },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [REMOTE_COMMANDS, env.files, env.slug, env.storageLimitMb, envVars, history, onAddFile, onRemoveFile]);

    const runRemote = useCallback(async (command: string) => {
        setIsRunning(true);

        try {
            const response = await fetch('/api/cloud-env/command', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    slug: env.slug,
                    command,
                    files: env.files,
                    envVars,
                }),
            });

            const payload = await response.json().catch(() => ({})) as {
                error?: string;
                stdout?: string;
                stderr?: string;
                exitCode?: number;
                files?: unknown[];
            };

            if (!response.ok) {
                push('error', payload.error || `Command failed with status ${response.status}.`);
                return;
            }

            if (typeof payload.stdout === 'string') {
                pushText('output', payload.stdout);
            }

            if (typeof payload.stderr === 'string') {
                pushText('error', payload.stderr);
            }

            if (Array.isArray(payload.files)) {
                const syncedFiles = payload.files.flatMap((file) => {
                    if (!file || typeof file !== 'object') return [];
                    const candidate = file as Partial<CloudFile>;
                    if (typeof candidate.name !== 'string' || typeof candidate.content !== 'string') return [];
                    return [{
                        name: candidate.name,
                        content: candidate.content,
                        size: typeof candidate.size === 'number' ? candidate.size : candidate.content.length,
                        type: typeof candidate.type === 'string' ? candidate.type : 'text/plain',
                        uploadedAt: typeof candidate.uploadedAt === 'string' ? candidate.uploadedAt : new Date().toISOString(),
                    }];
                });
                onSyncFiles(syncedFiles);
            }

            if (typeof payload.exitCode === 'number' && payload.exitCode !== 0 && !payload.stderr) {
                push('error', `Process exited with code ${payload.exitCode}.`);
            }
        } catch (error) {
            push('error', error instanceof Error ? error.message : 'Cloud command failed.');
        } finally {
            setIsRunning(false);
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [env.files, env.slug, envVars, onSyncFiles, push, pushText]);

    const run = useCallback(async (cmd: string) => {
        const trimmed = cmd.trim();
        if (!trimmed) return;

        push('input', `$ ${trimmed}`);
        setHistory((prev) => [trimmed, ...prev.slice(0, 49)]);
        setHistoryIdx(-1);

        const [name, ...args] = trimmed.split(/\s+/);
        const fn = (COMMANDS as Record<string, (a: string[]) => string[]>)[name];
        const shouldRunRemotely = REMOTE_COMMANDS.has(name) || !fn;

        if (shouldRunRemotely) {
            await runRemote(trimmed);
            return;
        }

        const result = fn(args);
        result.forEach((line) => push('output', line));
    }, [COMMANDS, REMOTE_COMMANDS, push, runRemote]);

    const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (isRunning) return;
            const command = input;
            setInput('');
            void run(command);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const next = Math.min(historyIdx + 1, history.length - 1);
            setHistoryIdx(next);
            setInput(history[next] ?? '');
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = Math.max(historyIdx - 1, -1);
            setHistoryIdx(next);
            setInput(next === -1 ? '' : history[next] ?? '');
        } else if (e.key === 'l' && e.ctrlKey) {
            e.preventDefault();
            setLines([]);
        }
    };

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [isRunning, lines]);

    return (
        <div className="rounded-xl border border-border overflow-hidden flex flex-col bg-[#0d0d0d] dark:bg-[#0a0a0a] cursor-text" style={{ height: 520 }}
            onClick={() => inputRef.current?.focus()}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 shrink-0">
                <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-400/60" />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400/60" />
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/60" />
                </div>
                <span className="text-[10px] text-white/30 font-mono ml-2">{env.slug} — bash</span>
                <span className="ml-auto text-[9px] font-mono text-emerald-300/60">{isRunning ? 'running…' : 'python + pip are real'}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-[12px] leading-relaxed space-y-0.5">
                {lines.map((line) => (
                    <div key={line.id} className={cn('whitespace-pre-wrap break-words',
                        line.type === 'input' ? 'text-cyan-400' : line.type === 'error' ? 'text-red-400' : 'text-white/70')}>
                        {line.text}
                    </div>
                ))}
                <div className="flex items-center gap-1 text-cyan-400">
                    <span className="shrink-0 select-none">$</span>
                    <input
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKey}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={isRunning}
                        className="flex-1 bg-transparent outline-none caret-cyan-400 text-cyan-400 min-w-0 disabled:cursor-wait disabled:text-cyan-400/55"
                    />
                </div>
                <div ref={bottomRef} />
            </div>
        </div>
    );
}

// ─── Templates Tab ────────────────────────────────────────────────────────────

