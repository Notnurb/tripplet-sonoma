---
name: Epsilon Coder Surface Architecture
description: Layout, components, and design state of the code/Epsilon feature area as of the initial audit
type: project
---

## Two Parallel Implementations

There are currently TWO separate coder implementations that need to be reconciled:

1. **`src/app/(app)/code/page.tsx`** — The active, polished production page. Uses `useCodeSession` hook, real Tripplet API calls, streaming HTML output into an iframe. Has LandingView (empty state) and SplitView (40% chat / 60% iframe preview). Uses the Tripplet design system tokens correctly.

2. **`src/components/coder/CoderWorkspace.tsx`** — An older/secondary workspace component. Uses `useCodeGeneration` hook (which is MOCKED — template-based, no real API). Uses hardcoded `bg-neutral-950` / `bg-neutral-900` instead of design system tokens. Not currently wired up to any live route.

## PlanDisplay Component
- Located at `src/components/Chat/PlanDisplay.tsx`
- Types defined in `src/types/plan.ts` (`ExecutionPlan`, `PlanPhase`, `PlanStep`, `PlanStepStatus`)
- Uses emoji icons for status (⏳🔄✅❌⏭️⚠️) — candidate for replacement with lucide/hugeicons
- Collapsible phases with framer-motion height animation
- Substep nesting via recursive `StepRow`
- Currently only used in chat, not yet wired into the coder surface

## Current SplitView Layout (code/page.tsx)
- Left panel: 40% width, chat + InputBox
- Right panel: 60% flex-1, iframe preview
- Generation overlay: backdrop-blur-sm absolute overlay on preview during generation
- Milestone toasts at 3/5/10 builds via sonner

## LandingView Layout (code/page.tsx)
- Full-height centered column, `max-w-2xl`, `pb-16`
- FallingPattern background with radial-gradient mask
- Rotating heading (4s interval, framer-motion y-fade)
- InputBox at center, followed by pill-shaped example prompt chips below
- Example prompt chips: `rounded-full border border-border/60 bg-card/40 px-3 py-1.5 text-xs`
- The area directly above/below the InputBox is chip-free territory per UI rules

## Cloud Environments feature
- Planned addition: "Create Cloud Environment" button at top-center of LandingView
- Multi-step wizard modal: storage picker → configure → creating → done
- Sidebar entries with red/green status dots
- Per-environment workspace at /c/[slug]

**Why:** Audit for the agent-plan integration task.
**How to apply:** New Python execution, database, and file download features should be integrated into the production code/page.tsx path, not CoderWorkspace. The right panel (60%) is the target for plan/output panel rotation. Cloud Environments button should sit above the rotating heading in LandingView, not below or adjacent to the InputBox.
