import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// The development extension's id, pinned by its manifest `key`
// (web/extension/dev-key/). Read at build time so the page can message it.
function devExtensionId(): string {
  try {
    return readFileSync(new URL('../extension/dev-key/extension-id.txt', import.meta.url), 'utf8').trim();
  } catch {
    return '';
  }
}

// The party server's address stays out of the repo: .env.local here, a
// Cloudflare Pages variable in production. Without it Listen Together can't
// make a party, so a production build stops instead of shipping that — unless
// VITE_REQUIRE_PARTY_SERVER=false, which a build without Listen Together
// (the pure-web / GitHub Pages build) sets.
function requirePartyServer(mode: string): void {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  if (env.VITE_REQUIRE_PARTY_SERVER === 'false') return;
  if (!env.VITE_PARTY_SERVER_URL?.trim()) {
    throw new Error(
      'VITE_PARTY_SERVER_URL is not set (app/.env.local, or the Cloudflare Pages environment). ' +
        'Set VITE_REQUIRE_PARTY_SERVER=false to build without Listen Together.',
    );
  }
}

export default defineConfig(({ command, mode }) => {
  if (command === 'build') requirePartyServer(mode);
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  // GitHub Pages serves the app under /<repo>/, so every asset URL needs that
  // prefix. Local dev stays at the root.
  const base = env.VITE_BASE_URL?.trim() || '/';

  return {
    base,
    plugins: [react(), tailwindcss()],
    define: {
      DEV_EXTENSION_ID: JSON.stringify(devExtensionId()),
    },
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    // AutoMix's analysis worker (playback/automix): essentia.js's 2021-era
    // Emscripten glue breaks under dep pre-bundling, and the worker is a module.
    optimizeDeps: { exclude: ['essentia.js'] },
    worker: { format: 'es' },
    // Most tests are pure functions and run in node. The few that need a
    // document (the sandbox bridge, the bookmarklet generator) opt in with a
    // `// @vitest-environment happy-dom` header.
    test: {
      environment: 'node',
    },
    server: {
      // The extension's externally_connectable and DNR rules name this origin
      // exactly, so the port must not drift to 5174 when 5173 is busy.
      port: 5173,
      strictPort: true,
    },
  };
});
