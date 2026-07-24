'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'

const INSTALL_COMMAND = 'curl -fsSL https://getsonoma.lol/installcli | bash'

const HERO_VIDEO =
    'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260613_180732_a54afbf6-b30d-470e-861f-669871f09f67.mp4'

const NAV_LINKS = ['About', 'Services', 'Journal', 'Contact']

/** Shared easing for the hamburger + drawer choreography. */
const EASE = 'cubic-bezier(0.22,1,0.36,1)'

function PillButton({
    children,
    className = '',
    style,
    onClick,
}: {
    children: ReactNode
    className?: string
    style?: CSSProperties
    onClick?: () => void
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={style}
            className={`button-glow rounded-full bg-white px-8 py-3.5 text-sm font-medium tracking-wide text-black transition-all duration-300 hover:bg-white/90 ${className}`}
        >
            {children}
        </button>
    )
}

function CopyInstallCommand({ className = '' }: { className?: string }) {
    const [copied, setCopied] = useState(false)

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(INSTALL_COMMAND)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch {
            // Clipboard API unavailable (insecure context, permissions) — no-op.
        }
    }

    return (
        <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy install command"
            className={`liquid-glass group flex w-full max-w-md items-center justify-between gap-3 rounded-full px-6 py-3.5 text-left transition-all duration-300 hover:bg-white/[0.04] ${className}`}
        >
            <code className="font-inter truncate text-xs text-white/80 md:text-sm">{INSTALL_COMMAND}</code>
            {copied ? (
                <Check className="h-4 w-4 shrink-0 text-white" />
            ) : (
                <Copy className="h-4 w-4 shrink-0 text-white/60 transition-colors duration-300 group-hover:text-white" />
            )}
        </button>
    )
}

export function Hero() {
    const [menuOpen, setMenuOpen] = useState(false)

    useEffect(() => {
        if (!menuOpen) return
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setMenuOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [menuOpen])

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

            <nav className="fixed left-0 right-0 top-0 z-50 flex items-center justify-between px-6 py-5 md:px-12">
                <span className="font-cursive text-2xl text-white md:text-3xl">Serene</span>

                <div className="hidden items-center gap-12 md:flex">
                    {NAV_LINKS.map((link) => (
                        <a
                            key={link}
                            href="#"
                            className="text-sm tracking-wide text-white/80 transition-colors duration-300 hover:text-white"
                        >
                            {link}
                        </a>
                    ))}
                </div>

                <div className="hidden md:block">
                    <PillButton>Book a consultation</PillButton>
                </div>

                <button
                    type="button"
                    aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((open) => !open)}
                    // z-50 keeps the animated X painted above the z-40 drawer —
                    // `relative` alone loses to any positioned sibling with a z-index.
                    className="relative z-50 h-[19.5px] w-6 md:hidden"
                >
                    <span
                        style={{ transitionTimingFunction: EASE }}
                        className={`absolute left-0 top-0 block h-[1.5px] w-full origin-center bg-white transition-all duration-500 ${menuOpen ? 'translate-y-[9px] rotate-45' : ''}`}
                    />
                    <span
                        style={{ transitionTimingFunction: EASE }}
                        className={`absolute left-0 top-[9px] block h-[1.5px] w-full origin-center bg-white transition-all duration-500 ${menuOpen ? 'scale-x-0 opacity-0' : ''}`}
                    />
                    <span
                        style={{ transitionTimingFunction: EASE }}
                        className={`absolute left-0 top-[18px] block h-[1.5px] w-full origin-center bg-white transition-all duration-500 ${menuOpen ? '-translate-y-[9px] -rotate-45' : ''}`}
                    />
                </button>

                <div
                    aria-hidden
                    onClick={() => setMenuOpen(false)}
                    style={{ transitionTimingFunction: EASE }}
                    className={`fixed inset-0 z-30 bg-black/50 transition-opacity duration-500 md:hidden ${
                        menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
                    }`}
                />

                <div
                    className={`fixed right-0 top-0 z-40 h-screen w-[85%] max-w-[340px] border-l border-white/10 bg-[#0a0608]/95 backdrop-blur-xl transition-transform duration-500 md:hidden ${
                        menuOpen ? 'translate-x-0' : 'translate-x-full'
                    }`}
                    style={{ transitionTimingFunction: EASE }}
                >
                    <div className="flex h-full flex-col justify-center gap-8 px-9">
                        {NAV_LINKS.map((link, index) => (
                            <a
                                key={link}
                                href="#"
                                onClick={() => setMenuOpen(false)}
                                className="text-2xl font-light tracking-wide text-white/90 transition-all duration-500 hover:text-white"
                                style={{
                                    opacity: menuOpen ? 1 : 0,
                                    transform: menuOpen ? 'translateX(0)' : 'translateX(28px)',
                                    transitionDelay: menuOpen ? `${150 + index * 75}ms` : '0ms',
                                    transitionTimingFunction: EASE,
                                }}
                            >
                                {link}
                            </a>
                        ))}

                        <PillButton
                            onClick={() => setMenuOpen(false)}
                            className="mt-4 self-start"
                            style={{
                                opacity: menuOpen ? 1 : 0,
                                transform: menuOpen ? 'translateX(0)' : 'translateX(28px)',
                                transitionDelay: menuOpen ? '450ms' : '0ms',
                                transitionTimingFunction: EASE,
                            }}
                        >
                            Book a consultation
                        </PillButton>
                    </div>
                </div>
            </nav>

            <div className="absolute inset-0 -mt-[120px] flex flex-col items-center justify-center px-6">
                <h1 className="font-instrument text-glow text-center text-[36px] leading-[0.9] tracking-tight text-white md:text-7xl lg:text-[110px]">
                    Code at the speed of thought
                </h1>

                <p className="mt-5 max-w-xl text-center text-sm text-white/70 md:mt-7 md:text-base">
                    Code at the speed of thought, right inside your terminal, with the models you love.
                </p>

                <CopyInstallCommand className="mt-6 md:mt-9" />
            </div>

            <div className="absolute bottom-8 left-8 hidden items-center gap-3 md:flex">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20">
                    <span className="block h-px w-3.5 bg-white/70" />
                </span>
                <span className="text-xs leading-tight text-white/60">
                    Experience
                    <br />
                    with sound
                </span>
            </div>
        </section>
    )
}
