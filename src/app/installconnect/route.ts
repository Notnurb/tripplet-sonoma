// Serves the OpenSonoma installer at the extensionless URL
//   https://tripplet.lol/installconnect
// so `curl -fsSL https://tripplet.lol/installconnect | bash` works.
//
// The canonical script is public/installconnect.sh (also reachable directly at
// /installconnect.sh). We read it from disk and stream it as a shell script.
// next.config.mjs traces public/installconnect.sh into this route's bundle so
// the read also works on Vercel's serverless filesystem.

import { readFileSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

export function GET() {
    let script: string;
    try {
        script = readFileSync(join(process.cwd(), 'public', 'installconnect.sh'), 'utf8');
    } catch {
        return new Response('# OpenSonoma installer is temporarily unavailable.\n', {
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
