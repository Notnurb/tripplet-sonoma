// Dev-mode switch, same shape as OUTAGE_ACTIVE (src/lib/outage.ts).
//
// While active:
//   - Login is bypassed everywhere: auth() and /api/auth/me fall back to the
//     "Tripplet Dev" account below whenever no real session cookie is present,
//     and middleware stops redirecting private pages to /login. A real login
//     still wins — the dev account only fills the signed-out gap.
//   - The floating dev panel mounts on every page (src/components/dev/
//     DevModePanel.tsx). Press "q" outside any text box to toggle it: full-res
//     screenshots (the panel hides itself first), blog-post authoring that
//     writes into the real blog source files (/api/dev/blog), and small
//     experiment helpers.
//
// Flip DEV_MODE_ACTIVE to false to turn all of it off.
//
// Safety: everything above is additionally hard-gated to the dev server —
// isDevModeActive() is false unless NODE_ENV === 'development', so pushing
// this file with the flag on can never open a login bypass (or a source-
// writing endpoint) on Vercel or any other production build.
export const DEV_MODE_ACTIVE = true;

// The account you are signed in as while the bypass is on. The id is a stable
// primary key: src/lib/auth/dev-user.ts upserts this row so conversations,
// uploads and usage records attach to it exactly like a regular account.
export const DEV_USER = {
    id: 'tripplet-dev',
    email: 'dev@tripplet.local',
    name: 'Tripplet Dev',
} as const;

export function isDevModeActive(): boolean {
    return DEV_MODE_ACTIVE && process.env.NODE_ENV === 'development';
}
