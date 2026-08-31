// Single project — read, rename/redescribe, delete.
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import {
    ProjectsTableMissingError,
    MAX_PROJECT_DESCRIPTION,
    MAX_PROJECT_NAME,
    deleteProject,
    getProject,
    listProjectMemories,
    updateProject,
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
        const project = await getProject(userId, id);
        if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        const memories = await listProjectMemories(id);
        return NextResponse.json({ project, memories });
    } catch (error) {
        return failure(error);
    }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const { id } = await params;

    let body: { name?: unknown; description?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const description = typeof body.description === 'string' ? body.description.trim() : undefined;
    if (name !== undefined && (!name || name.length > MAX_PROJECT_NAME)) {
        return NextResponse.json({ error: 'Invalid project name' }, { status: 400 });
    }
    if (description !== undefined && description.length > MAX_PROJECT_DESCRIPTION) {
        return NextResponse.json({ error: 'Description too long' }, { status: 400 });
    }

    try {
        const project = await updateProject({ userId, id, name, description });
        if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        return NextResponse.json({ project });
    } catch (error) {
        return failure(error);
    }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const { id } = await params;
    try {
        const ok = await deleteProject(userId, id);
        if (!ok) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        return NextResponse.json({ ok: true });
    } catch (error) {
        return failure(error);
    }
}
