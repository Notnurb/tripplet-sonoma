import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

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
