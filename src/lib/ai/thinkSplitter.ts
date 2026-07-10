// ─── <think> tag splitter ─────────────────────────────────────────────────────
//
// The Code workspace asks the model to begin every response with a
// <think>...</think> chain-of-thought block. The active backends don't support
// the OpenAI `reasoning_effort` parameter, so we use this prompt + parser
// approach to get the same "thinking pane" UX without any model-side feature.
//
// The parser is a tiny state machine over the streamed content. It tolerates
// tags split across multiple deltas (e.g. "<thi" then "nk>") by holding back
// the trailing N chars of the buffer when no full tag has been matched yet.
//
// Each feed(chunk) returns the portions that are safe to forward NOW. Call
// flush() once at end of stream to emit any leftover that couldn't be
// classified (incomplete tag, etc).

export type ThinkSplitter = ReturnType<typeof makeThinkSplitter>;

export function makeThinkSplitter() {
    const OPEN = '<think>';
    const CLOSE = '</think>';
    let state: 'pre' | 'in' | 'post' = 'pre';
    let buf = '';

    const feed = (chunk: string): { thinking: string; content: string } => {
        let thinking = '';
        let content = '';
        buf += chunk;
        // Loop until no more state transitions are possible from current buffer.
        while (true) {
            if (state === 'pre') {
                const idx = buf.indexOf(OPEN);
                if (idx === -1) {
                    // Hold back the trailing OPEN.length-1 chars in case a tag
                    // is split mid-chunk across stream deltas.
                    const safe = Math.max(0, buf.length - (OPEN.length - 1));
                    content += buf.slice(0, safe);
                    buf = buf.slice(safe);
                    return { thinking, content };
                }
                content += buf.slice(0, idx);
                buf = buf.slice(idx + OPEN.length);
                state = 'in';
                continue;
            }
            if (state === 'in') {
                const idx = buf.indexOf(CLOSE);
                if (idx === -1) {
                    const safe = Math.max(0, buf.length - (CLOSE.length - 1));
                    thinking += buf.slice(0, safe);
                    buf = buf.slice(safe);
                    return { thinking, content };
                }
                thinking += buf.slice(0, idx);
                buf = buf.slice(idx + CLOSE.length);
                state = 'post';
                continue;
            }
            // 'post' — drain everything as content
            content += buf;
            buf = '';
            return { thinking, content };
        }
    };

    const flush = (): { thinking: string; content: string } => {
        if (!buf) return { thinking: '', content: '' };
        const tail = buf;
        buf = '';
        if (state === 'in') return { thinking: tail, content: '' };
        // 'pre' or 'post': pass it through as content. Better to leak a stray
        // "<thin" than to swallow real output.
        return { thinking: '', content: tail };
    };

    return { feed, flush };
}
