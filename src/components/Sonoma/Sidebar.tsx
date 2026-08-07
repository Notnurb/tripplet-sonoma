'use client';

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useChatActions, useChatConversations } from '@/context/ChatContext';
import { type User, useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { HugeiconsIcon } from '@hugeicons/react';
import { AnvilIcon, Book01Icon, Logout02Icon, PaintBoardIcon, Settings05Icon } from '@hugeicons/core-free-icons';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
    SonomaLogo,
    SonomaSidebar as IconSidebar,
    SonomaNewChat,
    SonomaChat,
    SonomaCode,
} from './icons';

function TriplepediaIcon({ size = 18 }: { size?: number }) {
    return <HugeiconsIcon icon={Book01Icon} size={size} strokeWidth={1.8} />;
}

function BuildIcon({ size = 18 }: { size?: number }) {
    return <HugeiconsIcon icon={AnvilIcon} size={size} strokeWidth={1.8} />;
}

const PAGES = [
    { id: 'chat', label: 'Chat', icon: SonomaChat, href: '/chat' },
    { id: 'build', label: 'Build', icon: BuildIcon, href: '/build' },
    { id: 'code', label: 'Code', icon: SonomaCode, href: '/code' },
    { id: 'triplepedia', label: 'Triplepedia', icon: TriplepediaIcon, href: '/triplepedia' },
];

const FACE_FILES = [
    'funEmoji-1778916492953.png',
    'funEmoji-1778916495334.png',
    'funEmoji-1778916497640.png',
    'funEmoji-1778916499549.png',
    'funEmoji-1778916503005.png',
    'funEmoji-1778916504737.png',
    'funEmoji-1778916506553.png',
    'funEmoji-1778916509021.png',
    'funEmoji-1778916511974.png',
    'funEmoji-1778916514078.png',
    'funEmoji-1778916516399.png',
    'funEmoji-1778916518853.png',
    'funEmoji-1778916523139.png',
    'funEmoji-1778916525134.png',
    'funEmoji-1778916527641.png',
    'funEmoji-1778916529765.png',
    'funEmoji-1778916534263.png',
    'funEmoji-1778916536281.png',
    'funEmoji-1778916539039.png',
    'funEmoji-1778916541091.png',
];

interface SonomaSidebarProps {
    collapsed: boolean;
    onCollapseToggle: () => void;
    /** Rendered as an off-canvas drawer (wider, always-expanded). */
    mobile?: boolean;
    /** Called after any navigation so the parent can close the drawer. */
    onNavigate?: () => void;
}

interface NavItemProps {
    active: boolean;
    onClick?: () => void;
    href?: string;
    icon: React.ComponentType<{ size?: number }>;
    label: string;
    collapsed: boolean;
}

function NavItem({ active, onClick, href, icon: Icon, label, collapsed }: NavItemProps) {
    const inner = (
        <>
            <span
                className={cn(
                    'inline-flex shrink-0 transition-colors',
                    active ? 'text-[var(--sonoma-accent)]' : 'text-[color:currentColor]',
                )}
            >
                <Icon size={18} />
            </span>
            {!collapsed && (
                <span className="truncate whitespace-nowrap">{label}</span>
            )}
            {active && !collapsed && (
                <span
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 h-[5px] w-[5px] rounded-full"
                    style={{ background: 'var(--sonoma-accent)' }}
                />
            )}
        </>
    );

    const classes = cn(
        'relative flex w-full items-center gap-3 rounded-[10px] text-[14px] transition-colors',
        collapsed ? 'justify-center py-2.5 px-0' : 'justify-start py-2 px-[11px]',
        active
            ? 'text-[var(--sonoma-ink)] font-medium'
            : 'text-[var(--sonoma-ink-2)] hover:text-[var(--sonoma-ink)] font-normal',
    );

    const style: React.CSSProperties = active ? { background: 'var(--sonoma-surface-2)' } : {};

    if (href) {
        return (
            <Link href={href} className={classes} style={style} title={collapsed ? label : undefined} onClick={onClick}>
                {inner}
            </Link>
        );
    }

    return (
        <button onClick={onClick} className={classes} style={style} title={collapsed ? label : undefined}>
            {inner}
        </button>
    );
}

function getDisplayName(user: User) {
    return user.name?.trim() || user.email?.split('@')[0] || 'Account';
}

function getInitials(user: User) {
    const displayName = getDisplayName(user);
    const parts = displayName.split(/\s+/).filter(Boolean);

    if (parts.length >= 2) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }

    return displayName.slice(0, 2).toUpperCase();
}

function hashString(value: string) {
    let hash = 0;

    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }

    return Math.abs(hash);
}

function getFaceUrl(user: User) {
    const key = user.id || user.email || getDisplayName(user);
    const file = FACE_FILES[hashString(key) % FACE_FILES.length];
    return `/api/faces/${encodeURIComponent(file)}`;
}

function AccountMenu({
    user,
    collapsed,
    onEditProfile,
    onSettings,
    onLogout,
}: {
    user: User;
    collapsed: boolean;
    onEditProfile: () => void;
    onSettings: () => void;
    onLogout: () => void;
}) {
    const displayName = getDisplayName(user);
    const initials = getInitials(user);
    const avatarSrc = user.image || getFaceUrl(user);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                className={cn(
                    'flex w-full items-center rounded-[10px] text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--sonoma-accent)]/30',
                    collapsed ? 'justify-center p-1.5' : 'gap-2.5 px-2 py-2',
                )}
                style={{ color: 'var(--sonoma-ink)' }}
                title={collapsed ? displayName : undefined}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sonoma-surface)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
                <Avatar
                    size={collapsed ? 'default' : 'sm'}
                    className="border border-[var(--sonoma-border)] bg-[var(--sonoma-surface-2)]"
                >
                    <AvatarImage src={avatarSrc} alt={displayName} className="object-cover" />
                    <AvatarFallback className="bg-[var(--sonoma-surface-2)] text-[11px] font-semibold text-[var(--sonoma-ink)]">
                        {initials}
                    </AvatarFallback>
                </Avatar>

                {!collapsed && (
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium leading-4 text-[var(--sonoma-ink)]">
                            {displayName}
                        </span>
                        <span className="block truncate text-[11.5px] leading-4 text-[var(--sonoma-muted)]">
                            {user.email}
                        </span>
                    </span>
                )}
            </DropdownMenuTrigger>

            <DropdownMenuContent
                align="start"
                side="top"
                sideOffset={8}
                className="w-52 rounded-xl border border-[var(--sonoma-border)] bg-[var(--sonoma-bg)] p-1 shadow-[var(--sonoma-shadow-lg)]"
            >
                <DropdownMenuItem
                    onClick={onEditProfile}
                    className="rounded-lg text-[13px]"
                >
                    <HugeiconsIcon icon={PaintBoardIcon} size={17} strokeWidth={1.8} />
                    Edit Profile
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={onSettings}
                    className="rounded-lg text-[13px]"
                >
                    <HugeiconsIcon icon={Settings05Icon} size={17} strokeWidth={1.8} />
                    Settings
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={onLogout}
                    variant="destructive"
                    className="rounded-lg text-[13px]"
                >
                    <HugeiconsIcon icon={Logout02Icon} size={17} strokeWidth={1.8} />
                    Log Out
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export default function SonomaSidebar({ collapsed, onCollapseToggle, mobile = false, onNavigate }: SonomaSidebarProps) {
    const router = useRouter();
    const pathname = usePathname();
    const { conversations, activeConversationId } = useChatConversations();
    const { createConversation, selectConversation } = useChatActions();
    const { user, signOut } = useAuth();

    const handleNewChat = useCallback(() => {
        const id = createConversation();
        if (id) router.push(`/chat/${id}`);
        onNavigate?.();
    }, [createConversation, router, onNavigate]);

    const handlePick = useCallback(
        (id: string) => {
            selectConversation(id);
            router.push(`/chat/${id}`);
            onNavigate?.();
        },
        [router, selectConversation, onNavigate],
    );

    const sortedHistory = useMemo(
        () =>
            [...conversations]
                .filter((c) => (c.messages?.length ?? 0) > 0)
                .sort((a, b) => {
                    const at = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
                    const bt = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
                    return bt - at;
                }),
        [conversations],
    );

    const isPageActive = (href: string) => {
        if (href === '/chat') return pathname === '/chat' || pathname?.startsWith('/chat/');
        return pathname === href || pathname?.startsWith(`${href}/`);
    };

    const routerPush = useCallback((href: string) => {
        router.push(href);
        onNavigate?.();
    }, [router, onNavigate]);

    return (
        <aside
            className="relative flex h-full flex-shrink-0 flex-col overflow-hidden border-r"
            style={{
                width: mobile ? 'min(84vw, 320px)' : collapsed ? 64 : 244,
                background: 'var(--sonoma-bg)',
                borderRightColor: 'var(--sonoma-border)',
                transition: mobile ? undefined : 'width .28s cubic-bezier(.2,.7,.2,1)',
                // Keep the drawer header clear of the status bar / notch.
                paddingTop: mobile ? 'env(safe-area-inset-top)' : undefined,
                paddingBottom: mobile ? 'env(safe-area-inset-bottom)' : undefined,
            }}
        >
            {/* Header */}
            <div
                className={cn(
                    'flex items-center gap-2',
                    collapsed ? 'justify-center py-[14px] px-0' : 'justify-between py-[14px] px-[14px]',
                )}
                style={{ minHeight: 56 }}
            >
                {!collapsed && (
                    <Link href="/" onClick={onNavigate} className="sm-fadeIn flex items-center gap-[9px]">
                        <SonomaLogo size={22} color="var(--sonoma-accent)" />
                        <span
                            className="text-[21px] font-medium tracking-[-0.012em]"
                            style={{ fontFamily: 'var(--font-serif)', color: 'var(--sonoma-ink)' }}
                        >
                            Tripplet
                        </span>
                    </Link>
                )}
                <button
                    onClick={onCollapseToggle}
                    title={mobile ? 'Close menu' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
                    style={{ color: 'var(--sonoma-ink-2)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sonoma-surface)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                    <IconSidebar />
                </button>
            </div>

            {/* New chat */}
            <div className="px-[10px] pb-2">
                <button
                    onClick={handleNewChat}
                    title={collapsed ? 'New chat' : undefined}
                    className={cn(
                        'flex w-full items-center gap-[10px] rounded-[10px] text-[14px] font-medium transition-colors',
                        collapsed ? 'justify-center py-2.5' : 'justify-start px-3 py-2',
                    )}
                    style={{
                        background: 'var(--sonoma-surface)',
                        border: '1px solid var(--sonoma-border)',
                        color: 'var(--sonoma-ink)',
                        boxShadow: 'var(--sonoma-shadow-sm)',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--sonoma-surface-2)';
                        e.currentTarget.style.borderColor = 'var(--sonoma-border-2)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--sonoma-surface)';
                        e.currentTarget.style.borderColor = 'var(--sonoma-border)';
                    }}
                >
                    <SonomaNewChat />
                    {!collapsed && <span>New chat</span>}
                </button>
            </div>

            {/* Pages */}
            <nav className="flex flex-col gap-0.5 px-[10px] py-1.5">
                {PAGES.map((p) => (
                    <NavItem
                        key={p.id}
                        href={p.href}
                        icon={p.icon}
                        label={p.label}
                        active={isPageActive(p.href)}
                        collapsed={collapsed}
                        onClick={onNavigate}
                    />
                ))}
            </nav>

            {/* History */}
            {!collapsed && (
                <div className="sm-fadeIn sonoma-scroll mt-1.5 flex-1 overflow-y-auto px-[10px] pb-[14px] pt-[14px]">
                    <div
                        className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.10em]"
                        style={{ color: 'var(--sonoma-faint)' }}
                    >
                        History
                    </div>
                    {sortedHistory.length === 0 && (
                        <div
                            className="px-2.5 py-1.5 text-[12.5px]"
                            style={{ color: 'var(--sonoma-faint)' }}
                        >
                            No chats yet
                        </div>
                    )}
                    <div className="flex flex-col gap-[1px]">
                        {sortedHistory.map((c) => {
                            const isActive = activeConversationId === c.id;
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => handlePick(c.id)}
                                    className={cn(
                                        'block w-full truncate rounded-lg px-2.5 py-2 text-left text-[13.5px] transition-colors',
                                    )}
                                    style={{
                                        color: isActive ? 'var(--sonoma-ink)' : 'var(--sonoma-ink-2)',
                                        background: isActive ? 'var(--sonoma-surface)' : 'transparent',
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isActive) e.currentTarget.style.background = 'var(--sonoma-bg-2)';
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isActive) e.currentTarget.style.background = 'transparent';
                                    }}
                                >
                                    {c.title || 'Untitled'}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
            {collapsed && <div className="flex-1" />}

            {/* Footer — account */}
            <div
                className={cn('py-3', collapsed ? 'px-[8px]' : 'px-[10px]')}
                style={{ borderTop: '1px solid var(--sonoma-border)' }}
            >
                {user ? (
                    <AccountMenu
                        user={user}
                        collapsed={collapsed}
                        onEditProfile={() => routerPush('/profile')}
                        onSettings={() => routerPush('/settings')}
                        onLogout={() => void signOut()}
                    />
                ) : collapsed ? (
                    <Link
                        href="/login"
                        className="flex h-10 w-full items-center justify-center rounded-[10px] text-[12px] font-semibold transition-colors"
                        style={{
                            background: 'var(--sonoma-surface)',
                            color: 'var(--sonoma-ink)',
                        }}
                        title="Sign in"
                    >
                        <SonomaLogo size={18} />
                    </Link>
                ) : (
                    <div className="flex flex-col gap-1.5">
                        <Link
                            href="/register"
                            onClick={onNavigate}
                            className="w-full rounded-full px-3 py-2 text-center text-[13px] font-medium"
                            style={{
                                background: 'var(--sonoma-accent)',
                                color: '#fff',
                            }}
                        >
                            Create free account
                        </Link>
                        <Link
                            href="/login"
                            onClick={onNavigate}
                            className="w-full rounded-full px-3 py-2 text-center text-[13px]"
                            style={{ color: 'var(--sonoma-ink-2)' }}
                        >
                            Sign in
                        </Link>
                    </div>
                )}
            </div>
        </aside>
    );
}
