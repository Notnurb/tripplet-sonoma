'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Camera01Icon, Loading01Icon } from '@hugeicons/core-free-icons';

export default function ProfilePage() {
    const { user, isLoading: authLoading, refreshUser } = useAuth();

    // Local state for form
    const [name, setName] = useState('');
    const [bio, setBio] = useState('');
    const [image, setImage] = useState('');
    const [previewImage, setPreviewImage] = useState('');

    const [isSaving, setIsSaving] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Initialize form with user data
    useEffect(() => {
        if (user) {
            setName(user.name || '');
            setBio(user.bio || '');
            setImage(user.image || '');
            setPreviewImage(user.image || '');
        }
    }, [user]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Max size check (e.g., 2MB) before processing, but we will resize/compress anyway
        if (file.size > 5 * 1024 * 1024) {
            toast.error("Image too large", { description: "Please upload an image smaller than 5MB." });
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            setPreviewImage(result); // Show immediately

            // Resize image to max 400x400 to keep base64 string reasonable
            const img = new Image();
            img.src = result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const maxSize = 400;

                if (width > height) {
                    if (width > maxSize) {
                        height *= maxSize / width;
                        width = maxSize;
                    }
                } else {
                    if (height > maxSize) {
                        width *= maxSize / height;
                        height = maxSize;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(img, 0, 0, width, height);

                // Compress to jpeg with 0.8 quality
                const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);
                setImage(compressedBase64);
            };
        };
        reader.readAsDataURL(file);
    };

    const handleSave = async () => {
        if (!user) return;
        setIsSaving(true);
        try {
            const res = await fetch('/api/user/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    bio,
                    image, // This is the base64 string
                }),
            });

            if (!res.ok) {
                throw new Error('Failed to update profile');
            }

            await res.json();
            toast.success("Profile updated");

            // Refresh user state from the server
            await refreshUser();

        } catch (error) {
            console.error(error);
            toast.error("Failed to update profile");
        } finally {
            setIsSaving(false);
        }
    };

    if (authLoading) {
        return (
            <div className="flex items-center justify-center p-8">
                <HugeiconsIcon icon={Loading01Icon} className="animate-spin text-muted-foreground" size={24} />
            </div>
        );
    }

    if (!user) {
        return <div className="p-8 text-center text-muted-foreground">Please sign in to view your profile.</div>;
    }

    const initials = name
        ? name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
        : user.email.substring(0, 2).toUpperCase();

    return (
        <div className="h-full w-full overflow-y-auto bg-background">
            <div className="flex-1 w-full max-w-none p-6 md:p-10 animate-in fade-in duration-500 min-h-[calc(100vh-4rem)]">
            <div className="max-w-6xl mx-auto space-y-8">
                <div className="space-y-2 border-b border-border pb-6">
                    <h1 className="text-3xl font-bold tracking-tight">Profile & Identity</h1>
                    <p className="text-muted-foreground">
                        Manage your public profile, bio, and identity settings.
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-10 items-start">
                    {/* Left Column - Avatar & Identity */}
                    <div className="flex flex-col gap-6 p-6 rounded-2xl border border-border bg-card/50 shadow-sm">
                        <div className="flex flex-col items-center gap-4">
                            <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                                <Avatar className="h-32 w-32 border-4 border-background shadow-lg transition-opacity group-hover:opacity-80">
                                    <AvatarImage src={previewImage} alt={name} className="object-cover" />
                                    <AvatarFallback className="text-3xl">{initials}</AvatarFallback>
                                </Avatar>
                                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                    <HugeiconsIcon icon={Camera01Icon} size={28} />
                                </div>
                            </div>
                            <div className="text-center space-y-1">
                                <h3 className="font-semibold text-xl text-foreground">{name || 'Your Name'}</h3>
                                <p className="text-sm text-muted-foreground truncate max-w-[250px]" title={user.email}>{user.email}</p>
                            </div>
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleFileChange}
                        />
                        <div className="pt-5 mt-2 border-t border-border">
                            <p className="text-xs text-muted-foreground text-center">
                                JPG, PNG or GIF. Max 5MB. Avatar updates immediately on save.
                            </p>
                        </div>
                    </div>

                    {/* Right Column - Details & Options */}
                    <div className="space-y-10">
                        {/* Basic Info */}
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-medium mb-5 text-foreground">Basic Information</h3>
                                <div className="grid gap-6">
                                    <div className="grid gap-2">
                                        <label htmlFor="name" className="text-sm font-medium leading-none text-foreground/90">
                                            Display Name
                                        </label>
                                        <Input
                                            id="name"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            placeholder="What should we call you?"
                                            className="max-w-md bg-muted/30 border-border focus-visible:ring-brand"
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <label htmlFor="bio" className="text-sm font-medium leading-none text-foreground/90">
                                            Biography
                                        </label>
                                        <Textarea
                                            id="bio"
                                            value={bio}
                                            onChange={(e) => setBio(e.target.value)}
                                            placeholder="Tell us a little bit about yourself, your interests, or what you're working on."
                                            className="resize-none h-40 max-w-2xl bg-muted/30 leading-relaxed border-border focus-visible:ring-brand"
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            This will be displayed on your public profile and helps the AI understand you better.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Additional Options (Mocked for UI) */}
                            <div className="pt-8 border-t border-border/60">
                                <h3 className="text-lg font-medium mb-5 text-foreground">Profile Visibility</h3>
                                <div className="space-y-4 max-w-2xl">
                                    <div className="flex items-start gap-4 p-4 rounded-xl border border-border/60 bg-muted/10 hover:bg-muted/20 transition-colors">
                                        <div className="flex h-5 items-center">
                                            <input type="checkbox" id="public" defaultChecked className="h-4 w-4 rounded border-border text-brand focus:ring-brand cursor-pointer" />
                                        </div>
                                        <div className="grid gap-1.5 cursor-pointer">
                                            <label htmlFor="public" className="text-sm font-medium leading-none cursor-pointer">
                                                Public Profile
                                            </label>
                                            <p className="text-sm text-muted-foreground leading-relaxed">
                                                Allow others to view your profile and shared creations on Tripplet.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-4 p-4 rounded-xl border border-border/60 bg-muted/10 hover:bg-muted/20 transition-colors">
                                        <div className="flex h-5 items-center">
                                            <input type="checkbox" id="activity" defaultChecked className="h-4 w-4 rounded border-border text-brand focus:ring-brand cursor-pointer" />
                                        </div>
                                        <div className="grid gap-1.5 cursor-pointer">
                                            <label htmlFor="activity" className="text-sm font-medium leading-none cursor-pointer">
                                                Show Activity Status
                                            </label>
                                            <p className="text-sm text-muted-foreground leading-relaxed">
                                                Display when you were last active and the tools you frequently use.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Save Action */}
                        <div className="flex items-center gap-5 pt-8 mt-4 border-t border-border/80">
                            <Button
                                onClick={handleSave}
                                disabled={isSaving}
                                className="bg-brand text-brand-foreground hover:bg-brand/90 px-8 py-2.5 h-auto text-sm font-medium transition-all shadow-sm rounded-lg"
                            >
                                {isSaving ? (
                                    <>
                                        <HugeiconsIcon icon={Loading01Icon} className="animate-spin mr-2" size={16} />
                                        Saving Changes...
                                    </>
                                ) : (
                                    'Save Profile'
                                )}
                            </Button>
                            <p className="text-xs text-muted-foreground/80">
                                All changes are saved securely to your account.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        </div>
    );
}
