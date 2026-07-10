---
name: Design Review — Non-Chat Pages
description: Initial design review of profile, subscribe, checkout, api-dashboard, hivemind, code, about, login, and register pages
type: project
---

Reviewed 2026-04-05. Key findings:

- Login vs Register pages are visually inconsistent — login has a dramatic binary background + dark auth modal; register is a plain centered card with no atmosphere. They need to match.
- checkout/page.tsx contains "ads per week" copy — clearly stale dev placeholder text, not a design system issue but a content bug that affects credibility.
- api-dashboard imports from lucide-react exclusively; all other app pages use HugeiconsIcon from @hugeicons. Mixed icon systems in the same product.
- Register page lacks a password visibility toggle (login has one). Missing parity.
- Register error uses rounded-xl + text-red-500; login error uses rounded-lg + text-red-400. Two different error states, same function.
- Subscribe page uses alert() for the cancel subscription action (line 83) — browser native alert is a design crime on a modern AI platform.
- Profile page has a text-[10px] helper text (line 192) — that's 10px, which is below accessible minimum and inconsistent with the text-xs used elsewhere.
- About page is the strongest page visually — motion animations, consistent spacing, timeline treatment is excellent.
- Hivemind consent modal is well done — forced countdown, clear warning hierarchy.

**Why:** These inconsistencies create a fractured experience that undermines the platform's premium positioning.
**How to apply:** Prioritize auth page visual parity and the checkout copy bug first. Icon system consolidation is a lower-priority but ongoing housekeeping item.
