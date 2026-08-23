'use client'

// Copy-to-clipboard for the build command.
//
// There is no signed release yet, so the page offers the real way to run the
// app today rather than a Download button that 404s. When a notarised DMG
// exists this becomes the secondary action.

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

const COMMAND = 'cd apps/tripplet-computer && npm run dev'

export function BuildCommand() {
    const [copied, setCopied] = useState(false)

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(COMMAND)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch {
            // Clipboard unavailable (insecure context or denied) — the command
            // is selectable on screen, so there is nothing to recover from.
        }
    }

    return (
        <button
            type="button"
            onClick={copy}
            aria-label="Copy the build command"
            className="tc-glass tc-glass-edge group flex w-full max-w-md items-center justify-between gap-4 rounded-full px-5 py-3 text-left transition-colors duration-300 hover:bg-white/[0.05]"
        >
            <code className="truncate font-mono text-[12.5px] text-white/75 sm:text-[13px]">
                {COMMAND}
            </code>
            {copied ? (
                <Check className="h-4 w-4 shrink-0 text-[#b388ff]" />
            ) : (
                <Copy className="h-4 w-4 shrink-0 text-white/40 transition-colors group-hover:text-white/70" />
            )}
        </button>
    )
}
