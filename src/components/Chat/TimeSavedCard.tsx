'use client';

import { motion } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';

interface TimeSavedCardProps {
    exchangeCount: number;
}

const FLAVOR: { headline: string; sub: (mins: number) => string }[] = [
    { headline: '🧠 Big brain activated', sub: (m) => `~${m} minutes of Googling you dodged. That's ${m >= 60 ? `${Math.round(m / 60)} hour${Math.round(m / 60) > 1 ? 's' : ''}` : `${m} mins`} back in your pocket.` },
    { headline: '⚡ You move fast', sub: (m) => `${m} minutes of research — done. Most people would still be on their third tab.` },
    { headline: '🎯 On a streak', sub: (m) => `${m} minutes saved this session. Imagine doing this every day.` },
    { headline: '🤙 Built different', sub: (m) => `You just saved ~${m} minutes. That's enough time to eat a whole pizza AND watch a YouTube video.` },
];

export default function TimeSavedCard({ exchangeCount }: TimeSavedCardProps) {
    const { user } = useAuth();
    const isSignedIn = !!user;
    const minutesSaved = exchangeCount * 3;
    const etCandidates = Math.floor(exchangeCount * 0.3);
    const flavor = FLAVOR[exchangeCount % FLAVOR.length];

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="rounded-xl border border-dashed border-border/50 bg-transparent px-4 py-3 text-center my-4"
        >
            <p className="text-xs font-medium text-foreground/70">{flavor.headline}</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">{flavor.sub(minutesSaved)}</p>
            {isSignedIn && etCandidates > 0 && (
                <p className="text-[10px] text-muted-foreground/40 mt-1">
                    Extended Thinking could&apos;ve gone even deeper on {etCandidates} of those — turn it on anytime.
                </p>
            )}
            {!isSignedIn && (
                <p className="text-[10px] text-muted-foreground/40 mt-1.5">
                    <a href="/register" className="underline hover:text-muted-foreground transition-colors">Create a free account</a> to save this conversation and keep your streak going.
                </p>
            )}
        </motion.div>
    );
}
