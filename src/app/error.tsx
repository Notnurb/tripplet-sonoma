'use client';

import { useEffect } from 'react';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('Global error:', error);
    }, [error]);

    return (
        <html>
            <body className="min-h-screen bg-gradient-to-br from-background to-background/80 flex items-center justify-center p-4">
                <div className="flex flex-col items-center gap-6 p-8 text-center max-w-sm">
                    { }
                    <img
                        src="/trilo-jaw.png"
                        alt="Trilo shocked"
                        width={130}
                        height={130}
                        className="drop-shadow-xl"
                    />
                    <div className="space-y-2">
                        <h1 className="text-3xl font-bold text-foreground">Whoops!</h1>
                        <p className="text-muted-foreground/80 text-sm leading-relaxed">
                            Something unexpected happened. Don't worry, we're on it. Try refreshing to get back on track.
                        </p>
                    </div>
                    <button
                        onClick={reset}
                        className="px-6 py-2.5 bg-gradient-to-r from-foreground to-foreground/90 text-background rounded-lg hover:shadow-lg active:scale-95 transition-all font-medium text-sm mt-2"
                    >
                        Refresh page
                    </button>
                </div>
            </body>
        </html>
    );
}
