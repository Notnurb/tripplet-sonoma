'use client';

import { useParams } from 'next/navigation';
import SonomaChatShell from '@/components/Sonoma/ChatShell';
import VideoBackdrop from '@/components/Sonoma/VideoBackdrop';

export default function CodeIdPage() {
    const params = useParams();
    const id = typeof params?.id === 'string' ? params.id : undefined;
    return (
        <VideoBackdrop>
            <SonomaChatShell page="code" conversationId={id} transparent />
        </VideoBackdrop>
    );
}
