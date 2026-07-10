import { SignJWT, jwtVerify } from 'jose';
import { env } from '@/lib/env';

function getKey(): Uint8Array {
    return new TextEncoder().encode(env.JWT_SECRET);
}

export interface JWTPayload {
    userId: string;
    email: string;
    [key: string]: unknown;
}

export async function signToken(payload: JWTPayload): Promise<string> {
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('7d')
        .sign(getKey());
}

export async function verifyToken(token: string): Promise<JWTPayload> {
    try {
        const { payload } = await jwtVerify(token, getKey(), {
            algorithms: ['HS256'],
        });
        return payload as JWTPayload;
    } catch {
        throw new Error('Invalid or expired token');
    }
}
