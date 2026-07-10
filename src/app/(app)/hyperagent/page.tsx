'use client';

import SonomaChatShell from '@/components/Sonoma/ChatShell';
import VideoBackdrop from '@/components/Sonoma/VideoBackdrop';

export default function HyperAgentIndexPage() {
    return (
        <VideoBackdrop>
            <SonomaChatShell page="agent" transparent />
        </VideoBackdrop>
    );
}
