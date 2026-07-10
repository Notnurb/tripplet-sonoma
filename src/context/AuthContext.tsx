'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';

export interface User {
    id: string;
    email: string;
    name?: string;
    image?: string;
    bio?: string;
}

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    signIn: (data: any) => Promise<void>;
    signOut: () => Promise<void>;
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const fetchUser = useCallback(async (retries = 1, signal?: AbortSignal) => {
        try {
            const res = await fetch('/api/auth/me', { signal });
            if (!res.ok && res.status >= 500 && retries > 0) {
                await new Promise(r => setTimeout(r, 800));
                return fetchUser(retries - 1, signal);
            }
            const data = await res.json();
            if (!signal?.aborted) setUser(data.user ?? null);
        } catch (err) {
            if (signal?.aborted) return;
            if (retries > 0) {
                await new Promise(r => setTimeout(r, 800));
                return fetchUser(retries - 1, signal);
            }
            setUser(null);
        } finally {
            if (!signal?.aborted) setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        fetchUser(1, controller.signal);
        return () => controller.abort();
    }, [fetchUser]);

    const signIn = async () => {
        window.location.href = '/login';
    };

    const signOut = async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        setUser(null);
        window.location.href = '/';
    };

    return (
        <AuthContext.Provider value={{ user, isLoading, signIn, signOut, refreshUser: fetchUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
