'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, CheckmarkCircle01Icon } from '@hugeicons/core-free-icons';
import { useSubscription } from '@/context/SubscriptionContext';
import { Suspense } from 'react';

const TIERS_DATA: Record<string, { name: string; price: number; features: string[] }> = {
    go: {
        name: 'Go',
        price: 8,
        features: ['8 ads per week', 'Access to Suzhou 3', 'Standard response speed'],
    },
    builder: {
        name: 'Builder',
        price: 16,
        features: ['16 ads per week', 'Access to Majuli 3', 'Faster response speed', 'Image analysis'],
    },
    plus: {
        name: 'Plus',
        price: 20,
        features: ['20 ads per week', 'Access to Taipei 3 + Majuli 3', 'Deep Think mode'],
    },
    max: {
        name: 'Max',
        price: 150,
        features: ['150 ads per week', 'All models unlocked', 'Anura OS sandbox access', 'Custom system prompts'],
    },
};

function CheckoutContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { toggleSubscription } = useSubscription();

    const planId = searchParams.get('plan') || 'go';
    const plan = TIERS_DATA[planId] || TIERS_DATA['go'];

    const handleSubscribe = () => {
        // Process subscription (mock)
        toggleSubscription(planId as any);
        // Simulate processing delay
        setTimeout(() => {
            router.push('/chat');
        }, 1500);
    };

    return (
        <div className="flex flex-col h-full overflow-y-auto">
            <div className="p-4">
                <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2 text-muted-foreground">
                    <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
                    Back
                </Button>
            </div>

            <div className="flex-1 flex justify-center items-center px-4 pb-20">
                <div className="max-w-md w-full bg-card border border-border rounded-xl shadow-lg p-6 md:p-8">
                    <div className="text-center mb-6">
                        <h1 className="text-2xl font-bold">Checkout</h1>
                        <p className="text-muted-foreground">Complete your subscription</p>
                    </div>

                    <div className="bg-muted/50 rounded-lg p-4 mb-6 border border-border/50">
                        <div className="flex justify-between items-baseline mb-2">
                            <h2 className="text-lg font-bold">{plan.name} Plan</h2>
                            <span className="text-xl font-bold">${plan.price}<span className="text-sm font-normal text-muted-foreground">/mo</span></span>
                        </div>
                        <ul className="space-y-2">
                            {plan.features.map((feature, i) => (
                                <li key={i} className="flex items-center text-sm text-muted-foreground gap-2">
                                    <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} className="text-primary shrink-0" />
                                    {feature}
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className="space-y-4">
                        <div className="flex justify-between text-sm">
                            <span>Subtotal</span>
                            <span>${plan.price.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span>Tax (Est.)</span>
                            <span>$0.00</span>
                        </div>
                        <div className="border-t border-border pt-4 flex justify-between font-bold text-lg">
                            <span>Total</span>
                            <span>${plan.price.toFixed(2)}</span>
                        </div>
                    </div>

                    <div className="mt-8">
                        <Button size="lg" className="w-full font-bold" onClick={handleSubscribe}>
                            Proceed to Payment
                        </Button>
                        <p className="text-xs text-center text-muted-foreground mt-4">
                            By clicking Proceed, you agree to our Terms & Conditions.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function CheckoutPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-full">Loading checkout...</div>}>
            <CheckoutContent />
        </Suspense>
    );
}
