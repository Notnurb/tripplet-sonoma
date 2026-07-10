// Client-safe branding values, sourced from src/config.md. next.config.mjs
// parses that file at server/build startup and injects these NEXT_PUBLIC_*
// vars, so client components never touch the filesystem. Fallbacks keep the
// app whole if config.md is deleted.

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'Tripplet';

export const APP_TAGLINE =
    process.env.NEXT_PUBLIC_APP_TAGLINE || 'AI that works the way you think';

export const APP_DESCRIPTION =
    process.env.NEXT_PUBLIC_APP_DESCRIPTION ||
    'Chat, generate images, and build apps — all in one AI platform. Powered by Taipei, Majuli, and Suzhou models.';
