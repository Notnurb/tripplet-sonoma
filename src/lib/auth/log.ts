/**
 * Structured failure logging for the legacy JWT auth routes.
 *
 * The Better Auth handler (auth-handler.ts) already extracts specific error
 * codes; the legacy routes historically logged a generic string that hid the
 * real cause (e.g. a Prisma `P2021`/`P1001`). This mirrors that extraction so
 * both auth systems produce greppable, code-carrying server logs while the
 * user still gets a generic message.
 *
 * Emits a single-line JSON object so it's queryable in Vercel log drains /
 * whatever aggregator is wired up later.
 */

function prismaCode(error: unknown): string | undefined {
    if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof (error as { code: unknown }).code === 'string'
    ) {
        const code = (error as { code: string }).code;
        // Prisma known-request errors are P####; PG errors are 5-char SQLSTATE.
        if (/^P\d{4}$/.test(code) || /^[0-9A-Z]{5}$/.test(code)) return code;
    }
    return undefined;
}

export function logAuthFailure(route: string, error: unknown): void {
    const entry: Record<string, unknown> = {
        level: 'error',
        scope: 'auth',
        route,
        errorClass: error instanceof Error ? error.name : typeof error,
        code: prismaCode(error) ?? null,
        message: error instanceof Error ? error.message : String(error),
    };
    // console.error keeps it on the error stream where log alerts usually key.
    console.error(`[auth] ${route} failed`, JSON.stringify(entry));
}
