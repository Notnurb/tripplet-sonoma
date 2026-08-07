'use client';

/**
 * Full-bleed animated backdrop shared by the Chat, Code, and Agent workspaces.
 * Children render above the looping background video; pair with
 * `<SonomaChatShell transparent />` so the shell lets the video show through.
 */
export default function VideoBackdrop({ children }: { children: React.ReactNode }) {
    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <video
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                aria-hidden="true"
                style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    zIndex: 0,
                    backgroundColor: '#000',
                }}
            >
                <source src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260801_001207_ec20d138-aa45-4b2b-ab8c-bdc71607f240.mp4" type="video/mp4" />
            </video>
            <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%' }}>
                {children}
            </div>
        </div>
    );
}
