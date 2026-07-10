import type { ChildProcess } from 'child_process';

type LooptrainGlobal = typeof globalThis & { __looptrain_process__?: ChildProcess | null };

export function getLooptrainProcess(): ChildProcess | null {
    return (globalThis as LooptrainGlobal).__looptrain_process__ ?? null;
}

export function setLooptrainProcess(proc: ChildProcess | null): void {
    (globalThis as LooptrainGlobal).__looptrain_process__ = proc;
}
