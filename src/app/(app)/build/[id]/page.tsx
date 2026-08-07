'use client';

import { useParams } from 'next/navigation';
import BuildWorkspace from '@/components/Sonoma/BuildWorkspace';
import VideoBackdrop from '@/components/Sonoma/VideoBackdrop';

export default function BuildSessionPage() {
    const params = useParams();
    return (
        <VideoBackdrop>
            <BuildWorkspace conversationId={typeof params?.id === 'string' ? params.id : undefined} />
        </VideoBackdrop>
    );
}
