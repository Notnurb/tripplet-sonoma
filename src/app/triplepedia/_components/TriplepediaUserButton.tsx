'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { HugeiconsIcon } from '@hugeicons/react';
import { UserIcon, Logout02Icon } from '@hugeicons/core-free-icons';

/** `variant="dark"` is for the home page (near-black background). */
interface Props {
    variant?: 'dark' | 'default';
}

export default function TriplepediaUserButton({ variant = 'default' }: Props) {
    const { user, signOut } = useAuth();
    const router = useRouter();

    if (!user) return null;

    const initials = user.name
        ? user.name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase()
        : user.email.substring(0, 2).toUpperCase();

    const isDark = variant === 'dark';

    return (
        <DropdownMenu>
            <DropdownMenuTrigger className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl transition-colors outline-none ${
                    isDark
                        ? 'hover:bg-white/8 text-white'
                        : 'hover:bg-muted/60 text-foreground'
                }`}>
                    <Avatar className="h-7 w-7 border border-white/20">
                        <AvatarImage src={user.image ?? undefined} alt={user.name || 'User'} />
                        <AvatarFallback
                            className={`text-[11px] font-bold ${
                                isDark
                                    ? 'bg-zinc-700 text-white'
                                    : 'bg-muted text-foreground/70'
                            }`}
                        >
                            {initials}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col items-start leading-none">
                        <span
                            className={`text-xs font-semibold truncate max-w-[120px] ${
                                isDark ? 'text-white/90' : 'text-foreground'
                            }`}
                        >
                            {user.name || 'User'}
                        </span>
                        <span
                            className={`text-[10px] truncate max-w-[120px] mt-0.5 ${
                                isDark ? 'text-white/40' : 'text-muted-foreground'
                            }`}
                        >
                            {user.email}
                        </span>
                    </div>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                    <DropdownMenuLabel className="font-normal">
                        <div className="flex flex-col space-y-1">
                            <p className="text-sm font-medium leading-none">{user.name}</p>
                            <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                        </div>
                    </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={() => router.push('/profile')}
                    className="cursor-pointer"
                >
                    <HugeiconsIcon icon={UserIcon} size={16} className="mr-2" />
                    <span>Profile</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() => router.push('/chat')}
                    className="cursor-pointer"
                >
                    <span className="mr-2 text-base leading-none">💬</span>
                    <span>Back to Chat</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={signOut}
                    className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer"
                >
                    <HugeiconsIcon icon={Logout02Icon} size={16} className="mr-2" />
                    <span>Log out</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
