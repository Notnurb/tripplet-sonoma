'use client';

import { CODE_BLUR } from '@/lib/blur-placeholders';

/**
 * Full-bleed animated backdrop shared by the Chat, Code, and Agent workspaces.
 * Layers, bottom to top: an inlined base64 blur (paints instantly, no network),
 * a poster frame, then the looping video — each covering the previous as it
 * loads, so there is never a black flash. Children render above it; pair with
 * `<SonomaChatShell transparent />` so the shell lets the video show through.
 */
export default function VideoBackdrop({ children }: { children: React.ReactNode }) {
    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div
                aria-hidden="true"
                style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 0,
                    backgroundImage: `url(${CODE_BLUR})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    transform: 'scale(1.1)', // hide blurred edges
                }}
            />
            <video
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                poster="/hq720.jpg"
                aria-hidden="true"
                style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    zIndex: 0,
                    backgroundColor: 'transparent',
                }}
            >
                <source src="/code-bg.mp4" type="video/mp4" />
            </video>
            <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%' }}>
                {children}
            </div>
        </div>
    );
}
