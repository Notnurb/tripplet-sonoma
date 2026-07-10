// Aggregates the user's recent thumbs-up / thumbs-down ratings into a compact
// behavioural hint that gets injected into the system prompt. Goal: make the
// thumbs buttons feel like they actually shape how the model talks, without
// needing a fine-tune or RLHF pipeline.
//
// Signals derived:
//   - Length preference: avg length of liked vs disliked replies.
//   - Recent skew: more thumbs-up or more thumbs-down lately?
//   - Volume: enough data to be confident?
//
// If there's no data, we return an empty string so nothing is injected.

import prisma from '@/lib/db/prisma';

const MIN_DATA_POINTS = 3; // need at least this many ratings before nudging the model
const LOOKBACK_LIMIT = 50; // most recent N ratings considered

export async function getFeedbackSignals(userId: string): Promise<string> {
    if (!userId) return '';

    let rows: { rating: number; contentLength: number; createdAt: Date }[];
    try {
        rows = await prisma.messageFeedback.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: LOOKBACK_LIMIT,
            select: { rating: true, contentLength: true, createdAt: true },
        });
    } catch {
        return '';
    }

    if (!rows || rows.length < MIN_DATA_POINTS) return '';

    const liked = rows.filter((r) => r.rating > 0);
    const disliked = rows.filter((r) => r.rating < 0);

    const avg = (arr: number[]) =>
        arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;

    const likedAvgLen = avg(liked.map((r) => r.contentLength));
    const dislikedAvgLen = avg(disliked.map((r) => r.contentLength));

    const hints: string[] = [];

    // Length preference: only fire if there's a clear gap AND we have rated
    // both kinds. Threshold of 1.4x prevents reading noise as signal.
    if (liked.length >= 2 && disliked.length >= 2) {
        if (likedAvgLen > 0 && dislikedAvgLen > 0) {
            const ratio = likedAvgLen / dislikedAvgLen;
            if (ratio >= 1.4) {
                hints.push('user has historically preferred longer, more detailed responses — lean toward depth');
            } else if (ratio <= 1 / 1.4) {
                hints.push('user has historically preferred shorter, more concise responses — keep it tight');
            }
        }
    }

    // Overall satisfaction skew
    const total = liked.length + disliked.length;
    if (total >= MIN_DATA_POINTS) {
        const dislikeRate = disliked.length / total;
        if (dislikeRate >= 0.5) {
            hints.push('user has rated several recent responses negatively — be extra careful, double-check accuracy, and ask one clarifying question if anything is ambiguous before answering');
        } else if (dislikeRate <= 0.1 && liked.length >= 5) {
            hints.push('user generally rates your responses positively — keep doing what you have been doing');
        }
    }

    if (hints.length === 0) return '';

    return [
        '## Feedback Signals (derived from this user\'s recent ratings)',
        ...hints.map((h) => `- ${h}`),
        'These are soft preferences. Honor explicit instructions in this conversation when they conflict.',
    ].join('\n');
}
