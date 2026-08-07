'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { GlassNav } from '@/components/ui/glass-nav'

const INSTALL_COMMANDS = {
    unix: 'curl -fsSL https://getsonoma.lol/installcli | bash',
    windows: 'irm https://getsonoma.lol/installcli.ps1 | iex',
} as const

type InstallVariant = keyof typeof INSTALL_COMMANDS

const HERO_VIDEO =
    'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260613_180732_a54afbf6-b30d-470e-861f-669871f09f67.mp4'

function CopyInstallCommand({ className = '' }: { className?: string }) {
    const [variant, setVariant] = useState<InstallVariant>('unix')
    const [copied, setCopied] = useState(false)

    const command = INSTALL_COMMANDS[variant]

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(command)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch {
            // Clipboard API unavailable (insecure context, permissions) — no-op.
        }
    }

    return (
        <div className={`flex flex-col items-center gap-3 ${className}`}>
            <div className="liquid-glass flex items-center gap-1 rounded-full p-1">
                {(
                    [
                        ['unix', 'macOS / Linux'],
                        ['windows', 'Windows'],
                    ] as const
                ).map(([key, label]) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => {
                            setVariant(key)
                            setCopied(false)
                        }}
                        aria-pressed={variant === key}
                        className={`rounded-full px-3.5 py-1.5 text-[11px] transition-colors duration-300 md:text-xs ${
                            variant === key
                                ? 'bg-white/[0.08] text-white'
                                : 'text-white/50 hover:text-white/80'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy install command"
                className="liquid-glass group flex w-full max-w-md items-center justify-between gap-3 rounded-full px-6 py-3.5 text-left transition-all duration-300 hover:bg-white/[0.04]"
            >
                <code className="font-inter truncate text-xs text-white/80 md:text-sm">{command}</code>
                {copied ? (
                    <Check className="h-4 w-4 shrink-0 text-white" />
                ) : (
                    <Copy className="h-4 w-4 shrink-0 text-white/60 transition-colors duration-300 group-hover:text-white" />
                )}
            </button>
        </div>
    )
}

export function Hero() {
    return (
        <section className="relative h-screen w-full overflow-hidden">
            <video
                className="absolute inset-0 h-full w-full object-cover"
                src={HERO_VIDEO}
                autoPlay
                muted
                loop
                playsInline
            />

            <div className="absolute inset-0 bg-black/20" />

            <GlassNav tone="dark" />

            <div className="absolute inset-0 -mt-[120px] flex flex-col items-center justify-center px-6">
                <h1 className="font-instrument text-glow text-center text-[36px] leading-[0.9] tracking-tight text-white md:text-7xl lg:text-[110px]">
                    Code at the speed of thought
                </h1>

                <p className="mt-5 max-w-xl text-center text-sm text-white/70 md:mt-7 md:text-base">
                    Code at the speed of thought, right inside your terminal, with the models you love.
                </p>

                <CopyInstallCommand className="mt-6 md:mt-9" />
            </div>

        </section>
    )
}
