'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { loadSettings, updateSetting, applySettings, SETTINGS_EVENT } from '@/lib/settings';
import { HugeiconsIcon } from '@hugeicons/react';
import { Loading01Icon } from '@hugeicons/core-free-icons';
import MemoryPanel from '@/components/settings/MemoryPanel';

type ThemeId = string;

interface ThemeOption {
    id: ThemeId;
    label: string;
    description: string;
    preview: { bg: string; fg: string; accent: string };
}

const THEMES: ThemeOption[] = [
    {
        id: 'white',
        label: 'White',
        description: 'Pure white. Default.',
        preview: { bg: '#ffffff', fg: '#0a0a0a', accent: '#a1a1aa' },
    },
    {
        id: 'midnight',
        label: 'Midnight',
        description: 'Pure black, pure white.',
        preview: { bg: '#000000', fg: '#ffffff', accent: '#ffffff' },
    },
    {
        id: 'dark',
        label: 'Dark',
        description: 'Classic dark mode.',
        preview: { bg: '#0a0a0a', fg: '#f5f5f5', accent: '#8350e8' },
    },
];

export default function SettingsPage() {
    const { user, isLoading, refreshUser } = useAuth();

    const [activeTheme, setActiveTheme] = useState<ThemeId>('white');

    const [name, setName] = useState('');
    const [savingName, setSavingName] = useState(false);

    const [newEmail, setNewEmail] = useState('');
    const [emailPassword, setEmailPassword] = useState('');
    const [savingEmail, setSavingEmail] = useState(false);

    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [savingPassword, setSavingPassword] = useState(false);

    useEffect(() => {
        const s = loadSettings();
        const initialTheme = s.theme || 'white';
        setActiveTheme(initialTheme);

        const onChange = () => {
            const fresh = loadSettings();
            if (fresh.theme) {
                setActiveTheme(fresh.theme as ThemeId);
            }
        };
        window.addEventListener(SETTINGS_EVENT, onChange);
        return () => window.removeEventListener(SETTINGS_EVENT, onChange);
    }, []);

    useEffect(() => {
        if (user?.name) setName(user.name);
    }, [user?.name]);

    const pickTheme = (id: ThemeId) => {
        setActiveTheme(id);
        applySettings(updateSetting('theme', id));
    };

    const saveName = async () => {
        if (!user) return;
        setSavingName(true);
        try {
            const res = await fetch('/api/user/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to update name');
            }
            await refreshUser();
            toast.success('Display name updated');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to update name');
        } finally {
            setSavingName(false);
        }
    };

    const saveEmail = async () => {
        if (!newEmail || !emailPassword) {
            toast.error('Enter a new email and your current password');
            return;
        }
        setSavingEmail(true);
        try {
            const res = await fetch('/api/user/email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: newEmail, password: emailPassword }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Failed to update email');
            await refreshUser();
            setEmailPassword('');
            setNewEmail('');
            toast.success('Email updated');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to update email');
        } finally {
            setSavingEmail(false);
        }
    };

    const savePassword = async () => {
        if (!currentPassword || !newPassword) {
            toast.error('Fill in both password fields');
            return;
        }
        if (newPassword !== confirmPassword) {
            toast.error('New passwords do not match');
            return;
        }
        if (newPassword.length < 8) {
            toast.error('Password must be at least 8 characters');
            return;
        }
        setSavingPassword(true);
        try {
            const res = await fetch('/api/user/password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Failed to update password');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            toast.success('Password updated');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to update password');
        } finally {
            setSavingPassword(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-8">
                <HugeiconsIcon icon={Loading01Icon} className="animate-spin text-muted-foreground" size={24} />
            </div>
        );
    }

    if (!user) {
        return (
            <div className="p-8 text-center text-muted-foreground">
                Sign in to access your settings.
            </div>
        );
    }

    return (
        <div className="h-full w-full overflow-y-auto bg-background">
            <div className="flex flex-col max-w-2xl mx-auto p-6 md:p-10 space-y-10 animate-in fade-in duration-300">
            <header className="space-y-1.5">
                <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
                <p className="text-sm text-muted-foreground">
                    Manage your account and how Tripplet looks.
                </p>
            </header>

            <section className="space-y-4">
                <div>
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Appearance</h2>
                    <p className="text-xs text-muted-foreground mt-1">Choose how Tripplet looks across the app.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {THEMES.map(t => {
                        const active = activeTheme === t.id;
                        return (
                            <button
                                key={t.id}
                                type="button"
                                onClick={() => pickTheme(t.id)}
                                className={`group flex flex-col gap-3 rounded-xl border p-3 text-left transition-all ${
                                    active
                                        ? 'border-foreground/60 ring-2 ring-foreground/20 shadow-sm'
                                        : 'border-border hover:border-foreground/30'
                                }`}
                                aria-pressed={active}
                            >
                                <div
                                    className="relative h-20 w-full rounded-lg overflow-hidden border border-border"
                                    style={{ background: t.preview.bg }}
                                >
                                    <div
                                        className="absolute left-2 top-2 right-6 h-2 rounded-full"
                                        style={{ background: t.preview.fg, opacity: 0.85 }}
                                    />
                                    <div
                                        className="absolute left-2 top-6 right-12 h-1.5 rounded-full"
                                        style={{ background: t.preview.fg, opacity: 0.5 }}
                                    />
                                    <div
                                        className="absolute left-2 bottom-2 h-3 w-3 rounded-full"
                                        style={{ background: t.preview.accent }}
                                    />
                                </div>
                                <div className="flex items-baseline justify-between gap-2">
                                    <span className="text-sm font-medium">{t.label}</span>
                                    {active && (
                                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                            Active
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground -mt-1">{t.description}</p>
                            </button>
                        );
                    })}
                </div>
            </section>

            <section className="space-y-4">
                <div>
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Account</h2>
                    <p className="text-xs text-muted-foreground mt-1">Update your display name, email, and password.</p>
                </div>

                <div className="space-y-6 rounded-xl border border-border p-5">
                    <div className="space-y-2">
                        <label className="text-sm font-medium" htmlFor="settings-name">Display name</label>
                        <div className="flex gap-2">
                            <Input
                                id="settings-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Your name"
                            />
                            <Button onClick={saveName} disabled={savingName || name === (user.name || '')}>
                                {savingName && <HugeiconsIcon icon={Loading01Icon} className="animate-spin mr-2" size={14} />}
                                Save
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Email</label>
                        <p className="text-xs text-muted-foreground">
                            Current: <span className="font-mono">{user.email}</span>
                        </p>
                        <Input
                            type="email"
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            placeholder="new@example.com"
                            autoComplete="email"
                        />
                        <Input
                            type="password"
                            value={emailPassword}
                            onChange={(e) => setEmailPassword(e.target.value)}
                            placeholder="Current password"
                            autoComplete="current-password"
                        />
                        <Button onClick={saveEmail} disabled={savingEmail || !newEmail || !emailPassword}>
                            {savingEmail && <HugeiconsIcon icon={Loading01Icon} className="animate-spin mr-2" size={14} />}
                            Change email
                        </Button>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium" htmlFor="settings-password-current">Password</label>
                        <Input
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            placeholder="Current password"
                            autoComplete="current-password"
                        />
                        <Input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="New password (min 8 chars)"
                            autoComplete="new-password"
                        />
                        <Input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Confirm new password"
                            autoComplete="new-password"
                        />
                        <Button onClick={savePassword} disabled={savingPassword || !currentPassword || !newPassword}>
                            {savingPassword && <HugeiconsIcon icon={Loading01Icon} className="animate-spin mr-2" size={14} />}
                            Change password
                        </Button>
                    </div>
                </div>
            </section>

            <MemoryPanel />
        </div>
        </div>
    );
}
