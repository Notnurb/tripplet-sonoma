import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { isDevModeActive } from '@/lib/dev-mode'

const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.groq.com https://*.spline.io https://*.e2b.dev https://www.clarity.ms https://*.clarity.ms https://va.vercel-scripts.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // en.wikipedia.org: the Triplepedia batch grabber (/tgrablockbatch) calls
    // the Wikipedia Action API directly from the browser (link finder + turbo).
    "connect-src 'self' https://api.groq.com https://opencode.ai https://*.e2b.dev https://*.spline.io wss://*.e2b.dev https://www.clarity.ms https://*.clarity.ms https://vitals.vercel-insights.com https://en.wikipedia.org",
    "frame-src 'self' https://*.spline.io https://*.e2b.dev",
    // d8j0ntlcm91z4.cloudfront.net: background video on the /cli landing page.
    "media-src 'self' https://d8j0ntlcm91z4.cloudfront.net",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
].join('; ')

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl

    if (pathname.startsWith('/api')) {
        const response = NextResponse.next()
        response.headers.set('X-Content-Type-Options', 'nosniff')
        response.headers.set('X-Frame-Options', 'DENY')
        response.headers.set('X-XSS-Protection', '0')
        response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
        response.headers.set('Content-Security-Policy', CSP)
        return response
    }

    const publicPaths = [
        '/',
        '/about',
        '/blog',
        '/changelog',
        // MCP OAuth: discovery metadata and the consent screen must be reachable
        // pre-auth. The consent page handles the "not signed in" case itself
        // (and preserves the OAuth params); the /api/mcp + /api/oauth routes do
        // their own bearer/PKCE auth. See src/lib/mcp/*.
        '/.well-known',
        '/oauth',
        '/mcp',
        // OpenSonoma installer — must be reachable by an unauthenticated
        // `curl ... | bash`. Covers /installconnect and /installconnect.sh.
        '/installconnect',
        // Astrocode CLI installer — must be reachable by an unauthenticated
        // `curl ... | bash`. Covers /installcli and /installcli.sh.
        '/installcli',
        // Tripplet Sandboxed Linux (v86) runtime + guest image assets.
        '/v86',
        // Sonoma workspace — usable without an account (guest mode).
        // These all render the guest-capable ChatShell backed by /api/sonoma.
        '/chat',
        // Serene landing page — a public marketing page, no account involved.
        '/cli',
        '/code',
        '/dev',
        '/hyperagent',
        '/features',
        '/forgot-password',
        '/login',
        '/privacy',
        '/register',
        '/reset-password',
        '/sign-in',
        '/site-map',
        '/terms',
        // Crawlers hit these unauthenticated — must never redirect to /login.
        '/sitemap.xml',
        '/sitemap',
        '/sitemap.txt',
        '/robots.txt',
        // Atelier hero — a standalone public landing page, no account involved.
        '/work',
        // Triplepedia is a public knowledge base: reading, searching and
        // exploring articles must not require an account (its GET APIs are
        // already public + rate-limited). Import tools (/tgrablockbatch)
        // stay auth-gated.
        '/triplepedia',
    ]

    const isPublicPath = publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))
    const isAuthed = await hasValidAuthCookie(request)

    if (isAuthed && (pathname.startsWith('/login') || pathname.startsWith('/register') || pathname === '/sign-in')) {
        const url = request.nextUrl.clone()
        url.pathname = '/chat'
        return NextResponse.redirect(url)
    }

    // Dev-mode login bypass (src/lib/dev-mode.ts, dev server only): private
    // pages render as the Tripplet Dev account instead of bouncing to /login.
    // /login itself stays reachable so real accounts can still be tested.
    if (!isAuthed && !isPublicPath && !isDevModeActive()) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

    const response = NextResponse.next()
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('X-Frame-Options', 'DENY')
    response.headers.set('X-XSS-Protection', '0')
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    response.headers.set('Content-Security-Policy', CSP)
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    return response
}

async function hasValidAuthCookie(request: NextRequest): Promise<boolean> {
    // auth_token JWT cookie — verified fully (Edge-safe via jose).
    const token = request.cookies.get('auth_token')?.value
    const secret = process.env.JWT_SECRET
    if (token && secret) {
        try {
            await jwtVerify(token, new TextEncoder().encode(secret), {
                algorithms: ['HS256'],
            })
            return true
        } catch {
            // invalid/expired — treat as signed out
        }
    }
    return false
}

export const config = {
    matcher: [
        // dmg: the Tripplet Work desktop download (/TrippletWork.dmg) is a
        // static asset — without it here the middleware bounces signed-out
        // visitors to /login instead of serving the file.
        '/((?!_next|[^?]*\\.(?:html?|css|sh|gz|tgz|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|dmg|webmanifest|mp4|m4v|webm|mov)).*)',
        '/(api|trpc)(.*)',
    ],
}
