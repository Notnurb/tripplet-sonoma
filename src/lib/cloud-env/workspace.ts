import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const WORKSPACES_ROOT = path.join(os.tmpdir(), 'tripplet-cloud-envs');

// Per-user workspace isolation. The slug is a client-chosen, guessable name
// (slugify(projectName)), so keying the on-disk workspace by slug ALONE let any
// signed-in user address — read, overwrite, or delete — another user's
// workspace just by using their slug, and made two users who picked the same
// project name collide. Scoping under a hash of the authenticated userId makes
// a slug resolvable only within its owner's namespace. The final join is
// re-validated with path.relative so a hostile slug can never escape the root
// even though sanitizeSlug already constrains the charset upstream.
//
// (Lives in src/lib rather than the route file because Next's App Router only
// permits GET/POST/config exports from a route module — and a pure helper here
// is unit-testable without importing the route's process-spawning code.)
export function workspaceDirFor(userId: string, slug: string): string {
    const userScope = createHash('sha256').update(userId).digest('hex').slice(0, 32);
    const dir = path.join(WORKSPACES_ROOT, userScope, slug);
    const rel = path.relative(path.join(WORKSPACES_ROOT, userScope), dir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error('Invalid workspace path.');
    }
    return dir;
}
