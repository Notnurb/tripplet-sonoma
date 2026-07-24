// Serves the Astrocode CLI installer at the extensionless URL
//   https://getsonoma.lol/installcli
// so `curl -fsSL https://getsonoma.lol/installcli | bash` works.
//
// The canonical script is public/installcli.sh (also reachable directly at
// /installcli.sh). We read it from disk and stream it as a shell script.
// next.config.mjs traces public/installcli.sh into this route's bundle so
// the read also works on Vercel's serverless filesystem. Mirrors
// src/app/installconnect/route.ts exactly.

import { readFileSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

export function GET() {
    let script: string;
    try {
        script = readFileSync(join(process.cwd(), 'public', 'installcli.sh'), 'utf8');
    } catch {
        return new Response('# Astrocode installer is temporarily unavailable.\n', {
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
