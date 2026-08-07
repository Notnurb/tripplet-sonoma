'use client';

import { useParams } from 'next/navigation';
import BuildWorkspace from '@/components/Sonoma/BuildWorkspace';

export default function BuildSessionPage() {
    const params = useParams();
    return <BuildWorkspace conversationId={typeof params?.id === 'string' ? params.id : undefined} />;
}
