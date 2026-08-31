'use client';

import { useParams } from 'next/navigation';
import SonomaChatShell from '@/components/Sonoma/ChatShell';

export default function ChatIdPage() {
    const params = useParams();
    const id = typeof params?.id === 'string' ? params.id : undefined;
    return <SonomaChatShell conversationId={id} />;
}
