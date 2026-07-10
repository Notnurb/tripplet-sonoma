'use client';

import SonomaChatShell from '@/components/Sonoma/ChatShell';
import VideoBackdrop from '@/components/Sonoma/VideoBackdrop';

// Render a ready-to-use chat immediately. A conversation is created on the
// first message (which also updates the URL), so there's no blank screen and
// no need to click "New chat" to get started.
export default function ChatPage() {
    return (
        <VideoBackdrop>
            <SonomaChatShell transparent />
        </VideoBackdrop>
    );
}
