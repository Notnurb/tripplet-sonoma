import { NextRequest, NextResponse } from 'next/server';
import { promises as fs, constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { auth } from '@/lib/auth/session';
import { workspaceDirFor } from '@/lib/cloud-env/workspace';
import { rateLimitResponse, getRateLimitToken, LIMITS, cloudCommandLimiter } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
const MAX_SYNCED_FILE_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const IGNORED_PATHS = new Set(['.venv', '__pycache__', '.pytest_cache', '.mypy_cache']);

type CloudFilePayload = {
    name: string;
    content: string;
    size?: number;
    type?: string;
    uploadedAt?: string;
};

type CommandRequest = {
    slug?: string;
    command?: string;
    files?: CloudFilePayload[];
    envVars?: Record<string, string>;
};

function normalizeRelativePath(filePath: string): string | null {
    const normalized = path.posix
        .normalize(filePath.replace(/\\/g, '/'))
        .replace(/^\/+/, '');

    if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
        return null;
    }

    for (const ignored of IGNORED_PATHS) {
        if (normalized === ignored || normalized.startsWith(`${ignored}/`)) {
            return null;
        }
    }

    return normalized;
}

function sanitizeSlug(slug: string): string | null {
    return /^[a-z0-9-]{1,64}$/.test(slug) ? slug : null;
}

function parseCommandLine(input: string): string[] {
    const args: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    let escaping = false;

    for (const char of input) {
        if (escaping) {
            current += char;
            escaping = false;
            continue;
        }

        if (char === '\\') {
            escaping = true;
            continue;
        }

        if (quote) {
            if (char === quote) {
                quote = null;
            } else {
                current += char;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }

        if (/\s/.test(char)) {
            if (current) {
                args.push(current);
                current = '';
            }
            continue;
        }

        current += char;
    }

    if (escaping || quote) {
        throw new Error('Unterminated quote or escape sequence.');
    }

    if (current) {
        args.push(current);
    }

    return args;
}

function hasUnsupportedShellOperators(args: string[]): boolean {
    return args.some((arg) => ['|', '||', '&&', ';', '>', '>>', '<'].includes(arg));
}

function toVirtualCommandPath(slug: string, commandName: string): string {
    return path.posix.join('/home/cloud', slug, '.venv', 'bin', commandName);
}

async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function isExecutable(targetPath: string): Promise<boolean> {
    try {
        await fs.access(targetPath, fsConstants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function buildMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    if (['.py', '.sh', '.md', '.txt', '.json', '.ts', '.tsx', '.js', '.jsx', '.html', '.css', '.yml', '.yaml'].includes(ext)) {
        return 'text/plain';
    }
    return 'application/octet-stream';
}

async function walkWorkspaceFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        if (IGNORED_PATHS.has(entry.name)) continue;

        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await walkWorkspaceFiles(rootDir, fullPath));
            continue;
        }

        files.push(path.relative(rootDir, fullPath));
    }

    return files;
}

async function removeEmptyDirectories(rootDir: string, currentDir = rootDir): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (IGNORED_PATHS.has(entry.name)) continue;

        const fullPath = path.join(currentDir, entry.name);
        await removeEmptyDirectories(rootDir, fullPath);

        const remaining = await fs.readdir(fullPath);
        if (remaining.length === 0) {
            await fs.rmdir(fullPath);
        }
    }
}

async function syncWorkspaceFiles(workspaceDir: string, files: CloudFilePayload[]): Promise<void> {
    await fs.mkdir(workspaceDir, { recursive: true });

    const normalizedFiles = files
        .map((file) => {
            const normalizedName = normalizeRelativePath(file.name);
            if (!normalizedName) return null;
            return {
                name: normalizedName,
                content: typeof file.content === 'string' ? file.content : '',
            };
        })
        .filter((file): file is { name: string; content: string } => file !== null);

    const keep = new Set(normalizedFiles.map((file) => file.name));

    const existing = await walkWorkspaceFiles(workspaceDir).catch(() => []);
    for (const relativePath of existing) {
        const normalized = normalizeRelativePath(relativePath);
        if (!normalized || keep.has(normalized)) continue;
        await fs.rm(path.join(workspaceDir, normalized), { force: true });
    }

    for (const file of normalizedFiles) {
        const targetPath = path.join(workspaceDir, file.name);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, file.content, 'utf8');
    }

    await removeEmptyDirectories(workspaceDir);
}

async function collectWorkspaceSnapshot(workspaceDir: string): Promise<CloudFilePayload[]> {
    const files = await walkWorkspaceFiles(workspaceDir).catch(() => []);
    const snapshot: CloudFilePayload[] = [];

    for (const relativePath of files.sort()) {
        const normalized = normalizeRelativePath(relativePath);
        if (!normalized) continue;

        const fullPath = path.join(workspaceDir, normalized);
        const stat = await fs.stat(fullPath);
        if (stat.size > MAX_SYNCED_FILE_BYTES) continue;

        const buffer = await fs.readFile(fullPath);
        if (buffer.includes(0)) continue;

        snapshot.push({
            name: normalized,
            content: buffer.toString('utf8'),
            size: stat.size,
            type: buildMimeType(normalized),
            uploadedAt: stat.mtime.toISOString(),
        });
    }

    return snapshot;
}

const SENSITIVE_ENV_KEYS = new Set([
    'DATABASE_URL', 'DIRECT_URL', 'JWT_SECRET',
    'GROQ_API_KEY', 'OPENCODE_ZEN_API_KEY',
    'BACKEND_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
    'E2B_API_KEY', 'EXA_API_KEY', 'FIRECRAWL_API_KEY',
    'GOOGLE_API_KEY', 'HUGGINGFACE_API_KEY', 'REPLICATE_API_KEY',
    'COHERE_API_KEY', 'MISTRAL_API_KEY', 'DEEPGRAM_API_KEY',
    'ELEVENLABS_API_KEY', 'RESEND_API_KEY', 'STRIPE_API_KEY',
    'SENDGRID_API_KEY', 'TWILIO_API_KEY', 'SLACK_API_KEY',
    'GITHUB_TOKEN', 'NPM_TOKEN', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY',
    'ADMIN_USER_IDS', 'OPENSONOMA_RELAY_URL',
]);

// An exact-name list inevitably misses a credential (REDIS_PASSWORD,
// COMPOSIO_API_KEY, TELEGRAM_BOT_TOKEN, X402_*, BETTER_AUTH_SECRET, …), so the
// blocklist is ALSO applied by suffix. A var that carries one of these markers
// is a credential by definition — the exceptions that must survive (PATH, HOME,
// etc.) are set explicitly by the caller and never read back from process.env.
const SENSITIVE_ENV_SUFFIXES = [
    'KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'PASS', 'CREDENTIAL', 'SIGNING',
];

function isSensitiveEnvVar(key: string): boolean {
    if (SENSITIVE_ENV_KEYS.has(key)) return true;
    const upper = key.toUpperCase();
    return SENSITIVE_ENV_SUFFIXES.some((suffix) => upper.endsWith(suffix));
}

function stripSensitiveEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
    const safe: Record<string, string | undefined> = { NODE_ENV: env.NODE_ENV };
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined && !isSensitiveEnvVar(key)) {
            safe[key] = value;
        }
    }
    return safe;
}

function sanitizeEnvVars(input: Record<string, string> | undefined): Record<string, string> {
    if (!input) return {};

    return Object.fromEntries(
        Object.entries(input).filter(([key, value]) =>
            /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) &&
            typeof value === 'string' &&
            value.length <= 4000,
        ),
    );
}

async function runProcess(params: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string | undefined>;
    timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const { command, args, cwd, env, timeoutMs = COMMAND_TIMEOUT_MS } = params;

    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            env: env as NodeJS.ProcessEnv,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let settled = false;

        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 5000).unref();
        }, timeoutMs);

        child.stdout.on('data', (chunk: Buffer | string) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk: Buffer | string) => {
            stderr += chunk.toString();
        });

        child.on('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
        });

        child.on('close', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({
                stdout,
                stderr,
                exitCode: typeof code === 'number' ? code : 1,
            });
        });
    });
}

async function ensurePythonEnvironment(workspaceDir: string): Promise<{ venvPython: string; venvBin: string }> {
    const venvDir = path.join(workspaceDir, '.venv');
    const venvBin = path.join(venvDir, 'bin');
    const venvPython = path.join(venvBin, 'python');

    if (!await pathExists(venvPython)) {
        const createResult = await runProcess({
            command: 'python3',
            args: ['-m', 'venv', '.venv'],
            cwd: workspaceDir,
            env: process.env,
            timeoutMs: 120_000,
        });

        if (createResult.exitCode !== 0) {
            throw new Error(createResult.stderr || createResult.stdout || 'Failed to create Python virtual environment.');
        }

        const pipBootstrap = await runProcess({
            command: venvPython,
            args: ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'],
            cwd: workspaceDir,
            env: {
                ...stripSensitiveEnv(process.env),
                PIP_DISABLE_PIP_VERSION_CHECK: '1',
            },
            timeoutMs: 240_000,
        });

        if (pipBootstrap.exitCode !== 0) {
            throw new Error(pipBootstrap.stderr || pipBootstrap.stdout || 'Failed to bootstrap pip in the cloud environment.');
        }
    }

    return { venvPython, venvBin };
}

async function generateEntryPointScripts(workspaceDir: string, venvPython: string, venvBin: string): Promise<void> {
    // Query installed packages for entry points using importlib.metadata
    const scriptCode = `
import json
try:
    from importlib.metadata import entry_points
    eps = entry_points()

    # Handle different Python versions (3.10+ vs 3.9-)
    if hasattr(eps, 'select'):
        # Python 3.10+
        scripts = {}
        for ep in eps.select(group='console_scripts'):
            scripts[ep.name] = ep.value
    else:
        # Python 3.9-
        scripts = {}
        if 'console_scripts' in eps:
            for ep in eps['console_scripts']:
                scripts[ep.name] = ep.value

    print(json.dumps(scripts))
except Exception as e:
    print(json.dumps({}))
`;

    try {
        const result = await runProcess({
            command: venvPython,
            args: ['-c', scriptCode],
            cwd: workspaceDir,
            env: process.env,
            timeoutMs: 15_000,
        });

        if (result.exitCode === 0 && result.stdout.trim()) {
            const scripts = JSON.parse(result.stdout.trim());

            for (const [scriptName, moduleSpec] of Object.entries(scripts) as [string, string][]) {
                const scriptPath = path.join(venvBin, scriptName);
                const exists = await pathExists(scriptPath);

                if (!exists && moduleSpec) {
                    // Create a wrapper script that calls the Python entry point
                    const [module, func] = moduleSpec.split(':');
                    const content = `#!/bin/sh\n"${venvPython}" -c "from ${module.trim()} import ${func.trim()}; ${func.trim()}()" "$@"\n`;

                    try {
                        await fs.writeFile(scriptPath, content, 'utf8');
                        await fs.chmod(scriptPath, 0o755);
                    } catch {
                        // Silently skip if we can't create the script
                    }
                }
            }
        }
    } catch {
        // Silently skip if entry point generation fails
    }
}

async function resolveCommand(workspaceDir: string, commandName: string): Promise<string | null> {
    const { venvPython, venvBin } = await ensurePythonEnvironment(workspaceDir);

    if (commandName.includes('/') || commandName.includes('\\')) {
        return null;
    }

    if (commandName === 'python' || commandName === 'python3') {
        return venvPython;
    }

    if (commandName === 'pip' || commandName === 'pip3') {
        const pipPath = path.join(venvBin, 'pip');
        return await isExecutable(pipPath) ? pipPath : null;
    }

    // First, check in the venv's bin directory (where pip install puts scripts)
    const venvCandidate = path.join(venvBin, commandName);
    if (await isExecutable(venvCandidate)) {
        return venvCandidate;
    }

    // Block dangerous system commands from PATH resolution
    const BLOCKED_COMMANDS = new Set([
        'curl', 'wget', 'nc', 'ncat', 'netcat', 'telnet', 'ssh', 'scp', 'sftp',
        'bash', 'sh', 'zsh', 'dash', 'fish', 'ksh',
        'sudo', 'su', 'chroot', 'nsenter',
        'mount', 'umount', 'fdisk', 'mkfs',
        'iptables', 'ip6tables', 'firewall-cmd',
        'tcpdump', 'tshark', 'nmap', 'masscan',
        'kubectl', 'docker', 'podman', 'helm',
        'screen', 'tmux',
        'env', 'printenv',
        'openssl', 'gpg',
        'command',
    ]);
    if (BLOCKED_COMMANDS.has(commandName)) {
        return null;
    }

    // Allowlist for system commands resolved via PATH. Only read-only-ish
    // filesystem/introspection tools belong here. Arbitrary-code and
    // exfiltration-capable tools (interpreters, compilers, package managers,
    // git, shells) are deliberately absent: `python`/`python3`/`pip`/`pip3`
    // resolve to the user's venv above, and everything else must be something
    // the user actually installed into that venv.
    const ALLOWED_SYSTEM_COMMANDS = new Set([
        'ls', 'cat', 'echo', 'pwd', 'mkdir', 'rm', 'cp', 'mv', 'touch',
        'chmod', 'head', 'tail', 'sort', 'grep', 'wc', 'find', 'diff',
        'which', 'ping', 'true', 'false', 'sleep', 'uname', 'date',
        'less', 'more', 'printf', 'tee', 'cut', 'tr', 'uniq', 'comm',
        'basename', 'dirname', 'realpath', 'readlink',
    ]);

    // If not found in venv, try system PATH (only for allowed commands)
    if (!ALLOWED_SYSTEM_COMMANDS.has(commandName)) {
        return null;
    }

    try {
        const result = await runProcess({
            command: 'which',
            args: [commandName],
            cwd: workspaceDir,
            env: {
                ...stripSensitiveEnv(process.env),
                PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
            },
            timeoutMs: 5000,
        });

        if (result.exitCode === 0) {
            const systemPath = result.stdout.trim();
            return await isExecutable(systemPath) ? systemPath : null;
        }
    } catch {
        // which command failed, continue with fallback
    }

    return null;
}

export async function POST(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Sign in required for the real cloud Python environment.' }, { status: 401 });
        }

        const token = getRateLimitToken(req, userId);
        try {
            await cloudCommandLimiter.check(LIMITS.cloudCommand, token);
        } catch {
            return rateLimitResponse();
        }

        const body = (await req.json()) as CommandRequest;
        const slug = typeof body.slug === 'string' ? sanitizeSlug(body.slug) : null;
        const command = typeof body.command === 'string' ? body.command.trim() : '';
        const files = Array.isArray(body.files) ? body.files : [];

        if (!slug) {
            return NextResponse.json({ error: 'A valid environment slug is required.' }, { status: 400 });
        }

        if (!command) {
            return NextResponse.json({ error: 'A command is required.' }, { status: 400 });
        }

        const parsed = parseCommandLine(command);
        if (parsed.length === 0) {
            return NextResponse.json({ error: 'A command is required.' }, { status: 400 });
        }

        const commandName = parsed[0];
        if (hasUnsupportedShellOperators(parsed.slice(1))) {
            return NextResponse.json({ error: 'Pipes, command chaining, and redirection are not supported yet. Run one command at a time.' }, { status: 400 });
        }

        const workspaceDir = workspaceDirFor(userId, slug);
        await syncWorkspaceFiles(workspaceDir, files);

        const { venvBin } = await ensurePythonEnvironment(workspaceDir);
        const runtimeEnv: Record<string, string | undefined> = {
            ...stripSensitiveEnv(process.env),
            ...sanitizeEnvVars(body.envVars),
            HOME: workspaceDir,
            VIRTUAL_ENV: path.join(workspaceDir, '.venv'),
            PATH: `${venvBin}:${process.env.PATH ?? ''}`,
            PIP_DISABLE_PIP_VERSION_CHECK: '1',
            PYTHONUNBUFFERED: '1',
        };

        if ((commandName === 'python' || commandName === 'python3') && parsed.length === 1) {
            return NextResponse.json({
                stdout: '',
                stderr: 'Interactive Python sessions are not supported in this terminal yet. Try `python -c "print(123)"` or `python script.py`.\n',
                exitCode: 1,
                files: await collectWorkspaceSnapshot(workspaceDir),
            });
        }

        if (commandName === 'which') {
            const target = parsed[1];
            if (!target) {
                return NextResponse.json({
                    stdout: '',
                    stderr: 'Usage: which <command>\n',
                    exitCode: 1,
                    files: await collectWorkspaceSnapshot(workspaceDir),
                });
            }

            const resolved = await resolveCommand(workspaceDir, target);
            return NextResponse.json({
                stdout: resolved ? `${toVirtualCommandPath(slug, target)}\n` : '',
                stderr: resolved ? '' : `${target} not found in this environment.\n`,
                exitCode: resolved ? 0 : 1,
                commandPath: resolved ? toVirtualCommandPath(slug, target) : undefined,
                files: await collectWorkspaceSnapshot(workspaceDir),
            });
        }

        // Special command: list installed commands/packages
        if (commandName === 'installed-commands' || commandName === 'pip-list') {
            const { venvBin, venvPython } = await ensurePythonEnvironment(workspaceDir);

            try {
                const listResult = await runProcess({
                    command: venvPython,
                    args: ['-m', 'pip', 'list', '--format=json'],
                    cwd: workspaceDir,
                    env: {
                        ...stripSensitiveEnv(process.env),
                        PIP_DISABLE_PIP_VERSION_CHECK: '1',
                    },
                    timeoutMs: 30_000,
                });

                if (listResult.exitCode === 0) {
                    // Also list executable scripts in venv/bin
                    const binFiles = await fs.readdir(venvBin).catch(() => []);
                    const scripts = await Promise.all(
                        binFiles.map(async (file) => {
                            const fullPath = path.join(venvBin, file);
                            const isExec = await isExecutable(fullPath);
                            return isExec ? file : null;
                        })
                    );

                    const executableScripts = scripts.filter((s): s is string => s !== null);
                    const output = `# Installed Packages\n${listResult.stdout}\n\n# Available Commands\n${executableScripts.join('\n')}\n`;

                    return NextResponse.json({
                        stdout: output,
                        stderr: '',
                        exitCode: 0,
                        files: await collectWorkspaceSnapshot(workspaceDir),
                    });
                }

                return NextResponse.json({
                    stdout: '',
                    stderr: listResult.stderr || 'Failed to list installed packages\n',
                    exitCode: 1,
                    files: await collectWorkspaceSnapshot(workspaceDir),
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to list packages';
                return NextResponse.json({
                    stdout: '',
                    stderr: `${message}\n`,
                    exitCode: 1,
                    files: await collectWorkspaceSnapshot(workspaceDir),
                });
            }
        }

        const executable = await resolveCommand(workspaceDir, commandName);
        if (!executable) {
            return NextResponse.json({
                stdout: '',
                stderr: `${commandName}: command not found in this Python environment.\n`,
                exitCode: 127,
                files: await collectWorkspaceSnapshot(workspaceDir),
            });
        }

        const execution = await runProcess({
            command: executable,
            args: parsed.slice(1),
            cwd: workspaceDir,
            env: runtimeEnv,
            timeoutMs: COMMAND_TIMEOUT_MS,
        });

        // After pip install, generate any missing entry point scripts
        if ((commandName === 'pip' || commandName === 'pip3') &&
            (parsed[1] === 'install' || parsed[1] === 'upgrade') &&
            execution.exitCode === 0) {
            const { venvPython, venvBin } = await ensurePythonEnvironment(workspaceDir);
            await generateEntryPointScripts(workspaceDir, venvPython, venvBin);
        }

        const snapshot = await collectWorkspaceSnapshot(workspaceDir);

        return NextResponse.json({
            stdout: execution.stdout,
            stderr: execution.stderr,
            exitCode: execution.exitCode,
            commandPath: toVirtualCommandPath(slug, commandName),
            files: snapshot,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Cloud command failed.';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
