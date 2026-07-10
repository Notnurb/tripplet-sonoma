import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import prisma from '@/lib/db/prisma';

export interface AuthUserRecord {
    id: string;
    email: string;
    passwordHash: string | null;
    name: string | null;
    bio?: string | null;
    image?: string | null;
}

interface LocalUserRecord extends AuthUserRecord {
    createdAt: string;
    updatedAt: string;
}

interface LocalAuthStore {
    users: LocalUserRecord[];
}

const localStorePath = path.join(process.cwd(), 'data', 'dev-auth-users.json');
let warnedAboutLocalStore = false;

function canUseDatabase() {
    return Boolean(process.env.DATABASE_URL);
}

function canUseLocalFallback() {
    return process.env.NODE_ENV !== 'production';
}

function warnLocalStore() {
    if (warnedAboutLocalStore) return;
    warnedAboutLocalStore = true;
    console.warn(
        `[auth] DATABASE_URL is not configured or unavailable. Using local development auth store at ${localStorePath}.`,
    );
}

async function readLocalStore(): Promise<LocalAuthStore> {
    try {
        const raw = await fs.readFile(localStorePath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<LocalAuthStore>;
        return { users: Array.isArray(parsed.users) ? parsed.users : [] };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { users: [] };
        }
        throw error;
    }
}

async function writeLocalStore(store: LocalAuthStore) {
    await fs.mkdir(path.dirname(localStorePath), { recursive: true });
    await fs.writeFile(localStorePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

async function withDatabaseFallback<T>(
    operation: () => Promise<T>,
    fallback: () => Promise<T>,
): Promise<T> {
    if (!canUseDatabase()) {
        if (!canUseLocalFallback()) {
            throw new Error('DATABASE_URL is required for production auth.');
        }
        warnLocalStore();
        return fallback();
    }

    try {
        return await operation();
    } catch (error) {
        if (!canUseLocalFallback()) throw error;
        console.error('[auth] Database auth operation failed. Falling back to local development auth store.', error);
        warnLocalStore();
        return fallback();
    }
}

export async function findAuthUserByEmail(email: string): Promise<AuthUserRecord | null> {
    return withDatabaseFallback<AuthUserRecord | null>(
        async () => prisma.user.findUnique({ where: { email } }),
        async () => {
            const store = await readLocalStore();
            return store.users.find((user) => user.email === email) ?? null;
        },
    );
}

export async function findAuthUserById(id: string): Promise<AuthUserRecord | null> {
    return withDatabaseFallback<AuthUserRecord | null>(
        async () =>
            prisma.user.findUnique({
                where: { id },
                select: {
                    id: true,
                    email: true,
                    passwordHash: true,
                    name: true,
                    bio: true,
                    image: true,
                },
            }),
        async () => {
            const store = await readLocalStore();
            return store.users.find((user) => user.id === id) ?? null;
        },
    );
}

export async function createAuthUser(input: {
    email: string;
    passwordHash: string;
    name?: string;
}): Promise<AuthUserRecord> {
    return withDatabaseFallback<AuthUserRecord>(
        async () =>
            prisma.user.create({
                data: {
                    email: input.email,
                    passwordHash: input.passwordHash,
                    name: input.name || null,
                },
                select: {
                    id: true,
                    email: true,
                    passwordHash: true,
                    name: true,
                    bio: true,
                    image: true,
                },
            }),
        async () => {
            const store = await readLocalStore();
            if (store.users.some((user) => user.email === input.email)) {
                throw new Error('USER_EXISTS');
            }

            const now = new Date().toISOString();
            const user: LocalUserRecord = {
                id: `dev_${crypto.randomUUID()}`,
                email: input.email,
                passwordHash: input.passwordHash,
                name: input.name || null,
                bio: null,
                image: null,
                createdAt: now,
                updatedAt: now,
            };

            store.users.push(user);
            await writeLocalStore(store);
            return user;
        },
    );
}

export function isDuplicateUserError(error: unknown): boolean {
    return (
        (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') ||
        (error instanceof Error && error.message === 'USER_EXISTS')
    );
}
