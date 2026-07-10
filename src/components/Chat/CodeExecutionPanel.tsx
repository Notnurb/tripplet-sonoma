'use client';

import { CodeExecution } from '@/types';
import { cn } from '@/lib/utils';

interface CodeExecutionPanelProps {
    execution: CodeExecution;
    className?: string;
}

function StatusBadge({ status }: { status: CodeExecution['status'] }) {
    const label = status === 'running' ? 'Running' : status === 'completed' ? 'Completed' : status === 'error' ? 'Error' : 'Queued';
    return (
        <span
            className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                status === 'completed' && 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20',
                status === 'running' && 'bg-sky-500/15 text-sky-300 border border-sky-500/20',
                status === 'queued' && 'bg-amber-500/15 text-amber-300 border border-amber-500/20',
                status === 'error' && 'bg-rose-500/15 text-rose-300 border border-rose-500/20',
            )}
        >
            {label}
        </span>
    );
}

function OutputSection({
    label,
    value,
    tone,
}: {
    label: string;
    value?: string;
    tone: 'neutral' | 'error';
}) {
    if (!value) return null;

    return (
        <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
            </div>
            <pre
                className={cn(
                    'overflow-x-auto rounded-xl border px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words font-mono',
                    tone === 'neutral' && 'border-border bg-background/60 text-foreground',
                    tone === 'error' && 'border-rose-500/25 bg-rose-500/10 text-rose-100',
                )}
            >
                {value}
            </pre>
        </div>
    );
}

export default function CodeExecutionPanel({ execution, className }: CodeExecutionPanelProps) {
    const normalizedOutput = execution.output?.trim();
    const normalizedStdout = execution.stdout?.trim();
    const showResult = Boolean(normalizedOutput && normalizedOutput !== normalizedStdout);

    return (
        <div className={cn('border-t border-border bg-card/60 px-4 py-3', className)}>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-xs font-semibold text-foreground/85">
                    Sandbox output
                </div>
                <div className="flex items-center gap-2">
                    {execution.sandboxId && (
                        <span className="hidden text-[10px] font-mono text-muted-foreground md:inline">
                            {execution.sandboxId}
                        </span>
                    )}
                    <StatusBadge status={execution.status} />
                </div>
            </div>

            <div className="space-y-3">
                {!execution.stdout && !execution.stderr && !showResult && !execution.error && execution.status === 'running' && (
                    <div className="text-xs text-muted-foreground">
                        Running inside the sandbox...
                    </div>
                )}
                <OutputSection label="stdout" value={execution.stdout} tone="neutral" />
                <OutputSection label="stderr" value={execution.stderr} tone="error" />
                {showResult && <OutputSection label="result" value={execution.output} tone="neutral" />}
                {!execution.stderr && execution.error && <OutputSection label="error" value={execution.error} tone="error" />}
            </div>
        </div>
    );
}
