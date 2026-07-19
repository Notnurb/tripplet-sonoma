'use client';

import { TooltipProvider } from '@/components/ui/tooltip';
import { SubscriptionProvider } from '@/context/SubscriptionContext';
import { AuthProvider } from '@/context/AuthContext';
import { WebOSTrigger } from '@/components/ui/webos-easter-egg';
import { DevModePanel } from '@/components/dev/DevModePanel';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <>
<AuthProvider>
                <SubscriptionProvider>
                    <TooltipProvider>
                        {children}
                    </TooltipProvider>
                </SubscriptionProvider>
            </AuthProvider>
            <WebOSTrigger />
            <DevModePanel />
        </>
    );
}
