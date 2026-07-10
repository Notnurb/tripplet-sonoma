'use client';

import React, { useState, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useRouter, useSearchParams } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { Loading01Icon } from '@hugeicons/core-free-icons';
import { Eye, EyeOff } from 'lucide-react';

function ResetPasswordForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get('token');

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!token) {
            toast.error("Missing reset token");
            return;
        }

        if (password !== confirmPassword) {
            toast.error("Passwords do not match");
            return;
        }

        if (password.length < 8) {
            toast.error("Password must be at least 8 characters");
            return;
        }

        setIsLoading(true);
        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password }),
            });

            const data = await res.json();

            if (!res.ok) {
                toast.error(data.error || "Failed to reset password");
                return;
            }

            toast.success("Password reset successfully");
            router.push('/login');
        } catch (error) {
            console.error(error);
            toast.error("Something went wrong. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    if (!token) {
        return (
            <div className="text-center text-destructive p-4 border border-destructive/20 bg-destructive/5 rounded-xl">
                Invalid or missing reset token. Please request a new link.
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4 w-full">
            <div className="space-y-2">
                <div className="relative">
                    <Input
                        type={showPassword ? "text" : "password"}
                        placeholder="New Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="h-11 pr-10"
                    />
                    <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                    >
                        {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                    </button>
                </div>
            </div>
            <div className="space-y-2">
                <Input
                    type="password"
                    placeholder="Confirm New Password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="h-11"
                />
            </div>
            <Button type="submit" className="w-full h-11" disabled={isLoading}>
                {isLoading && <HugeiconsIcon icon={Loading01Icon} className="animate-spin mr-2" size={16} />}
                Reset Password
            </Button>
        </form>
    );
}

export default function ResetPasswordPage() {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center p-6 bg-background">
            <div className="w-full max-w-sm space-y-6">
                <div className="flex flex-col space-y-2 text-center">
                    <h1 className="text-2xl font-semibold tracking-tight">Reset Password</h1>
                    <p className="text-sm text-muted-foreground">
                        Enter your new password below.
                    </p>
                </div>

                {/* Suspense boundary required for useSearchParams */}
                <Suspense fallback={<div className="flex justify-center"><HugeiconsIcon icon={Loading01Icon} className="animate-spin" /></div>}>
                    <ResetPasswordForm />
                </Suspense>
            </div>
        </div>
    );
}
