import { format, isToday, isYesterday, differenceInSeconds, differenceInMinutes, differenceInHours, differenceInDays } from 'date-fns';

export function formatMessageDate(date: Date | string) {
    const d = new Date(date);
    if (isToday(d)) {
        return format(d, 'h:mm a');
    }
    if (isYesterday(d)) {
        return 'Yesterday ' + format(d, 'h:mm a');
    }
    return format(d, 'MMM d, h:mm a');
}

export function formatConversationDate(date: Date | string) {
    const d = new Date(date);
    if (isToday(d)) {
        return format(d, 'h:mm a');
    }
    if (isYesterday(d)) {
        return 'Yesterday';
    }
    return format(d, 'MMM d');
}

/**
 * Returns a compact relative time string, e.g. "just now", "5m ago", "3h ago", "2d ago".
 * Anything older than 7 days falls back to an absolute date like "Mar 9".
 */
export function formatRelativeTime(date: Date | string): string {
    const d = new Date(date);
    const now = new Date();

    const seconds = differenceInSeconds(now, d);
    if (seconds < 60) return 'just now';

    const minutes = differenceInMinutes(now, d);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = differenceInHours(now, d);
    if (hours < 24) return `${hours}h ago`;

    const days = differenceInDays(now, d);
    if (days < 7) return `${days}d ago`;

    return format(d, 'MMM d');
}
