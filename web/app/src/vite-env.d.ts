/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_EXTENSION_ID_CHROMIUM?: string;
  readonly VITE_ANDROID_APP_URL?: string;
  readonly VITE_EXTENSION_CHROME_URL?: string;
  readonly VITE_EXTENSION_FIREFOX_URL?: string;
  readonly VITE_EXTENSION_MANIFEST_URL?: string;
  readonly VITE_PARTY_SERVER_URL?: string;
  readonly VITE_REQUIRE_PARTY_SERVER?: string;
  /** The pure-web Worker: ACAO-less assets and signed InnerTube calls. */
  readonly VITE_WORKER_URL?: string;
  /** Where the app is served, e.g. `/BitChord/` on GitHub Pages. */
  readonly VITE_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Injected by vite.config.ts from web/extension/dev-key/extension-id.txt. */
declare const DEV_EXTENSION_ID: string;
