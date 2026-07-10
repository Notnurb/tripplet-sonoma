// Regression test for the cloud-env cross-tenant isolation fix.
//
// The workspace used to be keyed by the client-chosen, guessable slug ALONE
// (`WORKSPACES_ROOT/{slug}`), so any signed-in user could read/overwrite/delete
// another user's workspace by using their slug, and two users who picked the
// same project name collided on one directory. `workspaceDirFor` now scopes the
// path under a hash of the authenticated userId. These tests pin that property.

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { workspaceDirFor } from '@/lib/cloud-env/workspace';

describe('cloud-env workspace isolation', () => {
    it('gives two different users DIFFERENT directories for the SAME slug', () => {
        const a = workspaceDirFor('user-alice', 'my-app');
        const b = workspaceDirFor('user-bob', 'my-app');
        expect(a).not.toBe(b);
        // Neither user's tree nests inside the other's (no shared parent below root).
        expect(path.relative(a, b).startsWith('..')).toBe(true);
    });

    it('is deterministic for the same (user, slug)', () => {
        expect(workspaceDirFor('user-alice', 'proj')).toBe(workspaceDirFor('user-alice', 'proj'));
    });

    it('does not leak the raw userId into the path (hashed scope)', () => {
        const dir = workspaceDirFor('alice@example.com', 'proj');
        expect(dir).not.toContain('alice@example.com');
        expect(dir).not.toContain('alice');
    });

    it('keeps the slug addressable only within its owner scope', () => {
        // Same slug under two users must not resolve to a shared location.
        const dirs = new Set([
            workspaceDirFor('u1', 'shared-name'),
            workspaceDirFor('u2', 'shared-name'),
            workspaceDirFor('u3', 'shared-name'),
        ]);
        expect(dirs.size).toBe(3);
    });

    it('a traversal-shaped slug cannot escape the per-user root', () => {
        // sanitizeSlug already constrains the charset upstream; this is the
        // defense-in-depth path.relative guard inside workspaceDirFor.
        expect(() => workspaceDirFor('u1', '../../../../etc')).toThrow('Invalid workspace path.');
    });
});
