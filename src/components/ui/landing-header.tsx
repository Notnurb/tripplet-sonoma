'use client';

// Marketing-page navigation. The old sticky bar was replaced by the
// homepage's liquid-glass pill nav — this wrapper keeps the existing
// `LandingHeader` imports across the marketing pages working.

import { GlassNav } from '@/components/ui/glass-nav';

export function LandingHeader() {
    return <GlassNav />;
}
