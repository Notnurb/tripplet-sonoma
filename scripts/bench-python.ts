// One-shot latency benchmark for the real-Python warm pool.
//
//   npx tsx scripts/bench-python.ts
//
// Request 1 always pays the Pyodide cold-load (the pool fills lazily after the
// first acquire); request 2+ should hit a pre-warmed worker. The delta is the
// number documented in review.md / CHANGELOG — re-run this script to refresh it.

import { runPython } from '../src/lib/python/run';

async function timed(label: string, code: string): Promise<number> {
    const t0 = performance.now();
    const res = await runPython(code);
    const ms = performance.now() - t0;
    console.log(`${label}: ${ms.toFixed(0)}ms (exit ${res.exitCode}, output ${JSON.stringify(res.output.trim())})`);
    return ms;
}

async function main() {
    const cold = await timed('request 1 (cold: pool empty, inline spawn)', 'print(1+1)');
    // Give the background refill a beat to finish loading Pyodide.
    await new Promise((r) => setTimeout(r, 500));
    // Back-to-back burst: two requests with no gap. With the default pool of 2
    // and ready-worker preference, both should hit loaded workers.
    const [burstA, burstB] = await Promise.all([
        timed('burst request A (warm pool)             ', 'print(2+2)'),
        timed('burst request B (warm pool, no gap)     ', 'print(3+3)'),
    ]);

    const warm = Math.min(burstA, burstB);
    console.log(`\ncold ${cold.toFixed(0)}ms → warm ${warm.toFixed(0)}ms ` +
        `(${(cold / warm).toFixed(1)}x); burst worst-case ${Math.max(burstA, burstB).toFixed(0)}ms`);
    process.exit(0);
}

main();
