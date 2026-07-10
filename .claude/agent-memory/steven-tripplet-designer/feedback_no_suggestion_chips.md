---
name: No SuggestedPrompts or SuggestionChips — ever
description: Hard rule against suggestion chips, prompt grids, or recommendation chips anywhere near the chat input or empty state
type: feedback
---

Never add SuggestedPrompts, SuggestionChips, prompt grids, or recommendation chips anywhere in the Tripplet UI — not near the chat input, not in empty state, not as a "subtle" option. This is a non-negotiable UI rule.

**Why:** The user explicitly banned these. They are deleted components (SuggestedPrompts.tsx and SuggestionChips.tsx were both removed). Even the changelog entry for v3.1 Sonoma that mentions "suggested prompts on empty state" represents a feature that has since been removed.

**How to apply:** If reviewing any component or feature that touches empty state or the input area, immediately flag any chip/suggestion UI as a design violation. Do not suggest these as polish ideas.
