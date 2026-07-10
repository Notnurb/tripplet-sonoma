import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import prisma from '@/lib/db/prisma';
import { getModel, MODELS } from '@/lib/ai/models';
import { resolveBackend } from '@/lib/ai/llm';
import { sendChatAction, sendMessage, type TelegramUpdate } from '@/lib/telegram';

const VALID_MODEL_IDS = new Set(MODELS.map(m => m.id));

// History limits. Keep enough turns to feel coherent without bloating context.
const HISTORY_MAX_TURNS = 20;            // last 20 messages = ~10 exchanges
const HISTORY_PRUNE_THRESHOLD = 200;     // start trimming rows when chat exceeds this
const HISTORY_MESSAGE_CHAR_CAP = 8000;   // per-row safety cap

function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
    if (!a || !b) return false;
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
}

export const runtime = 'nodejs';
export const maxDuration = 60;

const SYSTEM_PROMPT =
    "You are Tripplet — a helpful, accurate AI agent that responds via Telegram. " +
    "Format with light markdown (bold, lists, code blocks). Keep responses focused. " +
    "You remember the conversation in this chat — the prior turns below are real exchanges with this user. " +
    "If asked who you are, say you are Tripplet's Agent.";

interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

async function completeWithHistory(modelId: string, messages: LLMMessage[]): Promise<string> {
    // Per-persona backend: Astro 5 → OpenCode Zen (glm-5.2), everything else → Groq.
    const target = resolveBackend(modelId);
    const res = await fetch(target.url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${target.apiKey}`,
        },
        body: JSON.stringify({
            model: target.model,
            messages,
            temperature: 0.7,
            stream: false,
        }),
        signal: AbortSignal.timeout(50_000),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`${target.provider} ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    return content?.trim() || '(empty response)';
}

async function loadHistory(botId: string, telegramChatId: string): Promise<LLMMessage[]> {
    // Fetch last N rows (newest-first) then reverse so the LLM sees oldest-first.
    const rows = await prisma.telegramMessage.findMany({
        where: { botId, telegramChatId },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_MAX_TURNS,
        select: { role: true, content: true },
    });
    return rows
        .reverse()
        .filter((r) => r.role === 'user' || r.role === 'assistant')
        .map((r) => ({
            role: r.role as 'user' | 'assistant',
            content: r.content,
        }));
}

async function saveTurn(
    botId: string,
    telegramChatId: string,
    role: 'user' | 'assistant',
    content: string,
): Promise<void> {
    await prisma.telegramMessage.create({
        data: {
            botId,
            telegramChatId,
            role,
            content: content.slice(0, HISTORY_MESSAGE_CHAR_CAP),
        },
    });
}

async function pruneOldHistory(botId: string, telegramChatId: string): Promise<void> {
    // Soft prune: only acts when the chat row count grows past a threshold,
    // dropping everything older than the most recent HISTORY_MAX_TURNS rows.
    // Cheap because it skips the count check when nothing is likely overflowing.
    const total = await prisma.telegramMessage.count({
        where: { botId, telegramChatId },
    });
    if (total <= HISTORY_PRUNE_THRESHOLD) return;

    const keep = await prisma.telegramMessage.findMany({
        where: { botId, telegramChatId },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_MAX_TURNS,
        select: { id: true },
    });
    const keepIds = keep.map((r) => r.id);
    await prisma.telegramMessage.deleteMany({
        where: {
            botId,
            telegramChatId,
            id: { notIn: keepIds },
        },
    });
}

async function resetHistory(botId: string, telegramChatId: string): Promise<number> {
    const result = await prisma.telegramMessage.deleteMany({
        where: { botId, telegramChatId },
    });
    return result.count;
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ slug: string }> },
) {
    const { slug } = await params;

    let update: TelegramUpdate;
    try {
        update = await req.json();
    } catch {
        return NextResponse.json({ ok: false }, { status: 200 }); // Always 200 to Telegram
    }

    const msg = update.message;
    if (!msg?.text || !msg.chat?.id) {
        return NextResponse.json({ ok: true });
    }

    // Look up the bot by token suffix. Token is unique; slug is the last 12 chars.
    const bot = await prisma.telegramBot.findFirst({
        where: {
            active: true,
            token: { endsWith: slug },
        },
    });
    if (!bot) {
        return NextResponse.json({ ok: true });
    }

    // Verify the Telegram-supplied secret header matches the one we stored at
    // setWebhook time. Without this, anyone who guesses the URL suffix (12 chars
    // of the bot token) could spoof updates.
    if (bot.webhookSecret) {
        const provided = req.headers.get('x-telegram-bot-api-secret-token');
        if (!safeEqual(provided, bot.webhookSecret)) {
            return NextResponse.json({ ok: false }, { status: 401 });
        }
    }

    const modelId = VALID_MODEL_IDS.has(bot.model) ? bot.model : 'majuli-3';
    // Store as string — Telegram chat ids can exceed JS safe-int range for
    // groups/channels (and our schema uses String anyway).
    const telegramChatId = String(msg.chat.id);

    // Quick commands
    if (msg.text === '/start') {
        await sendMessage(
            bot.token,
            msg.chat.id,
            `Hi! I'm your Tripplet agent (model: *${getModel(modelId).name}*). I remember our conversation in this chat. Use /reset to clear it, /help for commands.`,
        );
        return NextResponse.json({ ok: true });
    }
    if (msg.text === '/ping') {
        await sendMessage(bot.token, msg.chat.id, 'pong 🏓');
        return NextResponse.json({ ok: true });
    }
    if (msg.text === '/help') {
        await sendMessage(
            bot.token,
            msg.chat.id,
            [
                '*Commands*',
                '/start — intro',
                '/help — this list',
                '/ping — health check',
                '/reset — wipe conversation memory for this chat',
                '',
                `Model: *${getModel(modelId).name}*`,
                'I remember the last ~10 exchanges in each chat.',
            ].join('\n'),
        );
        return NextResponse.json({ ok: true });
    }
    if (msg.text === '/reset' || msg.text === '/clear') {
        const count = await resetHistory(bot.id, telegramChatId);
        await sendMessage(
            bot.token,
            msg.chat.id,
            count > 0
                ? `Conversation memory cleared (${count} messages removed). Fresh start ✨`
                : 'No conversation history to clear yet.',
        );
        return NextResponse.json({ ok: true });
    }

    // Cap inbound message length so we don't ship absurdly long prompts upstream.
    const userText = msg.text.slice(0, HISTORY_MESSAGE_CHAR_CAP);

    // Show typing indicator while we generate. Doesn't block.
    void sendChatAction(bot.token, msg.chat.id, 'typing');

    // Save the user turn FIRST so it's recorded even if the LLM call fails
    // halfway. This also means the next turn's history will include it.
    try {
        await saveTurn(bot.id, telegramChatId, 'user', userText);
    } catch {
        // Non-fatal: continue without history persistence rather than dropping the user's message.
    }

    // Build full message array: system + last N turns (including the one we just saved).
    const history = await loadHistory(bot.id, telegramChatId).catch(() => [] as LLMMessage[]);
    const llmMessages: LLMMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
    ];
    // Defensive: if for some reason history didn't include the just-saved user
    // message (race / DB hiccup), append it explicitly so the LLM still sees it.
    const lastHistoryMsg = history[history.length - 1];
    if (!lastHistoryMsg || lastHistoryMsg.role !== 'user' || lastHistoryMsg.content !== userText) {
        llmMessages.push({ role: 'user', content: userText });
    }

    try {
        const reply = await completeWithHistory(modelId, llmMessages);
        await sendMessage(bot.token, msg.chat.id, reply);
        // Persist the assistant turn and opportunistically prune ancient rows
        // so this chat's history never grows unbounded.
        await saveTurn(bot.id, telegramChatId, 'assistant', reply).catch(() => {});
        pruneOldHistory(bot.id, telegramChatId).catch(() => {});
    } catch (e) {
        const errText = e instanceof Error ? e.message : 'Unknown error';
        await sendMessage(bot.token, msg.chat.id, `Sorry — agent error: ${errText.slice(0, 200)}`);
    }

    return NextResponse.json({ ok: true });
}
