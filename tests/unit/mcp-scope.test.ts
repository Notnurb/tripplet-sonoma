import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Regression test for a real gap: the OAuth token's `scope` was validated at
 * issuance (authorize route) but never re-checked by the MCP resource server
 * (`/api/mcp`) at the point tools actually run. Latent while only one scope
 * ('mcp') exists, but a real bypass the day a narrower scope (e.g.
 * read-only) is introduced — a token minted with that narrower scope would
 * still be able to call every tool. Also covers the companion authorize-time
 * gap: the client-supplied `scope` string was stored and echoed back
 * verbatim with no validation against a known set.
 */

const scripted: { token: { user_email: string; scope: string } | null } = { token: null };

vi.mock('@/lib/db/neon', () => ({
    query: vi.fn(async () => ({ rows: [] })),
    queryOne: vi.fn(async (sql: string) => {
        if (/FROM oauth_access_tokens/.test(sql)) return scripted.token;
        return null;
    }),
}));

import { POST as mcpPost } from '@/app/api/mcp/route';
import { isValidScope, hasScope, MCP_SCOPE } from '@/lib/mcp/oauth';

function mcpReq(body: unknown, token = 'a-valid-looking-token'): NextRequest {
    return new NextRequest('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    scripted.token = null;
});

describe('hasScope / isValidScope (pure)', () => {
    it('hasScope finds a scope among space-delimited entries', () => {
        expect(hasScope('mcp offline_access', 'mcp')).toBe(true);
        expect(hasScope('offline_access', 'mcp')).toBe(false);
        expect(hasScope('', 'mcp')).toBe(false);
    });

    it('isValidScope rejects unknown scopes and accepts known ones', () => {
        expect(isValidScope('mcp')).toBe(true);
        expect(isValidScope('mcp offline_access')).toBe(true);
        expect(isValidScope('mcp admin:everything')).toBe(false);
        expect(isValidScope('')).toBe(false);
    });
});

describe('POST /api/mcp tools/call scope enforcement', () => {
    it('rejects tools/call when the token scope lacks "mcp"', async () => {
        scripted.token = { user_email: 'user@x.com', scope: 'offline_access' };
        const res = await mcpPost(mcpReq({
            jsonrpc: '2.0', id: 1, method: 'tools/call',
            params: { name: 'web_search', arguments: { query: 'x' } },
        }));
        expect(res.status).toBe(200); // JSON-RPC error, not an HTTP error
        const body = await res.json();
        expect(body.error).toBeDefined();
        expect(body.error.message).toMatch(/insufficient scope/i);
    });

    it('allows tools/call when the token scope includes "mcp"', async () => {
        scripted.token = { user_email: 'user@x.com', scope: MCP_SCOPE };
        const res = await mcpPost(mcpReq({
            jsonrpc: '2.0', id: 1, method: 'tools/call',
            params: { name: 'unknown_tool', arguments: {} },
        }));
        const body = await res.json();
        // Scope check passes; failure here is "unknown tool", proving we got
        // past the scope gate rather than being blocked by it.
        expect(body.error?.message).toMatch(/unknown tool/i);
    });

    it('tools/list does not require the mcp scope (read-only discovery)', async () => {
        scripted.token = { user_email: 'user@x.com', scope: 'offline_access' };
        const res = await mcpPost(mcpReq({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
        const body = await res.json();
        expect(body.result?.tools).toBeDefined();
    });
});
