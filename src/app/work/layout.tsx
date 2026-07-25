import type { Metadata } from 'next';
import { Instrument_Serif, Inter } from 'next/font/google';

// Instrument Serif + Inter, self-hosted by next/font. The spec's Google Fonts
// <link> would be dropped by the site CSP (style-src / font-src are both
// 'self'-only), and next/font produces the same faces without loosening it.
const instrumentSerif = Instrument_Serif({
    subsets: ['latin'],
    variable: '--font-instrument',
    weight: ['400'],
    style: ['normal', 'italic'],
    display: 'swap',
});

const inter = Inter({
    subsets: ['latin'],
    variable: '--font-inter',
    weight: ['300', '400', '500', '600'],
    display: 'swap',
});

export const metadata: Metadata = {
    title: 'Atelier — UX and App Design for Bold Ventures',
    description: 'We shape digital products that define brands and unlock exponential growth.',
};

export default function WorkLayout({ children }: { children: React.ReactNode }) {
    return (
        // Inter is scoped here instead of overriding the global --font-sans, so
        // the rest of the site keeps its own typeface.
        <div
            className={`${instrumentSerif.variable} ${inter.variable}`}
            style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif' }}
        >
            {children}
        </div>
    );
}
