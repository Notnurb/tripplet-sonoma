'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { Loading01Icon, ArrowLeft01Icon } from '@hugeicons/core-free-icons';

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSubmitted, setIsSubmitted] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;

        setIsLoading(true);
        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });

            if (!res.ok) {
                // Determine error message? Security best practice says don't reveal too much.
                // But generally for forgot password we just say "If key exists..."
                // But the API might fail.
            }

            // Always show success to user to prevent enumeration (and UI simplicity)
            setIsSubmitted(true);
            toast.success("Reset link sent", {
                description: "If an account exists with this email, you will receive a reset link."
            });
        } catch (error) {
            console.error(error);
            toast.error("Something went wrong. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen flex-col items-center justify-center p-6 bg-background">
            <div className="w-full max-w-sm space-y-6">
                <div className="flex flex-col space-y-2 text-center">
                    <h1 className="text-2xl font-semibold tracking-tight">Forgot Password</h1>
                    <p className="text-sm text-muted-foreground">
                        Enter your email address and we&apos;ll send you a link to reset your password.
                    </p>
                </div>

                {isSubmitted ? (
                    <div className="flex flex-col space-y-4 items-center text-center p-6 border border-border rounded-xl bg-muted/30">
                        <p className="text-sm">
                            Check your email for a reset link. Be sure to check your spam folder.
                        </p>
                        <Button asChild variant="outline" className="w-full">
                            <Link href="/login">Back to Login</Link>
                        </Button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Input
                                type="email"
                                placeholder="name@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="h-11"
                            />
                        </div>
                        <Button type="submit" className="w-full h-11" disabled={isLoading}>
                            {isLoading && <HugeiconsIcon icon={Loading01Icon} className="animate-spin mr-2" size={16} />}
                            Send Reset Link
                        </Button>
                    </form>
                )}

                <div className="text-center">
                    <Link href="/login" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors">
                        <HugeiconsIcon icon={ArrowLeft01Icon} size={16} className="mr-1" />
                        Back to Login
                    </Link>
                </div>
            </div>
        </div>
    );
}
