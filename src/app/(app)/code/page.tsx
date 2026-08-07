'use client';

import { useState } from 'react';
import OpenCodeFrame from '@/components/Sonoma/OpenCodeFrame';
import ManageDevicesModal from '@/components/Sonoma/ManageDevicesModal';
import VideoBackdrop from '@/components/Sonoma/VideoBackdrop';
import { Plus, Settings2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

const pillStyle: React.CSSProperties = {
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
};

export default function CodeIndexPage() {
    const router = useRouter();
    const [manageOpen, setManageOpen] = useState(false);
    return (
        <VideoBackdrop>
            <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 2, display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => router.push('/connect')} style={pillStyle}>
                    <Plus size={15} strokeWidth={2.5} />
                    Pair
                </button>
                <button type="button" onClick={() => setManageOpen(true)} style={pillStyle}>
                    <Settings2 size={15} strokeWidth={2.5} />
                    Manage
                </button>
            </div>
            <ManageDevicesModal open={manageOpen} onClose={() => setManageOpen(false)} />
            <OpenCodeFrame />
        </VideoBackdrop>
    );
}
