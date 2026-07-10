'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChatProvider, useChatActions } from '@/context/ChatContext';
import { SettingsApplicator } from '@/components/ui/settings-applicator';
import { TriplepediaBackgroundTrainer } from '@/components/Triplepedia/BackgroundTrainer';
import { CommandPalette } from '@/components/ui/command-palette';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import SonomaSidebar from '@/components/Sonoma/Sidebar';
import { HtmlPreviewHost } from '@/components/Sonoma/HtmlPreviewPanel';
import { SonomaLogo, SonomaNewChat } from '@/components/Sonoma/icons';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';

// ⌘N / Ctrl+N → new chat from anywhere in the app
function NewChatShortcut() {
    const { createConversation } = useChatActions();
    const router = useRouter();
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
                e.preventDefault();
                const id = createConversation();
                router.push(`/chat/${id}`);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [createConversation, router]);
    return null;
}

// Slim top bar shown only on mobile: opens the drawer + quick new chat.
function MobileHeader({ onOpenMenu }: { onOpenMenu: () => void }) {
    const { createConversation } = useChatActions();
    const router = useRouter();
    const newChat = useCallback(() => {
        const id = createConversation();
        if (id) router.push(`/chat/${id}`);
    }, [createConversation, router]);

    return (
        <header
            className="flex shrink-0 items-center justify-between md:hidden"
            style={{
                height: 'calc(52px + env(safe-area-inset-top))',
                paddingTop: 'env(safe-area-inset-top)',
                paddingLeft: 8,
                paddingRight: 8,
                background: 'var(--sonoma-bg)',
                borderBottom: '1px solid var(--sonoma-border)',
            }}
        >
            <button
                onClick={onOpenMenu}
                aria-label="Open menu"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl active:scale-95 transition-transform"
                style={{ color: 'var(--sonoma-ink)' }}
            >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
            </button>

            <Link href="/" className="flex items-center gap-1.5">
                <SonomaLogo size={20} color="var(--sonoma-accent)" />
                <span
                    className="text-[18px] font-medium tracking-[-0.012em]"
                    style={{ fontFamily: 'var(--font-serif)', color: 'var(--sonoma-ink)' }}
                >
                    Tripplet
                </span>
            </Link>

            <button
                onClick={newChat}
                aria-label="New chat"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl active:scale-95 transition-transform"
                style={{ color: 'var(--sonoma-ink)' }}
            >
                <SonomaNewChat />
            </button>
        </header>
    );
}

export default function AppLayout({
    children,
    modal,
}: {
    children: React.ReactNode;
    modal: React.ReactNode;
}) {
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const isMobile = useIsMobile();
    const pathname = usePathname();

    const closeMobile = useCallback(() => setMobileOpen(false), []);

    // Close the drawer whenever we navigate, or when we grow past mobile.
    useEffect(() => {
        setMobileOpen(false);
    }, [pathname]);
    useEffect(() => {
        if (!isMobile) setMobileOpen(false);
    }, [isMobile]);

    // Lock body scroll while the mobile drawer is open.
    useEffect(() => {
        if (!mobileOpen) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, [mobileOpen]);

    return (
        <ChatProvider>
            <SettingsApplicator />
            <TriplepediaBackgroundTrainer />
            <CommandPalette />
            <NewChatShortcut />
            <div
                className="flex w-full overflow-hidden"
                style={{ height: '100dvh', background: 'var(--sonoma-bg)' }}
            >
                {/* Mobile backdrop */}
                <div
                    onClick={closeMobile}
                    aria-hidden
                    className={cn(
                        'fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] transition-opacity duration-300 md:hidden',
                        mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
                    )}
                />

                {/* Sidebar — in-flow on desktop, off-canvas drawer on mobile */}
                <div
                    className={cn(
                        'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:transition-transform max-md:duration-300 max-md:ease-out max-md:will-change-transform md:relative',
                        mobileOpen ? 'max-md:translate-x-0 max-md:shadow-2xl' : 'max-md:-translate-x-full',
                    )}
                >
                    <SonomaSidebar
                        collapsed={isMobile ? false : collapsed}
                        mobile={isMobile}
                        onCollapseToggle={isMobile ? closeMobile : () => setCollapsed((c) => !c)}
                        onNavigate={closeMobile}
                    />
                </div>

                <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
                    <MobileHeader onOpenMenu={() => setMobileOpen(true)} />
                    <div className="relative flex min-h-0 flex-1 flex-col">
                        {children}
                    </div>
                </main>
            </div>
            {modal}
            <HtmlPreviewHost />
        </ChatProvider>
    );
}
