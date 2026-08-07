'use client';

// Embeds the OpenCode web UI (the web-only OpenCode server) into the Code
// workspace. The server runs separately — see the opencode repo — and its URL
// is configurable via NEXT_PUBLIC_OPENCODE_URL. The Tripplet sidebar comes
// from the (app) layout, so this frame only owns the content area.
const OPENCODE_URL = process.env.NEXT_PUBLIC_OPENCODE_URL || 'http://localhost:4096';

export default function OpenCodeFrame() {
    return (
        <iframe
            src={OPENCODE_URL}
            title="OpenCode"
            className="h-full w-full border-0"
            allow="clipboard-write; clipboard-read"
        />
    );
}
