import { LandingHeader } from '@/components/ui/landing-header';
import { LandingFooter } from '@/components/ui/landing-footer';
import { Sparkles, Zap, Brain, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function Spark() {
    return (
        <div className="min-h-screen bg-black">
            <LandingHeader />

            <main className="pt-24 pb-16">
                <div className="container mx-auto px-4">
                    {/* Hero */}
                    <div className="text-center mb-16">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/20 mb-6">
                            <Sparkles className="w-8 h-8 text-primary" />
                        </div>
                        <h1 className="text-4xl md:text-6xl font-bold text-white mb-4">
                            Tripplet Spark
                        </h1>
                        <p className="text-xl text-white/60 max-w-2xl mx-auto">
                            Your AI-powered creative assistant that helps you generate ideas, write content, and solve problems with ease.
                        </p>
                    </div>

                    {/* Features Grid */}
                    <div className="grid md:grid-cols-3 gap-6 mb-16">
                        <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
                            <Zap className="w-8 h-8 text-primary mb-4" />
                            <h3 className="text-xl font-semibold text-white mb-2">Lightning Fast</h3>
                            <p className="text-white/60">Get instant responses powered by cutting-edge AI models.</p>
                        </div>
                        <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
                            <Brain className="w-8 h-8 text-primary mb-4" />
                            <h3 className="text-xl font-semibold text-white mb-2">Context Aware</h3>
                            <p className="text-white/60">Understands context and maintains coherent conversations.</p>
                        </div>
                        <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
                            <MessageSquare className="w-8 h-8 text-primary mb-4" />
                            <h3 className="text-xl font-semibold text-white mb-2">Natural Conversations</h3>
                            <p className="text-white/60">Chat naturally like you would with a human assistant.</p>
                        </div>
                    </div>

                    {/* CTA */}
                    <div className="text-center">
                        <Link href="/chat">
                            <Button size="lg" className="bg-primary hover:bg-primary/90">
                                Try Tripplet Spark
                            </Button>
                        </Link>
                    </div>
                </div>
            </main>

            <LandingFooter />
        </div>
    );
}
