import { config } from '@/config';
import { loadSession } from './storage';
import { parseSigningSecret, sapisidHash } from './sapisidHash';

/**
 * One signed InnerTube call, relayed through the Worker.
 *
 * The page can compute the SAPISIDHASH and holds the cookie jar, but it cannot
 * set `Cookie` (a forbidden request header) or a YouTube `Origin` on a
 * cross-origin fetch. The Worker does both. Measured: an `Authorization` hash
 * with no Cookie header answers `logged_in=0`, so the cookies have to travel
 * too — which is why this only ever goes to the user's own Worker.
 */

/** The Worker's endpoint for an InnerTube call, e.g. `/yt/browse`. */
function relayUrl(url: URL): string {
  const endpoint = url.pathname.replace(/^\/youtubei\/v1\//, '');
  return `${config.workerUrl.replace(/\/+$/, '')}/yt/${endpoint}${url.search}`;
}

export interface RelayRequest {
  method: string;
  body: string | null;
}

export async function signedRequest(url: URL, request: RelayRequest, signal?: AbortSignal | null): Promise<Response> {
  const session = await loadSession();
  if (!session?.loggedIn) throw new Error('Not signed in to YouTube Music');
  const secret = parseSigningSecret(session.cookie);
  if (!secret) throw new Error('The captured session has no signing cookie; sign in again');

  const headers = new Headers();
  headers.set('Content-Type', 'text/plain;charset=UTF-8');
  headers.set('X-Bitchord-Cookie', session.cookie);
  headers.set('X-Bitchord-Auth', await sapisidHash(secret));
  if (session.authUser) headers.set('X-Goog-AuthUser', session.authUser);
  if (session.pageId) headers.set('X-Goog-PageId', session.pageId);

  return fetch(relayUrl(url), {
    method: request.method,
    headers,
    body: request.body,
    signal: signal ?? null,
  });
}
