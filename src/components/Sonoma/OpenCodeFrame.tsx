'use client';

/**
 * @deprecated OpenSonoma/OpenCode embedding is no longer used by the Code
 * workspace. The route now uses Tripplet's native chat surface instead.
 */
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
