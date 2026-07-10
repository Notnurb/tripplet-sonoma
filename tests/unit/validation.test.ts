import { describe, it, expect } from 'vitest';
import { parseBody, executeSchema } from '@/lib/validation';

function jsonReq(body: string): Request {
    return new Request('http://localhost/x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
    });
}

describe('parseBody', () => {
    it('returns validated data on a good payload', async () => {
        const { data, error } = await parseBody(jsonReq(JSON.stringify({ code: 'print(1)' })), executeSchema);
        expect(error).toBeNull();
        expect(data).toEqual({ code: 'print(1)' });
    });

    it('400s on invalid JSON without throwing', async () => {
        const { data, error } = await parseBody(jsonReq('{nope'), executeSchema);
        expect(data).toBeNull();
        expect(error?.status).toBe(400);
        expect((await error!.json()).error).toBe('Invalid JSON body');
    });

    it('400s with field-level detail on schema failure', async () => {
        const { error } = await parseBody(jsonReq(JSON.stringify({ code: '' })), executeSchema);
        expect(error?.status).toBe(400);
        expect((await error!.json()).error).toContain('code');
    });
});

describe('passwordSchema policy', () => {
    it('enforces length bounds', async () => {
        const { passwordSchema } = await import('@/lib/validation');
        expect(passwordSchema.safeParse('short').success).toBe(false);
        expect(passwordSchema.safeParse('x'.repeat(129)).success).toBe(false);
        expect(passwordSchema.safeParse('a-genuinely-fine-passphrase').success).toBe(true);
    });

    it('rejects common breached passwords case-insensitively', async () => {
        const { passwordSchema } = await import('@/lib/validation');
        for (const bad of ['password123', 'PASSWORD123', 'P@ssw0rd', 'qwertyuiop']) {
            expect(passwordSchema.safeParse(bad).success, bad).toBe(false);
        }
    });
});

describe('executeSchema bounds', () => {
    it('caps code at 50k chars and stdin at 10k', () => {
        expect(executeSchema.safeParse({ code: 'x'.repeat(50_001) }).success).toBe(false);
        expect(executeSchema.safeParse({ code: 'ok', stdin: 'y'.repeat(10_001) }).success).toBe(false);
        expect(executeSchema.safeParse({ code: 'ok', stdin: 'fine' }).success).toBe(true);
    });
});
