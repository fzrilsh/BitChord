/** Build-time configuration, from Vite's `VITE_*` environment variables. */

/** Where the app is served from, so bundled files resolve under a subpath (GitHub Pages). */
const base = import.meta.env.BASE_URL || '/';
const root = base.endsWith('/') ? base : `${base}/`;

export const config = {
  /** Pinned in development by the manifest `key` (web/extension/wxt.config.ts). */
  chromiumExtensionId: import.meta.env.VITE_EXTENSION_ID_CHROMIUM || DEV_EXTENSION_ID,
  /** The extension packages (web/extension: `pnpm package` copies them into public/downloads). */
  extensionChromeUrl: import.meta.env.VITE_EXTENSION_CHROME_URL || `${root}downloads/bitchord-extension-chrome.zip`,
  extensionFirefoxUrl: import.meta.env.VITE_EXTENSION_FIREFOX_URL || `${root}downloads/bitchord-extension-firefox.zip`,
  /** The version the zips above hold, for the "update available" notice. */
  extensionManifestUrl: import.meta.env.VITE_EXTENSION_MANIFEST_URL || `${root}downloads/extension.json`,
  androidAppUrl: import.meta.env.VITE_ANDROID_APP_URL || 'https://github.com/kushagrasinghx/BitChord/releases/latest',
  /** BitChord's Listen Together server. vite.config.ts refuses a production build without it. */
  partyServerUrl: import.meta.env.VITE_PARTY_SERVER_URL ?? '',
  /**
   * The pure-web Worker (web/worker): ACAO-less YouTube assets and signed
   * InnerTube calls. Optional — without it the app behaves as before, needing
   * the extension.
   */
  workerUrl: import.meta.env.VITE_WORKER_URL ?? '',
} as const;
