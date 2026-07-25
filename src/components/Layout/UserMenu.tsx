'use client';

import { useAuth } from '@/context/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { HugeiconsIcon } from '@hugeicons/react';
import { UserIcon, Logout02Icon } from '@hugeicons/core-free-icons';
import { useRouter } from 'next/navigation';

export default function UserMenu() {
    const { user, isLoading, signOut } = useAuth();
    const router = useRouter();

    if (isLoading) return null;
    if (!user) return null;

    const initials = user.name
        ? user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
        : user.email.substring(0, 2).toUpperCase();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger className="outline-none">
                <div className="flex items-center gap-3 p-1 pr-3 rounded-full hover:bg-muted/50 transition-colors cursor-pointer border border-transparent hover:border-border">
                    <Avatar className="h-8 w-8 border border-border">
                        <AvatarImage src={user.image} alt={user.name || 'User'} />
                        <AvatarFallback className="bg-primary/20 text-primary text-xs">{initials}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium text-white hidden sm:inline-block max-w-[100px] truncate">
                        {user.name || 'User'}
                    </span>
                </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56 bg-popover/95 backdrop-blur-xl border-border text-popover-foreground" align="end">
                <DropdownMenuGroup>
                    <DropdownMenuLabel className="font-normal">
                        <div className="flex flex-col space-y-1">
                            <p className="text-sm font-medium leading-none">{user.name}</p>
                            <p className="text-xs leading-none text-muted-foreground">
                                {user.email}
                            </p>
                        </div>
                    </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator className="bg-border" />
                <DropdownMenuItem onClick={() => router.push('/profile')} className="focus:bg-muted cursor-pointer">
                    <HugeiconsIcon icon={UserIcon} size={16} className="mr-2" />
                    <span>Profile</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/chat')} className="focus:bg-muted cursor-pointer md:hidden">
                    <HugeiconsIcon icon={UserIcon} size={16} className="mr-2" />
                    <span>Go to Chat</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer">
                    <HugeiconsIcon icon={Logout02Icon} size={16} className="mr-2" />
                    <span>Log out</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
