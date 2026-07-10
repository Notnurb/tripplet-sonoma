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

export default function UserProfile() {
    const { user, isLoading, signOut } = useAuth();
    const router = useRouter();

    if (isLoading) return null;
    if (!user) return null;

    const initials = user.name
        ? user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
        : user.email.substring(0, 2).toUpperCase();

    return (
        <div className="p-3 border-t border-sidebar-border">
            <DropdownMenu>
                <DropdownMenuTrigger className="w-full outline-none">
                    <div className="flex items-center gap-3 w-full p-2 rounded-xl hover:bg-sidebar-accent transition-colors text-left cursor-pointer">
                        <Avatar className="h-9 w-9 border border-border">
                            <AvatarImage src={user.image} alt={user.name || 'User'} />
                            <AvatarFallback>{initials}</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col flex-1 truncate">
                            <span className="text-sm font-medium leading-none text-sidebar-foreground truncate">
                                {user.name || 'User'}
                            </span>
                            <span className="text-xs text-muted-foreground mt-1 truncate opacity-80">
                                {user.email}
                            </span>
                        </div>
                    </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56 bg-sidebar border-sidebar-border" align="end">
                    <DropdownMenuGroup>
                        <DropdownMenuLabel className="font-normal">
                            <div className="flex flex-col space-y-1">
                                <p className="text-sm font-medium leading-none text-sidebar-foreground">{user.name}</p>
                                <p className="text-xs leading-none text-muted-foreground">
                                    {user.email}
                                </p>
                            </div>
                        </DropdownMenuLabel>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator className="bg-sidebar-border" />
                    <DropdownMenuItem onClick={() => router.push('/profile')} className="focus:bg-sidebar-accent cursor-pointer">
                        <HugeiconsIcon icon={UserIcon} size={16} className="mr-2" />
                        <span>Profile</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer">
                        <HugeiconsIcon icon={Logout02Icon} size={16} className="mr-2" />
                        <span>Log out</span>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
