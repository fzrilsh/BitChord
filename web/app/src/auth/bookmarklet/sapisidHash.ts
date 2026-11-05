/** The cookies the signature can be taken over, in Google's preferred order (extension/lib/ytAuth.ts). */
const SIGNING_COOKIES = ['SAPISID', '__Secure-3PAPISID', '__Secure-1PAPISID'] as const;

/** The signing secret in a captured cookie string, or null when the session is not signed in. */
export function parseSigningSecret(cookie: string): string | null {
  const values = new Map<string, string>();
  for (const part of cookie.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name && value) values.set(name, value);
  }
  for (const name of SIGNING_COOKIES) {
    const value = values.get(name);
    if (value) return value;
  }
  return null;
}

/**
 * `SAPISIDHASH <seconds>_<sha1(seconds + " " + secret + " " + origin)>`, the
 * same scheme as the extension (extension/lib/ytAuth.ts:sapisidHash) and the
 * Android app (DesktopYouTubeAuth.sapisidHash).
 *
 * `crypto.subtle.digest` works on iOS Safari.
 */
export async function sapisidHash(secret: string, origin = 'https://music.youtube.com'): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${timestamp} ${secret} ${origin}`));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `SAPISIDHASH ${timestamp}_${hex}`;
}
