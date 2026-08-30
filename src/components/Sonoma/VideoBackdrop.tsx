'use client';

import { useState } from 'react';

/**
 * Full-bleed animated backdrop shared by the Chat, Code, and Agent workspaces.
 * Children render above the looping background video; pair with
 * `<SonomaChatShell transparent />` so the shell lets the video show through.
 */
const VIDEO_SRC =
    'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260801_001207_ec20d138-aa45-4b2b-ab8c-bdc71607f240.mp4';

export default function VideoBackdrop({ children }: { children: React.ReactNode }) {
    const [ready, setReady] = useState(false);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            {/* React 19 hoists <link> into <head> wherever it renders, so this
                kicks the video fetch off as early as possible without blocking
                the initial HTML response (keeps TTFB unaffected). */}
            <link rel="preload" as="video" href={VIDEO_SRC} fetchPriority="high" />
            {/* Skeleton shown until the video has a frame ready, so the hero
                never shows a flash of empty black while the video streams in. */}
            <div
                aria-hidden="true"
                style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 0,
                    opacity: ready ? 0 : 1,
                    transition: 'opacity 400ms ease',
                    background:
                        'linear-gradient(120deg, #0a0a0a 25%, #161616 37%, #0a0a0a 63%)',
                    backgroundSize: '400% 100%',
                    animation: ready ? 'none' : 'sonoma-video-skeleton 1.6s ease-in-out infinite',
                }}
            />
            <style>{`
                @keyframes sonoma-video-skeleton {
                    0% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
            `}</style>
            <video
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                // @ts-expect-error -- fetchPriority isn't in React's DOM typings yet
                fetchpriority="high"
                aria-hidden="true"
                onLoadedData={() => setReady(true)}
                style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    zIndex: 0,
                    backgroundColor: '#000',
                    opacity: ready ? 1 : 0,
                    transition: 'opacity 400ms ease',
                }}
            >
                <source src={VIDEO_SRC} type="video/mp4" />
            </video>
            <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%' }}>
                {children}
            </div>
        </div>
    );
}
