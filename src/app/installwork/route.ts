// Serves the Tripplet Work installer at the extensionless URL
//   https://www.tripplet.lol/installwork
// so `curl -fsSL https://www.tripplet.lol/installwork | bash` works.
//
// The canonical script is public/installwork.sh (also reachable directly at
// /installwork.sh). We read it from disk and stream it as a shell script.
// next.config.mjs traces public/installwork.sh into this route's bundle so
// the read also works on Vercel's serverless filesystem. Mirrors
// src/app/installcli/route.ts exactly.

import { readFileSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

export function GET() {
    let script: string;
    try {
        script = readFileSync(join(process.cwd(), 'public', 'installwork.sh'), 'utf8');
    } catch {
        return new Response('# The Tripplet Work installer is temporarily unavailable.\n', {
            status: 503,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
    }

    return new Response(script, {
        status: 200,
        headers: {
            'content-type': 'text/x-shellscript; charset=utf-8',
            'cache-control': 'public, max-age=300',
        },
    });
}
