import type { Metadata } from 'next'
import { Hero } from '@/components/cli/Hero'
import { QuoteSection } from '@/components/cli/QuoteSection'

export const metadata: Metadata = {
    title: 'Serene — Gentle touch. Radiant presence.',
    description: 'Expert beauty and holistic wellness, delivered with warmth and intention.',
}

export default function CliPage() {
    return (
        <div className="cli-root font-inter bg-[#0a0608]">
            <Hero />
            <QuoteSection />
        </div>
    )
}
