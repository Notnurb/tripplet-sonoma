import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

// A precomputed bcrypt hash with no corresponding real password. Login should
// compare against this when the email doesn't exist (or has no password),
// so bcrypt always runs once per request regardless of account state — the
// case that leaks account existence via a timing side-channel otherwise.
export const DUMMY_PASSWORD_HASH = '$2b$12$Ecb2l65LXp2q/w4u/7Df8O/GJ4bGaPkbe.8n0qnP.hdkQ/EDRCLfy';

export async function hashPassword(password: string): Promise<string> {
    // Validate password strength
    if (password.length < 8) {
        throw new Error('Password must be at least 8 characters');
    }

    return await bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
    password: string,
    hash: string
): Promise<boolean> {
    return await bcrypt.compare(password, hash);
}
