// Real server-side Python execution via Pyodide (CPython 3.12 compiled to
// WebAssembly). No external service, no API key — the interpreter runs inside
// this process's Node runtime.
//
// Each run happens in a dedicated worker thread so that:
//   1. A hard timeout is enforceable — WASM execution cannot be preempted
//      in-thread, but worker.terminate() kills it cold (infinite loops die).
//   2. A crashed or wedged interpreter never takes the request thread down.
//
// The worker source is an inline CommonJS string (eval: true) rather than a
// separate file so Next.js's bundler/file-tracing doesn't need to know about a
// worker entrypoint; `require('pyodide')` resolves from node_modules at
// runtime (kept out of the webpack graph via serverExternalPackages +
// outputFileTracingIncludes in next.config.mjs).
//
// Sandboxing: Pyodide's WASM interpreter has no host FS access beyond its
// in-memory filesystem and no raw sockets. Python-level `import js` can reach
// the worker's JS globals, so this is isolation appropriate for a code-helper
// tool, not a hostile-multitenant boundary — same trust level the tool had
// before, except the output is now real.

import { Worker } from 'worker_threads';

export interface PythonResult {
    output: string;
    exitCode: number;
    timedOut?: boolean;
}

export const PYTHON_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 20_000;

// Warm-pool size: how many pyodide-loaded-but-idle workers to keep on standby
// so a request never pays the interpreter cold-load (~1.5s measured via
// scripts/bench-python.ts) on its critical path. Each worker is still strictly
// SINGLE-USE (see below) — the pool only pre-pays the load, never reuses an
// interpreter across user code. Default 2: benchmarking showed a pool of 1
// makes the SECOND request of a burst draw a still-loading refill and pay the
// cold-load anyway. Tunable via env (serverless may prefer 1); 0 disables.
const WARM_POOL_SIZE = Math.max(0, Number(process.env.PYTHON_WARM_POOL ?? '2') || 0);

// Two-phase worker: it loads pyodide, signals `ready`, then waits for exactly
// ONE `run` message. Handling a single run per worker preserves the original
// isolation model — no Python globals/imports/monkey-patches leak between
// requests, because a worker that has executed user code is always terminated
// and never reused. Pre-warming only moves the pyodide load ahead of the run.
const WORKER_SOURCE = String.raw`
const { parentPort } = require('worker_threads');

(async () => {
    const { loadPyodide } = require('pyodide');
    const pyodide = await loadPyodide();
    parentPort.postMessage({ type: 'ready' });

    // Exactly one run, then this worker is done (caller terminates it).
    parentPort.once('message', async (msg) => {
        let output = '';
        const write = (line) => { output += line + '\n'; };
        pyodide.setStdout({ batched: write });
        pyodide.setStderr({ batched: write });

        // stdin: feed the provided text line by line; EOF when exhausted.
        const stdinLines = String(msg.stdin ?? '').split('\n');
        let stdinIdx = 0;
        pyodide.setStdin({
            stdin: () => (stdinIdx < stdinLines.length ? stdinLines[stdinIdx++] + '\n' : null),
        });

        let exitCode = 0;
        try {
            // Best-effort: fetch pure-Python/scientific packages (numpy, etc.)
            // referenced by imports. Failure (e.g. no egress) just means the
            // import itself raises an honest ModuleNotFoundError below.
            try {
                await pyodide.loadPackagesFromImports(msg.code);
            } catch { /* stdlib still works */ }

            // SANDBOX ESCAPE GUARD: Pyodide's Python 'import js' binds to this
            // worker's globalThis — and worker_threads run inside the real Node
            // process, so 'process' is a genuine global here (not a browser
            // realm). Unguarded, 'import js; js.process.mainModule.require(...)'
            // reaches env vars, the filesystem, and child_process — full RCE
            // from user-submitted Python. Everything Pyodide itself needed
            // (require, process, fs, network) is already loaded above; strip
            // the bridge from globalThis before user code runs so 'js.process'
            // is simply undefined.
            delete globalThis.process;
            delete globalThis.require;
            delete globalThis.global;

            await pyodide.runPythonAsync(msg.code);
        } catch (err) {
            // PythonError.message carries the real formatted traceback.
            output += String((err && err.message) || err);
            exitCode = 1;
        }
        parentPort.postMessage({ type: 'result', output, exitCode });
    });
})().catch((err) => {
    parentPort.postMessage({ type: 'result', output: 'Python runtime failed to start: ' + String((err && err.message) || err), exitCode: 1 });
});
`;

interface WarmWorker {
    worker: Worker;
    // Resolves once the worker is pyodide-loaded and ready for a run, or with a
    // terminal startup failure (so the caller can return it immediately).
    ready: Promise<{ ok: true } | { ok: false; result: PythonResult }>;
    // Synchronous mirror of `ready` having resolved successfully, so
    // acquireWorker can prefer a loaded worker without awaiting anything.
    isReady: boolean;
}

function spawnWarmWorker(): WarmWorker {
    const worker = new Worker(WORKER_SOURCE, {
        eval: true,
        // Cap interpreter memory so runaway allocations OOM the worker, not the
        // server process.
        resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    // Idle standby workers must not keep the event loop (or a test process)
    // alive; runPython re-refs the one it takes.
    worker.unref();

    const ww: WarmWorker = {
        worker,
        isReady: false,
        ready: new Promise((resolve) => {
            worker.once('message', (msg: { type?: string; output?: string; exitCode?: number }) => {
                if (msg?.type === 'ready') {
                    ww.isReady = true;
                    resolve({ ok: true });
                } else {
                    // Startup failure surfaced as a result before any run was sent.
                    resolve({ ok: false, result: { output: String(msg?.output ?? 'Python runtime failed to start'), exitCode: Number(msg?.exitCode ?? 1) } });
                }
            });
            worker.once('error', (err) => {
                resolve({ ok: false, result: { output: `Python worker error: ${err.message}`, exitCode: 1 } });
            });
        }),
    };
    return ww;
}

// Standby pool of pyodide-loaded workers.
const warmPool: WarmWorker[] = [];

function refillPool(): void {
    while (warmPool.length < WARM_POOL_SIZE) {
        warmPool.push(spawnWarmWorker());
    }
}

/** Take a warm worker if one is on standby, else spawn a fresh one; then top
 * the pool back up in the background so the next call stays warm. Prefers a
 * fully LOADED worker over a still-loading refill — in a burst, the freshest
 * pool entry is usually mid-load, while an older one is ready to run. */
function acquireWorker(): WarmWorker {
    const readyIdx = warmPool.findIndex((w) => w.isReady);
    const w = readyIdx !== -1
        ? warmPool.splice(readyIdx, 1)[0]
        : (warmPool.shift() ?? spawnWarmWorker());
    refillPool();
    return w;
}

export function runPython(code: string, stdin?: string): Promise<PythonResult> {
    return new Promise((resolve) => {
        const { worker, ready } = acquireWorker();
        worker.ref(); // in active use — keep the loop alive until it settles

        let settled = false;
        const finish = (result: PythonResult) => {
            if (settled) return;
            settled = true;
            void worker.terminate();
            resolve({
                ...result,
                output:
                    result.output.length > MAX_OUTPUT_CHARS
                        ? result.output.slice(0, MAX_OUTPUT_CHARS) + '\n… (output truncated)'
                        : result.output,
            });
        };

        const timer = setTimeout(() => {
            finish({
                output: `Execution timed out after ${PYTHON_TIMEOUT_MS / 1000}s and was killed.`,
                exitCode: 124,
                timedOut: true,
            });
        }, PYTHON_TIMEOUT_MS);

        // Terminal handlers for the run phase (attached after the ready result).
        worker.once('error', (err) => {
            clearTimeout(timer);
            finish({ output: `Python worker error: ${err.message}`, exitCode: 1 });
        });
        worker.once('exit', (codeNum) => {
            clearTimeout(timer);
            // Covers OOM kills and exits before a result was posted.
            finish({ output: `Python worker exited unexpectedly (code ${codeNum}).`, exitCode: codeNum || 1 });
        });

        void ready.then((state) => {
            if (settled) return;
            if (!state.ok) {
                clearTimeout(timer);
                finish(state.result);
                return;
            }
            worker.once('message', (msg: { output?: string; exitCode?: number }) => {
                clearTimeout(timer);
                finish({ output: String(msg?.output ?? ''), exitCode: Number(msg?.exitCode ?? 0) });
            });
            worker.postMessage({ code, stdin });
        });
    });
}
