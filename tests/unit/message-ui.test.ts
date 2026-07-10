// @vitest-environment jsdom
//
// Component tests for the chat message + activity-card UI. Written with
// createElement (no JSX) so they run under Vitest's default transform.
import { describe, it, expect, afterEach } from 'vitest';
import { createElement as h } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SonomaUserMessage, SonomaAssistantMessage, type SonomaActivity } from '@/components/Sonoma/Message';

// RTL's auto-cleanup hooks into globals, which this config doesn't enable.
afterEach(cleanup);

describe('SonomaUserMessage', () => {
    it('renders the user text', () => {
        render(h(SonomaUserMessage, { content: 'hello tripplet' }));
        expect(screen.getByText('hello tripplet')).toBeTruthy();
    });
});

describe('SonomaAssistantMessage activity cards', () => {
    const pythonActivity: SonomaActivity = {
        id: 'a1',
        tool: 'run_python',
        args: { code: 'print(21*2)' },
        status: 'done',
        result: { output: '42\n', exitCode: 0 },
        elapsedMs: 1234,
    };

    it('labels tools and shows real elapsed time on done cards', () => {
        render(h(SonomaAssistantMessage, { content: 'The answer is 42.', activity: [pythonActivity] }));
        expect(screen.getByText('Running Python')).toBeTruthy();
        expect(screen.getByText('done · 1.2s')).toBeTruthy();
    });

    it('expands a card to reveal the code and its real output', () => {
        render(h(SonomaAssistantMessage, { content: 'body', activity: [pythonActivity] }));
        fireEvent.click(screen.getByText('Running Python'));
        expect(screen.getByText('print(21*2)')).toBeTruthy();
        expect(screen.getByText(/42/)).toBeTruthy();
    });

    it('shows a running state without a duration chip', () => {
        render(h(SonomaAssistantMessage, {
            content: '',
            activity: [{ id: 'b1', tool: 'run_bash', args: { command: 'ls' }, status: 'running' } satisfies SonomaActivity],
        }));
        expect(screen.getByText('Running bash')).toBeTruthy();
        expect(screen.queryByText(/done/)).toBeNull();
    });

    it('renders web_search results as safe external links when expanded', () => {
        const search: SonomaActivity = {
            id: 's1',
            tool: 'web_search',
            args: { query: 'next.js' },
            status: 'done',
            result: { results: [{ title: 'Next Docs', url: 'https://nextjs.org', snippet: 'The docs.' }] },
        };
        render(h(SonomaAssistantMessage, { content: '', activity: [search] }));
        fireEvent.click(screen.getByText(/Searching the web/));
        const link = screen.getByText(/Next Docs/).closest('a');
        expect(link?.getAttribute('href')).toBe('https://nextjs.org');
        expect(link?.getAttribute('rel')).toContain('noreferrer');
    });
});
