import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAppConfig } from './src/lib/config-md.mjs';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// User-editable app config (src/config.md) — parsed once at server/build
// startup. Branding reaches client components via NEXT_PUBLIC_* env vars;
// custom model entries reach the picker as a JSON list of {id, name,
// description} only (endpoints and keys stay server-side in lib/ai/llm.ts).
const appConfig = loadAppConfig(projectRoot);
const pickerModels = appConfig.models
  .filter((m) => m.enabled !== false && m.showInPicker && m.id)
  .map((m) => ({ id: m.id, name: m.label || m.id, description: m.description || 'Custom model — src/config.md' }));

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_NAME: appConfig.app.name,
    NEXT_PUBLIC_APP_TAGLINE: appConfig.app.tagline,
    NEXT_PUBLIC_APP_DESCRIPTION: appConfig.app.description,
    NEXT_PUBLIC_CUSTOM_MODELS: JSON.stringify(pickerModels),
  },
  compress: true,
  // Tree-shake large barrel-file packages so each route only ships the icons /
  // helpers it actually imports — meaningfully smaller client bundles.
  experimental: {
    optimizePackageImports: ['lucide-react', '@tabler/icons-react', 'framer-motion'],
  },
  // Bundle the installer script into the /installconnect route's serverless
  // function so readFileSync works on Vercel (public/ is CDN-served, not in the
  // lambda fs by default).
  outputFileTracingIncludes: {
    '/installconnect': ['./public/installconnect.sh'],
    // Pyodide is require()'d inside an eval'd worker-thread string (see
    // src/lib/python/run.ts), so the file tracer can't see it — include its
    // runtime files explicitly for the routes that execute Python.
    '/api/execute': ['./node_modules/pyodide/**'],
    // sprompts/ holds the persona system prompts, read from disk at runtime
    // by src/lib/ai/system-prompt.ts — must ride along in the lambda fs.
    // src/config.md is fs-read at request time by lib/ai/llm.ts (custom model
    // backends) — trace it into every route that resolves a backend.
    '/api/sonoma': ['./node_modules/pyodide/**', './sprompts/**', './src/config.md'],
    '/api/chat': ['./sprompts/**', './src/config.md'],
    '/api/mcp': ['./src/config.md'],
    '/api/telegram/webhook/[slug]': ['./src/config.md'],
    // Trilo face PNGs are read from disk at request time (assets/ is not
    // CDN-served like public/), so trace them into the faces route's function.
    '/api/faces/[filename]': ['./assets/faces/**'],
  },
  // Keep pyodide out of the webpack server bundle; it must load from
  // node_modules at runtime (worker threads + WASM assets).
  serverExternalPackages: ['pyodide'],
  // SECURITY NOTE: ignoreBuildErrors/ignoreDuringBuilds bypass type+lint checks
  // in production builds. Re-enable once third-party type issues are resolved
  // (three.js, @tabler/icons-react). Track in ISSUES.md.
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
};

export default nextConfig;
