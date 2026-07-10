'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function V1ChatPage() {
    const router = useRouter();
    useEffect(() => { router.replace('/chat'); }, [router]);
    return (
        <div className="flex items-center justify-center h-screen bg-background">
            <div className="flex flex-col items-center gap-4">
                <div className="w-8 h-8 border-4 border-foreground/20 border-t-foreground rounded-full animate-spin" />
                <p className="text-sm text-muted-foreground">Loading V1…</p>
            </div>
        </div>
    );
}
