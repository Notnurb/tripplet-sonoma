// Projects list + create. Signed-in only; every row is scoped to the caller.
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import {
    ProjectsTableMissingError,
    MAX_PROJECT_DESCRIPTION,
    MAX_PROJECT_NAME,
    createProject,
    listProjects,
} from '@/lib/db/projects';
import { memoryLimiter, LIMITS, rateLimitResponse, getRateLimitToken, MEMORY_RATE_LIMIT_MESSAGE } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';

function failure(error: unknown) {
    if (error instanceof ProjectsTableMissingError) {
        return NextResponse.json(
            { error: error.message, code: 'MISSING_TABLE' },
            { status: 500 },
        );
    }
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
}

export async function GET(request: NextRequest) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    try {
        await memoryLimiter.check(LIMITS.memory, getRateLimitToken(request, userId));
    } catch {
        return rateLimitResponse(MEMORY_RATE_LIMIT_MESSAGE);
    }
    try {
        return NextResponse.json({ projects: await listProjects(userId) });
    } catch (error) {
        return failure(error);
    }
}

export async function POST(request: NextRequest) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    try {
        await memoryLimiter.check(LIMITS.memory, getRateLimitToken(request, userId));
    } catch {
        return rateLimitResponse(MEMORY_RATE_LIMIT_MESSAGE);
    }

    let body: { name?: unknown; description?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'A project name is required' }, { status: 400 });
    if (name.length > MAX_PROJECT_NAME) {
        return NextResponse.json({ error: `Name must be ${MAX_PROJECT_NAME} characters or fewer` }, { status: 400 });
    }
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length > MAX_PROJECT_DESCRIPTION) {
        return NextResponse.json(
            { error: `Description must be ${MAX_PROJECT_DESCRIPTION} characters or fewer` },
            { status: 400 },
        );
    }

    try {
        const project = await createProject({ userId, name, description });
        return NextResponse.json({ project }, { status: 201 });
    } catch (error) {
        return failure(error);
    }
}
