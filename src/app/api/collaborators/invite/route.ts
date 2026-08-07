import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import { query, queryOne } from '@/lib/db/neon';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
    const { userId, email: inviterEmail } = await auth();
    if (!userId || !inviterEmail) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    const body = await request.json().catch(() => ({})) as { email?: unknown; conversationId?: unknown };
    const inviteeEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';
    if (!EMAIL.test(inviteeEmail) || inviteeEmail.length > 254) return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
    if (inviteeEmail === inviterEmail.toLowerCase()) return NextResponse.json({ error: 'You cannot invite yourself' }, { status: 400 });
    const conversation = await queryOne<{ id: string }>('SELECT id FROM "Conversation" WHERE id = $1 AND "userId" = $2 AND "deletedAt" IS NULL', [conversationId, userId]);
    if (!conversation) return NextResponse.json({ error: 'Choose one of your build sessions first' }, { status: 404 });
    const recipient = await queryOne<{ id: string }>('SELECT id FROM "User" WHERE lower(email) = $1 LIMIT 1', [inviteeEmail]);
    if (!recipient) return NextResponse.json({ error: 'That email does not belong to a Tripplet user' }, { status: 404 });
    await query('INSERT INTO collaborator_invites (inviter_user_id, inviter_email, invitee_email, conversation_id) VALUES ($1, $2, $3, $4)', [userId, inviterEmail, inviteeEmail, conversationId]);
    return NextResponse.json({ ok: true });
}

export async function GET() {
    const { email } = await auth();
    if (!email) return NextResponse.json({ invites: [] });
    const invites = await query<{ id: string; inviter_email: string; conversation_id: string; created_at: string }>('SELECT id, inviter_email, conversation_id, created_at FROM collaborator_invites WHERE invitee_email = $1 AND status = \'pending\' ORDER BY created_at DESC LIMIT 10', [email.toLowerCase()]);
    return NextResponse.json({ invites });
}

export async function PATCH(request: NextRequest) {
    const { email } = await auth();
    if (!email) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    const body = await request.json().catch(() => ({})) as { id?: unknown; status?: unknown };
    if (typeof body.id !== 'string' || !['accepted', 'declined'].includes(String(body.status))) return NextResponse.json({ error: 'Invalid invite response' }, { status: 400 });
    const invite = await queryOne<{ conversation_id: string; id: string }>('UPDATE collaborator_invites SET status = $1, seen_at = now() WHERE id = $2 AND invitee_email = $3 RETURNING id, conversation_id', [body.status, body.id, email.toLowerCase()]);
    if (invite && body.status === 'accepted') {
        const user = await queryOne<{ id: string }>('SELECT id FROM "User" WHERE lower(email) = $1 LIMIT 1', [email.toLowerCase()]);
        if (user) await query('INSERT INTO conversation_collaborators (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT (conversation_id, user_id) DO NOTHING', [invite.conversation_id, user.id]);
    }
    return NextResponse.json({ ok: true });
}
