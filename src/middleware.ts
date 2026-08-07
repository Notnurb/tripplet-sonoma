import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { isDevModeActive } from '@/lib/dev-mode'

// Per-request nonce CSP. Next.js stamps its own inline scripts (streaming
// data, bootstrap) with this nonce via the x-nonce request header, so
// 'unsafe-inline' and 'unsafe-eval' are not needed. style-src keeps
// 'unsafe-inline' for SSR'd inline styles / CSS-in-JS (style injection is not
// a script-execution vector).
function pageCsp(nonce: string): string {
    return [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' https://*.groq.com https://*.spline.io https://*.e2b.dev https://www.clarity.ms https://*.clarity.ms https://va.vercel-scripts.com`,
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
}

// API responses are JSON/stream bodies — nothing is executed client-side from
// them, so script-src can be maximally strict (no nonce required).
const API_CSP = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
].join('; ')

function nonce(): string {
    // Web Crypto — available on both the Node and Edge middleware runtimes.
    return crypto.randomUUID()
}

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl

    if (pathname.startsWith('/api')) {
        const response = NextResponse.next()
        response.headers.set('X-Content-Type-Options', 'nosniff')
        response.headers.set('X-Frame-Options', 'DENY')
        response.headers.set('X-XSS-Protection', '0')
        response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
        response.headers.set('Content-Security-Policy', API_CSP)
        response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
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
        // Tripplet Work desktop installer — must be reachable by an
        // unauthenticated `curl ... | bash`. Covers /installwork and
        // /installwork.sh.
        '/installwork',
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

    const requestNonce = nonce()
    // Surface the nonce to the app so Next.js stamps its own inline scripts
    // (streaming bootstrap data) with it — otherwise they'd be blocked by CSP.
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-nonce', requestNonce)

    const response = NextResponse.next({ request: { headers: requestHeaders } })
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('X-Frame-Options', 'DENY')
    response.headers.set('X-XSS-Protection', '0')
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    response.headers.set('Content-Security-Policy', pageCsp(requestNonce))
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
        // dmg/exe: the Tripplet Work desktop downloads (/TrippletWork.dmg,
        // /TrippletWork-Setup.exe) are static assets — without them here the
        // middleware bounces signed-out visitors to /login instead of serving
        // the file, so the browser saves the login page as the "download".
        '/((?!_next|[^?]*\\.(?:html?|css|sh|ps1|gz|tgz|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|dmg|exe|msi|webmanifest|mp4|m4v|webm|mov)).*)',
        '/(api|trpc)(.*)',
    ],
}
