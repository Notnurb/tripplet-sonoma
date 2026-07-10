'use client';

import React, { createContext, useContext } from 'react';

type Plan = 'free' | 'go' | 'builder' | 'plus' | 'max';

interface SubscriptionContextType {
    plan: Plan;
    isSubscribed: boolean;
    toggleSubscription: (plan: Plan) => void;
    showRealAds: boolean;
    setShowRealAds: (show: boolean) => void;
    credits: number;
    addCredits: (amount: number) => void;
    deductCredit: () => void;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
    return (
        <SubscriptionContext.Provider
            value={{
                plan: 'max',
                isSubscribed: true,
                toggleSubscription: () => { },
                showRealAds: false,
                setShowRealAds: () => { },
                credits: 999999, // Infinite credits
                addCredits: () => { },
                deductCredit: () => { },
            }}
        >
            {children}
        </SubscriptionContext.Provider>
    );
}

export function useSubscription() {
    return useContext(SubscriptionContext) || {
        plan: 'max',
        isSubscribed: true,
        toggleSubscription: () => { },
        showRealAds: false,
        setShowRealAds: () => { },
        credits: 999999,
        addCredits: () => { },
        deductCredit: () => { },
    };
}
