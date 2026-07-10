import type { Metadata, Viewport } from "next";
import { Outfit, Geist, Newsreader, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { APP_NAME, APP_TAGLINE, APP_DESCRIPTION } from "@/lib/branding";
import { Providers } from "./providers";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const outfit = Outfit({
    subsets: ['latin'],
    variable: '--font-outfit',
    display: 'swap',
});

const geist = Geist({
    subsets: ['latin'],
    variable: '--font-geist',
    weight: ['400', '500', '600'],
    display: 'swap',
});

const newsreader = Newsreader({
    subsets: ['latin'],
    variable: '--font-newsreader',
    weight: ['400', '500'],
    style: ['normal', 'italic'],
    display: 'swap',
});

const jetbrains = JetBrains_Mono({
    subsets: ['latin'],
    variable: '--font-jetbrains',
    weight: ['400', '500'],
    display: 'swap',
});

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    // Allow pinch-zoom for accessibility; don't lock it down.
    maximumScale: 5,
    viewportFit: "cover",
    // Shrink the viewport when the on-screen keyboard opens so the pinned
    // composer rides above it instead of hiding behind it.
    interactiveWidget: "resizes-content",
    themeColor: [
        { media: "(prefers-color-scheme: light)", color: "#ffffff" },
        { media: "(prefers-color-scheme: dark)", color: "#000000" },
    ],
};

export const metadata: Metadata = {
    title: `${APP_NAME} — ${APP_TAGLINE}`,
    description: APP_DESCRIPTION,
    icons: {
        icon: [{ url: '/logo.png' }],
        shortcut: [{ url: '/logo.png' }],
        apple: [{ url: '/logo.png' }],
    },
    openGraph: {
        title: `${APP_NAME} — ${APP_TAGLINE}`,
        description: APP_DESCRIPTION,
        type: "website",
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html
            lang="en"
            suppressHydrationWarning
            className={cn(outfit.variable, geist.variable, newsreader.variable, jetbrains.variable)}
        >
            <body className={cn("min-h-screen bg-background font-sans antialiased")}>
                <Providers>{children}</Providers>
                <Analytics />
                <SpeedInsights />
            </body>
        </html>
    );
}
