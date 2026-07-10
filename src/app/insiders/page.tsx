"use client"

import { useState } from 'react';
import { LandingHeader } from '@/components/ui/landing-header';
import { LandingFooter } from '@/components/ui/landing-footer';
import { Star, Gift, Bell, Users, Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { toast } from 'sonner';

export default function InsidersProgram() {
    const [email, setEmail] = useState('');
    const [isJoined, setIsJoined] = useState(false);

    const handleJoin = (e: React.FormEvent) => {
        e.preventDefault();
        if (!email.includes('@')) {
            toast.error("Please enter a valid email address.");
            return;
        }
        setIsJoined(true);
        toast.success("Welcome to Insiders!", {
            description: "You now have access to AI Studio.",
        });
    };

    return (
        <div className="min-h-screen bg-black">
            <LandingHeader />

            <main className="pt-24 pb-16">
                <div className="container mx-auto px-4">
                    {/* Hero */}
                    <div className="text-center mb-16">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/20 mb-6">
                            <Star className="w-8 h-8 text-primary" />
                        </div>
                        <h1 className="text-4xl md:text-6xl font-bold text-white mb-4">
                            Tripplet Insiders Program
                        </h1>
                        <p className="text-xl text-white/60 max-w-2xl mx-auto">
                            Get early access to new features, exclusive content, and direct input on the future of Tripplet.
                        </p>
                    </div>

                    {/* Signup Form */}
                    {!isJoined ? (
                        <div className="max-w-md mx-auto mb-16">
                            <div className="p-8 rounded-2xl bg-white/5 border border-white/10">
                                <h2 className="text-2xl font-bold text-white mb-2 text-center">Join Now</h2>
                                <p className="text-white/60 text-center mb-6">Enter your email to get instant access to AI Studio</p>
                                <form onSubmit={handleJoin} className="space-y-4">
                                    <Input
                                        type="email"
                                        placeholder="you@example.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="bg-white/5 border-white/10 text-white placeholder:text-white/40"
                                    />
                                    <Button type="submit" size="lg" className="w-full bg-primary hover:bg-primary/90">
                                        Get Access
                                    </Button>
                                </form>
                            </div>
                        </div>
                    ) : (
                        <div className="max-w-md mx-auto mb-16">
                            <div className="p-8 rounded-2xl bg-primary/10 border border-primary/20 text-center">
                                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/20 mb-4">
                                    <Check className="w-8 h-8 text-primary" />
                                </div>
                                <h2 className="text-2xl font-bold text-white mb-2">You're In!</h2>
                                <p className="text-white/60 mb-6">You now have access to AI Studio with all insider features.</p>
                                <Link href="/studio">
                                    <Button size="lg" className="bg-primary hover:bg-primary/90">
                                        <Sparkles className="w-4 h-4 mr-2" />
                                        Open AI Studio
                                    </Button>
                                </Link>
                            </div>
                        </div>
                    )}

                    {/* Benefits Grid */}
                    <div className="grid md:grid-cols-3 gap-6">
                        <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
                            <Bell className="w-8 h-8 text-primary mb-4" />
                            <h3 className="text-xl font-semibold text-white mb-2">Early Access</h3>
                            <p className="text-white/60">Be the first to try new features before public release.</p>
                        </div>
                        <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
                            <Gift className="w-8 h-8 text-primary mb-4" />
                            <h3 className="text-xl font-semibold text-white mb-2">Exclusive Perks</h3>
                            <p className="text-white/60">Get bonus credits, special badges, and insider-only content.</p>
                        </div>
                        <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
                            <Users className="w-8 h-8 text-primary mb-4" />
                            <h3 className="text-xl font-semibold text-white mb-2">Community</h3>
                            <p className="text-white/60">Join a community of passionate AI enthusiasts and creators.</p>
                        </div>
                    </div>
                </div>
            </main>

            <LandingFooter />
        </div>
    );
}
