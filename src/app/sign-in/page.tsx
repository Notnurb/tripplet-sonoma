'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Redirect /sign-in to /login (custom auth)
export default function SignInPage() {
    const router = useRouter();
    useEffect(() => { router.replace('/login'); }, [router]);
    return null;
}
