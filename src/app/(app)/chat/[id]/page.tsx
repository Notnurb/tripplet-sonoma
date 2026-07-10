'use client';

import { useParams } from 'next/navigation';
import SonomaChatShell from '@/components/Sonoma/ChatShell';
import VideoBackdrop from '@/components/Sonoma/VideoBackdrop';

export default function ChatIdPage() {
    const params = useParams();
    const id = typeof params?.id === 'string' ? params.id : undefined;
    return (
        <VideoBackdrop>
            <SonomaChatShell conversationId={id} transparent />
        </VideoBackdrop>
    );
}
