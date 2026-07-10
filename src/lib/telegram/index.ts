// Tiny Telegram Bot API helper — no external SDK needed.
const TG_BASE = 'https://api.telegram.org/bot';

export async function tgRequest<T = unknown>(
    token: string,
    method: string,
    body?: unknown,
): Promise<T> {
    const res = await fetch(`${TG_BASE}${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
        throw new Error(`Telegram ${method} failed: ${data.description ?? res.status}`);
    }
    return data.result as T;
}

export async function getMe(token: string) {
    return tgRequest<{ id: number; username?: string; first_name: string }>(token, 'getMe');
}

export async function setWebhook(token: string, url: string, secret?: string) {
    return tgRequest(token, 'setWebhook', {
        url,
        secret_token: secret,
        allowed_updates: ['message'],
        drop_pending_updates: true,
    });
}

export async function deleteWebhook(token: string) {
    return tgRequest(token, 'deleteWebhook', { drop_pending_updates: true });
}

/**
 * Send a message in chunks of up to 3800 chars. Tries Markdown first; if Telegram
 * rejects it (common with LLM output that has unbalanced * or _), retries the
 * same chunk as plain text rather than dropping the entire response.
 */
export async function sendMessage(token: string, chatId: number | string, text: string) {
    const MAX = 3800;
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += MAX) {
        chunks.push(text.slice(i, i + MAX));
    }
    if (chunks.length === 0) chunks.push('');

    for (const chunk of chunks) {
        try {
            await tgRequest(token, 'sendMessage', {
                chat_id: chatId,
                text: chunk,
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
            });
        } catch {
            // Markdown parse can fail on unbalanced *, _, ` — retry as plain text.
            await tgRequest(token, 'sendMessage', {
                chat_id: chatId,
                text: chunk,
                disable_web_page_preview: true,
            });
        }
    }
}

export async function sendChatAction(token: string, chatId: number | string, action = 'typing') {
    try {
        await tgRequest(token, 'sendChatAction', { chat_id: chatId, action });
    } catch {
        /* ignore — UX only */
    }
}

export interface TelegramUpdate {
    update_id: number;
    message?: {
        message_id: number;
        from?: { id: number; first_name: string; username?: string };
        chat: { id: number; type: string };
        text?: string;
        date: number;
    };
}

export function deriveWebhookUrl(origin: string, token: string): string {
    // Use last 8 chars of token as path segment for routing (no need to log full token).
    const slug = token.slice(-12);
    return `${origin.replace(/\/$/, '')}/api/telegram/webhook/${slug}`;
}
