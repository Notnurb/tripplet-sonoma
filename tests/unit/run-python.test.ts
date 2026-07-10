import { describe, it, expect } from 'vitest';
import { runPython } from '@/lib/python/run';

// These run REAL CPython (Pyodide). The first call pays the interpreter load
// (~5-10s), so timeouts are generous.

describe('runPython', () => {
    it('executes real Python and returns real stdout', async () => {
        const r = await runPython('import math\nprint(math.factorial(10))');
        expect(r.output.trim()).toBe('3628800');
        expect(r.exitCode).toBe(0);
    }, 60_000);

    it('returns a real traceback and exit code 1 on error', async () => {
        const r = await runPython('1/0');
        expect(r.output).toContain('ZeroDivisionError');
        expect(r.exitCode).toBe(1);
    }, 60_000);

    it('feeds stdin line by line', async () => {
        const r = await runPython('print(input().upper())', 'hello');
        expect(r.output.trim()).toBe('HELLO');
        expect(r.exitCode).toBe(0);
    }, 60_000);

    it('isolates state between runs (warm pool is still single-use)', async () => {
        // First run defines a global. If the warm-pool ever reused an
        // interpreter across runs, the second run would see `leaked` and print
        // it. Correct behavior: each run gets a fresh interpreter → NameError.
        const first = await runPython('leaked = 1234\nprint("set")');
        expect(first.output).toContain('set');
        const second = await runPython('print(leaked)');
        expect(second.output).toContain('NameError');
        expect(second.exitCode).toBe(1);
    }, 60_000);

    it('runs several sequential executions correctly (pool refill)', async () => {
        for (let i = 0; i < 3; i++) {
            const r = await runPython(`print(${i} * 7)`);
            expect(r.output.trim()).toBe(String(i * 7));
            expect(r.exitCode).toBe(0);
        }
    }, 60_000);

    // Regression test for a real sandbox-escape: Pyodide's `import js` binds
    // to the worker's globalThis, and worker_threads run inside the real Node
    // process — so `process` was a genuine, reachable global from user Python,
    // giving env-var exfiltration and (via process.mainModule.require)
    // full RCE. The worker now deletes process/require/global from its own
    // globalThis before running user code.
    it('blocks the JS host bridge: js.process is unreachable from Python', async () => {
        const r = await runPython(
            "import js\nprint('process' in dir(js) and js.process is not None)"
        );
        // Either 'process' is absent from js entirely, or present-but-None —
        // both mean the real Node process object is unreachable.
        expect(r.output.trim()).not.toContain('True');
    }, 60_000);

    it('blocks reaching require via process.mainModule (RCE vector)', async () => {
        const r = await runPython(
            'import js\n' +
            'try:\n' +
            '    js.process.mainModule.require("child_process")\n' +
            "    print('ESCAPED')\n" +
            'except Exception as e:\n' +
            "    print('BLOCKED:', type(e).__name__)\n"
        );
        expect(r.output).not.toContain('ESCAPED');
        expect(r.output).toContain('BLOCKED');
    }, 60_000);

    it('still allows normal Python after the JS bridge is stripped', async () => {
        const r = await runPython('import json\nprint(json.dumps({"a": 1 + 1}))');
        expect(r.output.trim()).toBe('{"a": 2}');
        expect(r.exitCode).toBe(0);
    }, 60_000);
});
