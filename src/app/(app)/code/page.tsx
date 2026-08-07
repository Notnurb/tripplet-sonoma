'use client';

import SonomaChatShell from '@/components/Sonoma/ChatShell';
import VideoBackdrop from '@/components/Sonoma/VideoBackdrop';

export default function CodeIndexPage() {
    return (
        <VideoBackdrop>
            <SonomaChatShell page="code" transparent />
        </VideoBackdrop>
    );
}
