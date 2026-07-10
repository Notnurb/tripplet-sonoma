/**
 * File-attachment convention for assistant messages.
 *
 * The model emits a downloadable file by wrapping its contents in a fenced
 * block whose info string starts with `file:` followed by the filename, e.g.
 *
 *   ```file:report.md
 *   # Report
 *   ...
 *   ```
 *
 * These blocks are pulled out of the markdown and rendered as download cards
 * (see FileCard) instead of plain code blocks. Everything else stays as
 * normal markdown, rendered in the original order.
 */

export interface FileAttachment {
    name: string;
    content: string;
}

export type MessageSegment =
    | { type: 'md'; text: string }
    | { type: 'file'; name: string; content: string };

// Matches a CLOSED file block. We deliberately ignore unclosed trailing blocks
// (still streaming) so a half-written file shows as plain text until complete.
const FILE_BLOCK_RE = /```file:([^\n`]+)\n([\s\S]*?)```/g;

/**
 * Split an assistant message into ordered segments of markdown and file cards.
 * Order is preserved exactly as it appears in the source.
 */
export function splitFileSegments(markdown: string): MessageSegment[] {
    if (!markdown || !markdown.includes('```file:')) {
        return [{ type: 'md', text: markdown || '' }];
    }

    const segments: MessageSegment[] = [];
    let lastIndex = 0;
    let m: RegExpExecArray | null;

    FILE_BLOCK_RE.lastIndex = 0;
    while ((m = FILE_BLOCK_RE.exec(markdown)) !== null) {
        const before = markdown.slice(lastIndex, m.index);
        if (before.trim()) segments.push({ type: 'md', text: before });

        const name = sanitizeFilename(m[1].trim());
        // Strip a single trailing newline left before the closing fence.
        const content = m[2].replace(/\n$/, '');
        segments.push({ type: 'file', name, content });

        lastIndex = m.index + m[0].length;
    }

    const tail = markdown.slice(lastIndex);
    if (tail.trim()) segments.push({ type: 'md', text: tail });

    return segments.length > 0 ? segments : [{ type: 'md', text: markdown }];
}

export function hasFileBlock(markdown: string): boolean {
    return !!markdown && FILE_BLOCK_RE.test(markdown);
}

/**
 * Pull every completed file block out of a message. Returns the prose with the
 * file blocks removed, plus the list of files to render as pills at the bottom.
 */
export function extractFiles(markdown: string): {
    body: string;
    files: FileAttachment[];
} {
    if (!markdown || !markdown.includes('```file:')) {
        return { body: markdown || '', files: [] };
    }

    const files: FileAttachment[] = [];
    const body = markdown.replace(FILE_BLOCK_RE, (_full, rawName: string, content: string) => {
        files.push({
            name: sanitizeFilename(rawName.trim()),
            content: content.replace(/\n$/, ''),
        });
        return '';
    });

    return { body: body.replace(/\n{3,}/g, '\n\n').trim(), files };
}

/** Keep filenames safe for download — strip paths and dangerous characters. */
function sanitizeFilename(raw: string): string {
    const base = raw.split(/[\\/]/).pop() || 'file.txt';
    const cleaned = base.replace(/[^\w.\- ]+/g, '').trim();
    return cleaned || 'file.txt';
}
