/**
 * Types for the agentic planning & execution framework.
 */

export type PlanStepStatus = 'pending' | 'running' | 'complete' | 'failed' | 'skipped' | 'adapted';

export interface PlanStep {
    id: string;
    label: string;
    status: PlanStepStatus;
    detail?: string;       // Extra info (file names, line counts, error messages)
    substeps?: PlanStep[];  // Nested steps for complex phases
}

export interface PlanPhase {
    id: string;
    title: string;
    steps: PlanStep[];
    requiresAnura?: boolean;
}

export interface ExecutionPlan {
    id: string;
    objective: string;
    phases: PlanPhase[];
    estimatedTime?: string; // e.g. "8-12 minutes"
    createdAt: Date;
}

/**
 * Represents a single cursor/action annotation from Anura interaction.
 */
export interface AnuraAction {
    type: 'click' | 'type' | 'press' | 'navigate' | 'wait' | 'info';
    description: string;
    timestamp: Date;
}
