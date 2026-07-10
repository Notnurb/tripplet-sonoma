import { notFound } from 'next/navigation';
import { OUTAGE_ACTIVE } from '@/lib/outage';
import DevPasswordGate from '@/components/Sonoma/DevPasswordGate';

// This page only exists while the site-wide outage is active — it's a
// stopgap so someone can still drive a chat model (via their own Groq key)
// while the real backend is down. Once OUTAGE_ACTIVE flips back to false,
// the route disappears entirely (404), not just visually hidden.
export default function DevPage() {
    if (!OUTAGE_ACTIVE) notFound();
    return <DevPasswordGate />;
}
