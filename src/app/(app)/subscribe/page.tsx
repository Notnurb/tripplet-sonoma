'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { useRouter } from 'next/navigation';
import { useSubscription } from '@/context/SubscriptionContext';

const TIERS = [
    {
        id: 'go',
        name: 'Go',
        price: { monthly: 8, yearly: 5 },
        description: 'Get started with Tripplet',
        features: ['Unlimited messages', 'Suzhou 4 (Creative model)', 'Standard response speed', 'Chat history (7 days)'],
        cta: 'Get Started',
        href: '#', // Handled by click
    },
    {
        id: 'builder',
        name: 'Builder',
        price: { monthly: 16, yearly: 10 },
        description: 'For creators and developers',
        features: ['Everything in Go', 'Majuli 4 (Fast model)', 'Vision — analyze images', 'Chat history (30 days)', 'Priority support'],
        cta: 'Get Started',
        popular: true,
        href: '#',
    },
    {
        id: 'plus',
        name: 'Plus',
        price: { monthly: 20, yearly: 13 },
        description: 'For power users',
        features: ['Everything in Builder', 'Taipei 3.1 (Advanced reasoning)', 'Deep Think mode', 'Extended reasoning budget', 'Unlimited file uploads', 'Chat history (90 days)'],
        cta: 'Get Started',
        href: '#',
    },
    {
        id: 'max',
        name: 'Max',
        price: { monthly: 150, yearly: 100 },
        description: 'For teams and enterprises',
        features: ['Everything in Plus', 'All models unlocked', 'Anura OS sandbox access', 'Custom system prompts', 'Unlimited history', 'API access', 'Dedicated support'],
        cta: 'Get Started',
        highlighted: true,
        href: '#',
    },
];

export default function SubscribePage() {
    const router = useRouter();
    const { plan, isSubscribed, toggleSubscription } = useSubscription();
    const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');

    const interactiveTiers = TIERS.map(tier => ({
        ...tier,
        cta: plan === tier.id ? 'Current Plan' : (isSubscribed ? 'Switch Plan' : 'Get Started'),
        highlighted: plan === tier.id || tier.highlighted,
        onClick: () => router.push(`/subscribe/checkout?plan=${tier.id}&billing=${billing}`),
    }));

    return (
        <div className="flex flex-col h-full overflow-y-auto">
            <div className="p-4 flex justify-between items-center">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.push('/chat')}
                    className="gap-2 text-muted-foreground hover:text-foreground"
                >
                    <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
                    Back to Chat
                </Button>

                {isSubscribed && (
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                            toggleSubscription('free');
                            alert("Unsubscribed successfully.");
                        }}
                    >
                        Cancel Subscription
                    </Button>
                )}
            </div>
            <div className="flex-1 flex justify-center items-start px-4 pb-12">
                <div className="w-full max-w-6xl">
                    <div className="text-center mb-8">
                        <div className="flex justify-center mb-4">
                            <Image src="/trilo-disco.png" alt="Trilo dancing" width={100} height={100} className="drop-shadow-xl" />
                        </div>
                        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-2">Simple Plans</h2>
                        <p className="text-muted-foreground text-lg mb-6">
                            {isSubscribed
                                ? `You are currently on the ${plan.toUpperCase()} plan.`
                                : "Choose the best plan for your needs."}
                        </p>

                        {/* Billing toggle */}
                        <div className="inline-flex items-center gap-3 rounded-full border border-border bg-card p-1">
                            <button
                                onClick={() => setBilling('monthly')}
                                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 ${billing === 'monthly' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                Monthly
                            </button>
                            <button
                                onClick={() => setBilling('yearly')}
                                className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 ${billing === 'yearly' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                Annual
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${billing === 'yearly' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-500/15 text-emerald-500'}`}>
                                    Save 37%
                                </span>
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {interactiveTiers.map((tier) => {
                            const monthlyPrice = tier.price.monthly;
                            const yearlyPrice = tier.price.yearly;
                            const displayPrice = billing === 'yearly' ? yearlyPrice : monthlyPrice;
                            const annualSavings = (monthlyPrice - yearlyPrice) * 12;

                            return (
                                <div key={tier.id} className={`relative flex flex-col p-6 rounded-2xl border ${tier.highlighted ? 'border-primary/50 shadow-lg bg-primary/5' : 'border-border bg-card'}`}>
                                    {tier.popular && (
                                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary text-primary-foreground text-xs font-bold rounded-full">
                                            MOST POPULAR
                                        </div>
                                    )}
                                    <div className="mb-4">
                                        <h3 className="text-xl font-bold">{tier.name}</h3>
                                        <p className="text-muted-foreground text-sm mt-1">{tier.description}</p>
                                    </div>
                                    <div className="mb-1">
                                        <span className="text-3xl font-bold">${displayPrice}</span>
                                        <span className="text-muted-foreground">/mo</span>
                                    </div>
                                    {billing === 'yearly' && (
                                        <p className="text-[11px] text-emerald-500 font-medium mb-5">
                                            Save ${annualSavings}/year · billed ${yearlyPrice * 12}/yr
                                        </p>
                                    )}
                                    {billing === 'monthly' && <div className="mb-5" />}
                                    <ul className="flex-1 space-y-3 mb-6">
                                        {tier.features.map((feature) => (
                                            <li key={feature} className="flex items-center text-sm gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                                                {feature}
                                            </li>
                                        ))}
                                    </ul>
                                    <Button
                                        className="w-full"
                                        variant={tier.highlighted ? "default" : "outline"}
                                        onClick={tier.onClick}
                                        disabled={plan === tier.id}
                                    >
                                        {tier.cta}
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
