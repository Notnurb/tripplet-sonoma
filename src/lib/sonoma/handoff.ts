// Hands a message typed into the landing-page composer to the chat page.
// sessionStorage (not a query param) so the message never lands in the URL,
// history, or server logs — and it survives exactly one navigation: the chat
// shell consumes and clears it on mount.

export interface ChatHandoff {
    text: string;
    model?: string;
    browse?: boolean;
    reason?: boolean;
    code?: boolean;
}

const KEY = 'tripplet:chat-handoff';

export function setChatHandoff(handoff: ChatHandoff): void {
    try {
        sessionStorage.setItem(KEY, JSON.stringify(handoff));
    } catch {
        // Storage unavailable (private mode, quota) — the redirect still
        // works, the visitor just retypes on /chat.
    }
}

export function takeChatHandoff(): ChatHandoff | null {
    try {
        const raw = sessionStorage.getItem(KEY);
        if (!raw) return null;
        sessionStorage.removeItem(KEY);
        const parsed: unknown = JSON.parse(raw);
        if (
            typeof parsed !== 'object' || parsed === null ||
            typeof (parsed as ChatHandoff).text !== 'string' ||
            !(parsed as ChatHandoff).text.trim()
        ) {
            return null;
        }
        return parsed as ChatHandoff;
    } catch {
        return null;
    }
}
