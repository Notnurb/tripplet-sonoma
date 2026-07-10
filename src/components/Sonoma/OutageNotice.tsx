'use client';

/**
 * Outage warning card shown on every chat surface while lib/outage.ts has
 * OUTAGE_ACTIVE set. Dark glass styling so it reads clearly over the video
 * backdrop on all three workspaces.
 */
export default function OutageNotice() {
    return (
        <div
            role="alert"
            className="sm-fadeUp"
            style={{
                maxWidth: 560,
                margin: '0 auto 16px',
                padding: '18px 22px',
                borderRadius: 16,
                border: '1px solid rgba(251, 191, 36, 0.5)',
                background: 'rgba(0, 0, 0, 0.55)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                color: 'rgba(255, 255, 255, 0.92)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontSize: 16,
                    fontWeight: 700,
                    color: '#fbbf24',
                }}
            >
                <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                >
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                The website is broken right now
            </div>
            <p style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.55 }}>
                We are very sorry. Tripplet is currently broken and chat is turned off
                while we fix it. We know this is frustrating, and we apologize to every
                single one of you. Repairs are underway around the clock.
            </p>
            <p style={{ marginTop: 10, fontSize: 13.5, fontWeight: 600 }}>
                To make it up to you, once we are back everyone will get:
            </p>
            <ol
                style={{
                    marginTop: 6,
                    paddingLeft: 22,
                    fontSize: 13.5,
                    lineHeight: 1.7,
                    listStyle: 'decimal',
                }}
            >
                <li>Early Access to Astro 6, Taipei 4.1, Majuli 4.1, and Suzhou 4.1</li>
                <li>Unlimited customization</li>
                <li>Early Beta access to every single update</li>
                <li>All models become open source, each with a lite variant</li>
                <li>Better customer service</li>
            </ol>
            <p style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.55, color: 'rgba(255,255,255,0.75)' }}>
                Thank you for your patience. We will be back soon.
            </p>
        </div>
    );
}
