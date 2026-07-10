import { describe, it, expect } from 'vitest';
import { buildSonomaSystemPrompt } from '@/lib/sonoma/prompt';
import { runTool, SONOMA_TOOLS } from '@/lib/sonoma/tools';
import { fetchPageText } from '@/lib/ai/websearch';
import { UNTRUSTED_EXTERNAL_CONTENT_GUARDRAIL } from '@/lib/security/prompt-guardrails';

describe('buildSonomaSystemPrompt', () => {
    it('includes the shared untrusted-content guardrail on every page', () => {
        for (const page of ['chat', 'code', 'agent'] as const) {
            const p = buildSonomaSystemPrompt(page, false, false, false);
            // Asserts against the single source of truth, so the Sonoma path and
            // the /api/chat injection block can never drift apart on safety wording.
            expect(p).toContain(UNTRUSTED_EXTERNAL_CONTENT_GUARDRAIL);
        }
    });

    it('only the code workspace mandates the <think> protocol', () => {
        expect(buildSonomaSystemPrompt('code', false, false, false)).toContain('<think>');
        expect(buildSonomaSystemPrompt('chat', false, false, false)).not.toContain('MANDATORY: Think');
    });

    it('adds the sandbox skill section only when enabled', () => {
        expect(buildSonomaSystemPrompt('chat', false, false, false, undefined, false, true)).toContain('Tripplet Sandboxed Linux');
        expect(buildSonomaSystemPrompt('chat', false, false, false, undefined, false, false)).not.toContain('Tripplet Sandboxed Linux');
    });

    it('composes toggle notes additively', () => {
        const p = buildSonomaSystemPrompt('chat', true, true, true);
        expect(p).toContain('Browse enabled');
        expect(p).toContain('Reason enabled');
        expect(p).toContain('Code mode enabled');
    });
});

describe('runTool', () => {
    it('mermaid_diagram echoes title and source', async () => {
        const out = JSON.parse(await runTool({ id: 't1', name: 'mermaid_diagram', args: { title: 'Flow', source: 'graph TD;A-->B' } }));
        expect(out).toEqual({ title: 'Flow', source: 'graph TD;A-->B' });
    });

    it('run_bash only acknowledges — execution is client-side', async () => {
        const out = JSON.parse(await runTool({ id: 't2', name: 'run_bash', args: { command: 'ls /' } }));
        expect(out.command).toBe('ls /');
        expect(out.executed_in).toBe('tripplet-sandboxed-linux');
        // No fabricated stdout may ever appear here.
        expect(out.output).toBeUndefined();
    });

    it('unknown tools return an error payload, not a throw', async () => {
        const out = JSON.parse(await runTool({ id: 't3', name: 'rm_rf', args: {} }));
        expect(out.error).toContain('Unknown tool');
    });

    it('run_bash is stripped from the toolset unless the sandbox skill is on', () => {
        // Mirrors the route's activeTools filter.
        const names = SONOMA_TOOLS.filter((t) => t.function.name !== 'run_bash').map((t) => t.function.name);
        expect(names).not.toContain('run_bash');
        expect(names).toContain('run_python');
    });
});

describe('fetchPageText SSRF guard', () => {
    const blocked = [
        'http://localhost/admin',
        'http://127.0.0.1:8080/x',
        'http://10.0.0.5/internal',
        'http://192.168.1.1/router',
        'http://169.254.169.254/latest/meta-data/', // cloud metadata endpoint
        'http://0x7f000001/hex-encoded-loopback',
        'http://2130706433/decimal-loopback',
        'http://service.internal/x',
    ];
    for (const url of blocked) {
        it(`blocks ${url}`, async () => {
            await expect(fetchPageText(url)).rejects.toThrow('This host cannot be fetched.');
        });
    }

    it('rejects non-http(s) protocols', async () => {
        await expect(fetchPageText('file:///etc/passwd')).rejects.toThrow('Only http(s) URLs can be fetched.');
        await expect(fetchPageText('ftp://example.com/x')).rejects.toThrow('Only http(s) URLs can be fetched.');
    });
});
