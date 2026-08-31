// Project-scoped memory: the facts Sonoma keeps for THIS project only.
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import {
    ProjectsTableMissingError,
    MAX_PROJECT_MEMORY_CHARS,
    createProjectMemory,
    deleteProjectMemory,
    getProject,
    listProjectMemories,
} from '@/lib/db/projects';

export const runtime = 'nodejs';

function failure(error: unknown) {
    if (error instanceof ProjectsTableMissingError) {
        return NextResponse.json({ error: error.message, code: 'MISSING_TABLE' }, { status: 500 });
    }
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const { id } = await params;
    try {
        if (!(await getProject(userId, id))) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }
        return NextResponse.json({ memories: await listProjectMemories(id) });
    } catch (error) {
        return failure(error);
    }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const { id } = await params;

    let body: { content?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    if (content.length > MAX_PROJECT_MEMORY_CHARS) {
        return NextResponse.json(
            { error: `Memory must be ${MAX_PROJECT_MEMORY_CHARS} characters or fewer` },
            { status: 400 },
        );
    }

    try {
        if (!(await getProject(userId, id))) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }
        const memory = await createProjectMemory({
            projectId: id,
            userId,
            content,
            source: 'explicit',
        });
        return NextResponse.json({ memory }, { status: 201 });
    } catch (error) {
        return failure(error);
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const { id } = await params;
    const memoryId = request.nextUrl.searchParams.get('memoryId');
    if (!memoryId) return NextResponse.json({ error: 'memoryId is required' }, { status: 400 });
    try {
        if (!(await getProject(userId, id))) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }
        const ok = await deleteProjectMemory(id, memoryId);
        if (!ok) return NextResponse.json({ error: 'Memory not found' }, { status: 404 });
        return NextResponse.json({ ok: true });
    } catch (error) {
        return failure(error);
    }
}
