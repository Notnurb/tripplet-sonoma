import type { ReactNode } from 'react'
import { Dancing_Script, Instrument_Serif, Inter } from 'next/font/google'
import './cli.css'

// The source project loads these three families from a <link> in index.html.
// Here they go through next/font, which self-hosts the files — the app's CSP
// is `font-src 'self'`, so fonts.gstatic.com would be blocked outright.
const dancingScript = Dancing_Script({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700'],
    variable: '--font-cli-cursive',
    display: 'swap',
})

const instrumentSerif = Instrument_Serif({
    subsets: ['latin'],
    weight: '400',
    style: ['normal', 'italic'],
    variable: '--font-cli-instrument',
    display: 'swap',
})

const inter = Inter({
    subsets: ['latin'],
    weight: ['300', '400', '500', '600', '700', '800', '900'],
    variable: '--font-cli-inter',
    display: 'swap',
})

export default function CliLayout({ children }: { children: ReactNode }) {
    return (
        <div className={`${dancingScript.variable} ${instrumentSerif.variable} ${inter.variable}`}>
            {children}
        </div>
    )
}
