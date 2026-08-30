// Which conversations belong to a project.
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import {
    ProjectsTableMissingError,
    getProject,
    linkConversationToProject,
    listProjectConversationIds,
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
        return NextResponse.json({ conversationIds: await listProjectConversationIds(id) });
    } catch (error) {
        return failure(error);
    }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const { id } = await params;

    let body: { conversationId?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';
    if (!conversationId) {
        return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
    }

    try {
        if (!(await getProject(userId, id))) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }
        await linkConversationToProject({ conversationId, projectId: id, userId });
        return NextResponse.json({ ok: true }, { status: 201 });
    } catch (error) {
        // The conversation may not be persisted yet (FK violation) — that's a
        // client-side race, not a server fault.
        if ((error as { code?: string })?.code === '23503') {
            return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
        }
        return failure(error);
    }
}
