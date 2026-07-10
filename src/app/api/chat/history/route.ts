import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/neon";
import { auth } from "@/lib/auth/session";
import { parseMessageMetadata } from '@/lib/chat/message-metadata';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const { userId } = await auth();

        if (!userId) {
            return NextResponse.json({ conversations: [] }, { status: 200 });
        }

        let conversations: Array<Record<string, unknown>>;
        try {
            conversations = await query<Record<string, unknown>>(
                `SELECT c.id, c.title, c.model, c."updatedAt", c."createdAt",
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'id', m.id,
                                'role', m.role,
                                'content', m.content,
                                'attachments', m.attachments,
                                'createdAt', m."createdAt"
                            ) ORDER BY m."createdAt"
                        ) FILTER (WHERE m.id IS NOT NULL),
                        '[]'
                    ) AS messages
                 FROM "Conversation" c
                 LEFT JOIN "Message" m ON m."conversationId" = c.id
                 WHERE c."userId" = $1 AND c."deletedAt" IS NULL
                 GROUP BY c.id
                 ORDER BY c."updatedAt" DESC`,
                [userId],
            );
        } catch (error) {
            console.error("Database error:", error);
            return NextResponse.json({ conversations: [] }, { status: 200 });
        }

        const formatted = conversations?.map((c: any) => ({
            ...c,
            messages: Array.isArray(c.messages)
                ? c.messages.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                    .map((m: any) => ({
                        ...m,
                        ...parseMessageMetadata(m.attachments),
                        timestamp: m.createdAt,
                        model: c.model,
                    }))
                : []
        }));

        return NextResponse.json({ conversations: formatted || [] });
    } catch (error: unknown) {
        console.error("History fetch error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
