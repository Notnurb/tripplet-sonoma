'use client';

import SonomaChatShell from '@/components/Sonoma/ChatShell';
import VideoBackdrop from '@/components/Sonoma/VideoBackdrop';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function CodeIndexPage() {
    const router = useRouter();
    return (
        <VideoBackdrop>
            <button
                type="button"
                onClick={() => router.push('/connect')}
                style={{
                    position: 'absolute',
                    top: 16,
                    left: 16,
                    zIndex: 2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    borderRadius: 9999,
                    border: '1px solid rgba(255,255,255,0.2)',
                    background: 'rgba(0,0,0,0.4)',
                    backdropFilter: 'blur(8px)',
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                }}
            >
                <Plus size={15} strokeWidth={2.5} />
                Pair
            </button>
            <SonomaChatShell page="code" transparent />
        </VideoBackdrop>
    );
}
