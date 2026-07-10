'use client';

// Tripplet Sandboxed Linux — a real x86 Linux VM running entirely in the
// browser via v86 (https://github.com/copy/v86), booting a small buildroot
// busybox image to a serial shell. Everything runs client-side in WebAssembly;
// there is no host access and no network inside the guest.
//
// This module owns a single shared VM instance so the full-screen terminal and
// the assistant's `run_bash` skill both drive the same machine. The v86 runtime
// (libv86.js + v86.wasm) and the guest image are served statically from
// /public/v86.

export type VmStatus = 'idle' | 'booting' | 'ready' | 'error';

interface V86Instance {
    add_listener: (event: string, cb: (arg: unknown) => void) => void;
    serial0_send: (data: string) => void;
    destroy?: () => void;
}

interface V86Ctor {
    new (opts: Record<string, unknown>): V86Instance;
}

const ASSET = {
    lib: '/v86/libv86.js',
    wasm: '/v86/v86.wasm',
    bios: '/v86/seabios.bin',
    vgaBios: '/v86/vgabios.bin',
    bzimage: '/v86/buildroot-bzimage68.bin',
};

const PROMPT = '~% ';

// The guest image + WASM runtime are ~12 MB, so they are not fetched until the
// user explicitly downloads them from Settings. This flag records that.
const DL_KEY = 'tripplet_sandbox_linux_downloaded_v1';

export function isVmDownloaded(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return localStorage.getItem(DL_KEY) === '1';
    } catch {
        return false;
    }
}

// Pre-fetch the runtime + guest image into the browser cache and mark the VM as
// downloaded. Called from the Settings toggle. Resolves when everything is local.
export async function downloadVm(): Promise<void> {
    await loadScript();
    await Promise.all(
        [ASSET.wasm, ASSET.bzimage, ASSET.bios, ASSET.vgaBios].map((u) =>
            fetch(u).then((r) => {
                if (!r.ok) throw new Error('Failed to download ' + u);
                return r.arrayBuffer();
            }),
        ),
    );
    try {
        localStorage.setItem(DL_KEY, '1');
    } catch {
        /* ignore */
    }
}

let emulator: V86Instance | null = null;
let status: VmStatus = 'idle';
let scriptPromise: Promise<void> | null = null;
let termBuffer = '';
let sawPrompt = false;

const byteListeners = new Set<(chunk: string) => void>();
const statusListeners = new Set<(s: VmStatus) => void>();
let readyResolvers: Array<() => void> = [];

function setStatus(s: VmStatus) {
    status = s;
    statusListeners.forEach((f) => f(s));
}

export function getVmStatus(): VmStatus {
    return status;
}

export function getTermBuffer(): string {
    return termBuffer;
}

export function onVmStatus(cb: (s: VmStatus) => void): () => void {
    statusListeners.add(cb);
    return () => statusListeners.delete(cb);
}

export function onVmOutput(cb: (chunk: string) => void): () => void {
    byteListeners.add(cb);
    return () => byteListeners.delete(cb);
}

function loadScript(): Promise<void> {
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise<void>((resolve, reject) => {
        if (typeof window === 'undefined') return reject(new Error('no window'));
        if ((window as unknown as { V86?: unknown }).V86) return resolve();
        const el = document.createElement('script');
        el.src = ASSET.lib;
        el.async = true;
        el.onload = () => resolve();
        el.onerror = () => reject(new Error('Failed to load the Linux VM runtime'));
        document.head.appendChild(el);
    });
    return scriptPromise;
}

// Boot (idempotent). Resolves once the VM has been created; use whenReady() to
// wait for the guest shell prompt.
export async function bootVm(): Promise<void> {
    if (emulator) return;
    if (typeof window === 'undefined') return;
    setStatus('booting');
    try {
        await loadScript();
        const V86 = (window as unknown as { V86: V86Ctor }).V86;
        emulator = new V86({
            wasm_path: ASSET.wasm,
            memory_size: 128 * 1024 * 1024,
            vga_memory_size: 2 * 1024 * 1024,
            bios: { url: ASSET.bios },
            vga_bios: { url: ASSET.vgaBios },
            bzimage: { url: ASSET.bzimage, async: false },
            filesystem: {},
            cmdline: 'tsc=reliable mitigations=off random.trust_cpu=on',
            autostart: true,
            disable_keyboard: true,
        });

        emulator.add_listener('serial0-output-byte', (arg) => {
            const byte = arg as number;
            const ch = String.fromCharCode(byte);
            if (ch === '\r') return;
            termBuffer += ch;
            if (termBuffer.length > 240_000) termBuffer = termBuffer.slice(-180_000);
            byteListeners.forEach((f) => f(ch));
            if (!sawPrompt && termBuffer.includes(PROMPT)) {
                sawPrompt = true;
                setStatus('ready');
                readyResolvers.forEach((r) => r());
                readyResolvers = [];
            }
        });
    } catch (e) {
        setStatus('error');
        throw e;
    }
}

export function whenReady(): Promise<void> {
    if (status === 'ready') return Promise.resolve();
    return new Promise<void>((resolve) => {
        readyResolvers.push(resolve);
        void bootVm();
    });
}

// Raw input into the guest tty (used by the interactive terminal).
export function sendInput(data: string): void {
    if (emulator) emulator.serial0_send(data);
}

// ── run_bash: execute a command/script in the guest and capture stdout ───────
// Commands are serialized through a queue so concurrent skill calls (and the
// interactive terminal) don't interleave on the single tty. Markers delimit the
// captured region; shell echo is disabled just for the command so the output is
// clean program output.

let queue: Promise<unknown> = Promise.resolve();
const COMMAND_TIMEOUT_MS = 20_000;

export function runBash(command: string): Promise<string> {
    const exec = () =>
        new Promise<string>((resolve) => {
            const START = '__TL_S_' + Math.random().toString(36).slice(2, 9) + '__';
            const END = '__TL_E_' + Math.random().toString(36).slice(2, 9) + '__';

            let acc = '';
            let started = false;
            let settled = false;

            const finish = (out: string) => {
                if (settled) return;
                settled = true;
                byteListeners.delete(sub);
                clearTimeout(timer);
                resolve(out.replace(/\s+$/, ''));
            };

            const sub = (ch: string) => {
                acc += ch;
                if (!started) {
                    // Match the marker only when it appears alone on its own
                    // line (the printed output), never the echoed command.
                    const i = acc.indexOf('\n' + START + '\n');
                    if (i >= 0) {
                        started = true;
                        acc = acc.slice(i + START.length + 2);
                    }
                    return;
                }
                const e = acc.indexOf('\n' + END);
                if (e >= 0) finish(acc.slice(0, e));
            };

            const timer = setTimeout(() => finish(acc || '(command timed out)'), COMMAND_TIMEOUT_MS);

            byteListeners.add(sub);

            // Blank the prompt and disable echo so the captured region is just
            // the command's real stdout — no shell prompts, no echoed input.
            // (Restored afterwards, outside the captured region.) Blanking PS1
            // keeps multi-line commands clean too.
            sendInput('__TL_PS1="$PS1"; PS1=""; stty -echo 2>/dev/null\n');
            sendInput('printf "\\n' + START + '\\n"\n');
            sendInput(command + '\n');
            sendInput('printf "\\n' + END + '%s\\n" "$?"\n');
            sendInput('stty echo 2>/dev/null; PS1="$__TL_PS1"\n');
        });

    const run = async () => {
        await whenReady();
        return exec();
    };
    queue = queue.then(run, run);
    return queue as Promise<string>;
}

// Full reset (used by "restart VM").
export function destroyVm(): void {
    try {
        emulator?.destroy?.();
    } catch {
        /* ignore */
    }
    emulator = null;
    status = 'idle';
    termBuffer = '';
    sawPrompt = false;
    readyResolvers = [];
    setStatus('idle');
}
