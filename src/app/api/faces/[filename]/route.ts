import { promises as fs } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ filename: string }> },
) {
    const { filename } = await params;

    if (!/^[a-zA-Z0-9._-]+\.png$/.test(filename)) {
        return new NextResponse('Not found', { status: 404 });
    }

    const filePath = path.join(process.cwd(), 'assets', 'faces', filename);

    try {
        const image = await fs.readFile(filePath);
        return new NextResponse(image, {
            headers: {
                'Content-Type': 'image/png',
                'Cache-Control': 'public, max-age=31536000, immutable',
            },
        });
    } catch {
        return new NextResponse('Not found', { status: 404 });
    }
}
