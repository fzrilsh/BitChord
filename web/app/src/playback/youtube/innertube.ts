import type { Innertube, Types } from 'youtubei.js/web';
import { config } from '@/config';
import { getBridge } from '@/extension/bridge';
import { ensureYtAuth, identityOf, noteMusicIdentity } from '@/extension/useYtAuth';
import { trackLog } from '../trackLog';
import { sandboxFetch } from './sandbox/bridge';

/**
 * The page's YouTube.js instance, created on first use (YouTube.js is large,
 * prompt §3). All of its requests leave from the browser itself; the
 * extension's declarativeNetRequest rules supply the YouTube headers
 * (web/extension/lib/rules.ts).
 *
 * Without the extension (iOS Safari, any browser that can't install one) the
 * requests go through a sandboxed iframe instead — see `pureWebFetch`.
 */
let instance: Promise<Innertube> | null = null;

export function getInnertube(): Promise<Innertube> {
  instance ??= create(selectFetch()).catch((error: unknown) => {
    instance = null;
    throw error;
  });
  return instance;
}

/** Which fetch the anonymous instance uses: the extension's, or the sandbox's. */
function selectFetch(): typeof globalThis.fetch {
  return getBridge() ? simpleRequestFetch : pureWebFetch;
}

/** Which fetch the signed instance uses. */
function selectSignedFetch(): typeof globalThis.fetch {
  return getBridge() ? signedFetch : workerSignedFetch;
}

/**
 * A second instance for signed-in requests (prompt §5.3). Its InnerTube calls
 * go through the extension (`yt.fetch` with `auth`), which adds the user's
 * session; everything else (the session bootstrap, the player script) loads
 * like the anonymous instance's. The page never holds a cookie, so YouTube.js
 * is told it is signed in rather than given one.
 */
let signedInstance: Promise<Innertube> | null = null;

export function getSignedInnertube(): Promise<Innertube> {
  signedInstance ??= create(selectSignedFetch()).then(
    (yt) => {
      // Lifts YouTube.js's "must be signed in" checks (library pages). With
      // no cookie and no OAuth token it adds no credentials of its own.
      yt.session.logged_in = true;
      return yt;
    },
    (error: unknown) => {
      signedInstance = null;
      throw error;
    },
  );
  return signedInstance;
}

/** The instance browse requests should use: signed in when the user is, anonymous otherwise. */
export async function getMusicClient(): Promise<Innertube> {
  const auth = await ensureYtAuth().catch(() => null);
  // A failed auth read browses anonymously, and says so, so the answer that
  // does come later reloads what was read meanwhile (useYtAuth.adopt).
  noteMusicIdentity(auth ? identityOf(auth) : 'anonymous');
  return auth?.signedIn ? getSignedInnertube() : getInnertube();
}

const YOUTUBE_HOSTS = new Set(['music.youtube.com', 'www.youtube.com', 'youtube.com']);

/** Headers a page may send without triggering a CORS preflight. */
const SAFELISTED = new Set(['accept', 'accept-language', 'content-language']);

/**
 * youtubei answers CORS preflights with 400 (measured; web/fixtures/README.md),
 * so InnerTube calls must be "simple" requests: a text/plain body and no
 * custom headers. youtubei parses the JSON body regardless of the declared
 * type, and everything the dropped headers carried (client name and version,
 * visitor data) is also in the body's `context.client`. Origin, Referer and
 * X-Origin are added by the extension's rule.
 */
async function simpleRequestFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : input.toString());

  if (!YOUTUBE_HOSTS.has(url.hostname) || url.pathname.startsWith('/api/jnn/')) {
    return fetch(input, init);
  }

  const method = init?.method ?? request?.method ?? 'GET';
  const source = new Headers(init?.headers ?? request?.headers);
  const headers = new Headers();
  source.forEach((value, key) => {
    if (SAFELISTED.has(key.toLowerCase())) headers.set(key, value);
  });

  let body: BodyInit | null | undefined = init?.body;
  if (body === undefined && request && method !== 'GET' && method !== 'HEAD') {
    body = await request.text();
  }
  if (body != null) headers.set('Content-Type', 'text/plain;charset=UTF-8');

  return fetch(url, {
    method,
    headers,
    body: body ?? null,
    signal: init?.signal ?? request?.signal ?? null,
    // Anonymous: the user's YouTube cookies never ride along on page requests.
    credentials: 'omit',
  });
}

function isInnertubeCall(url: URL): boolean {
  return (url.hostname === 'music.youtube.com' || url.hostname === 'www.youtube.com') && url.pathname.startsWith('/youtubei/');
}

function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** InnerTube calls through the extension, signed as the chosen channel; the rest as simpleRequestFetch. */
async function signedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : input.toString());
  if (!isInnertubeCall(url)) return simpleRequestFetch(input, init);

  const bridge = getBridge();
  if (!bridge) throw new Error('Signed-in requests need the BitChord extension');
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase() as 'GET' | 'POST';
  const headers: Record<string, string> = {};
  new Headers(init?.headers ?? request?.headers).forEach((value, key) => (headers[key] = value));
  let body = init?.body ?? undefined;
  if (body === undefined && request && method !== 'GET') body = await request.text();
  if (body != null && typeof body !== 'string') body = await new Response(body).text();

  const response = await bridge.call(
    'yt.fetch',
    { url: url.toString(), method, headers, ...(typeof body === 'string' && { body }), auth: true },
    { ...(init?.signal && { signal: init.signal }) },
  );
  const payload = response.bodyEncoding === 'base64' ? decodeBase64(response.body) : response.body;
  return new Response(response.status === 204 || response.status === 304 ? null : payload, {
    status: response.status,
    headers: response.headers,
  });
}

/**
 * A visitorData that belongs to this device.
 *
 * YouTube binds a visitorData to the address that asked for it. The session
 * bootstrap arrives through the Worker, so the one it carries was minted for
 * Cloudflare's IP; presenting it from the phone is answered LOGIN_REQUIRED, and
 * VISIONOS — the only client that serves full-length audio — becomes
 * unreachable.
 *
 * Any youtubei call the sandbox makes returns the device's own visitorData in
 * `responseContext`. A search is the cheapest one that needs no session. The
 * value is cached for the life of the page: it does not change.
 */
let visitorDataForDevice: Promise<string | null> | null = null;

export function deviceVisitorData(): Promise<string | null> {
  visitorDataForDevice ??= (async () => {
    try {
      const response = await sandboxFetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
        method: 'POST',
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: '2.20260623.01.00', hl: 'en', gl: 'US' } },
          query: 'a',
        }),
      });
      const body = (await response.json()) as { responseContext?: { visitorData?: string } };
      const visitorData = body.responseContext?.visitorData ?? null;
      if (visitorData) {
        trackLog.d(`device visitorData ${visitorData.slice(0, 16)}…`);
      } else {
        trackLog.w('no visitorData in the sandbox response');
      }
      return visitorData;
    } catch (error) {
      // Not fatal: the track still plays through the phone clients, just cut
      // at ~1 MiB, and the reason is in the log.
      trackLog.w(`could not read this device's visitorData: ${String(error)}`);
      return null;
    }
  })();
  return visitorDataForDevice;
}

/**
 * Assets YouTube.js needs but YouTube serves without CORS headers for any
 * origin: the session bootstrap (`/sw.js_data`), the player script the
 * signature decipher runs from, and the iframe API.
 *
 * Measured 2026-11-05: each answers 200 but carries no
 * `Access-Control-Allow-Origin`, so neither the page nor a sandboxed iframe can
 * read them. The Worker fetches them with YouTube's own Origin and hands them
 * back with `*`.
 */
function needsAssetProxy(url: URL): boolean {
  if (url.hostname !== 'www.youtube.com') return false;
  // /sw.js_data IS here: a sandbox cannot read it either (it carries no ACAO;
  // measured "Load failed" in WebKit), so without this the app does not start.
  //
  // The visitorData inside it was minted for Cloudflare's IP, and YouTube binds
  // visitorData to the address that asked for it — a player request presenting
  // it from the phone is answered LOGIN_REQUIRED. `deviceVisitorData` replaces
  // the value before any player request goes out, so only the bootstrap is
  // Cloudflare's; nothing downstream depends on it.
  return (
    url.pathname === '/sw.js_data' || url.pathname === '/iframe_api' || url.pathname.startsWith('/s/player/')
  );
}

function workerAssetUrl(target: string): string {
  return `${config.workerUrl.replace(/\/+$/, '')}/asset?u=${encodeURIComponent(target)}`;
}

/**
 * The anonymous fetch without the extension: InnerTube calls run in the
 * sandboxed iframe (opaque origin, which youtubei answers), and the ACAO-less
 * assets go through the Worker. Everything else is a plain fetch.
 *
 * With no Worker configured the asset fetches fail as they would have before,
 * and the app's "needs setup" states take over.
 */
async function pureWebFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : input.toString());

  if (needsAssetProxy(url)) {
    if (!config.workerUrl) throw new Error('YouTube assets need the BitChord Worker (set VITE_WORKER_URL)');
    return fetch(workerAssetUrl(url.toString()), { signal: init?.signal ?? request?.signal ?? null });
  }

  if (isInnertubeCall(url)) return sandboxFetch(input, init);

  return fetch(input, init);
}

/**
 * Signed InnerTube calls without the extension. `Cookie` is a forbidden
 * request header, so the browser cannot present the captured session; the
 * Worker sets it, together with the SAPISIDHASH the page computed. See
 * `auth/bookmarklet` for where the session comes from.
 */
async function workerSignedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : input.toString());
  if (!isInnertubeCall(url)) return pureWebFetch(input, init);

  if (!config.workerUrl) throw new Error('Signed-in requests need the BitChord Worker (set VITE_WORKER_URL)');

  const { signedRequest } = await import('@/auth/bookmarklet/relay');
  const method = (init?.method ?? request?.method ?? 'POST').toUpperCase();
  let body = init?.body ?? undefined;
  if (body === undefined && request && method !== 'GET') body = await request.text();
  if (body != null && typeof body !== 'string') body = await new Response(body).text();

  return signedRequest(url, { method, body: typeof body === 'string' ? body : null }, init?.signal ?? request?.signal ?? null);
}

async function isFirstRun(): Promise<boolean> {
  try {
    const databases = await indexedDB.databases();
    return !databases.some((db) => db.name === 'youtubei.js');
  } catch {
    return true;
  }
}

async function create(fetch: typeof globalThis.fetch = selectFetch()): Promise<Innertube> {
  const started = performance.now();
  const { Innertube, Platform, UniversalCache } = await import('youtubei.js/web');

  // Runs the player's signature and n-parameter functions, which YouTube.js
  // extracts from YouTube's player script (as Kira does).
  Platform.shim.eval = async (data: Types.BuildScriptResult, env: Record<string, Types.VMPrimative>) => {
    const properties: string[] = [];
    if (env.n) properties.push(`n: exportedVars.nFunction(${JSON.stringify(env.n)})`);
    if (env.sig) properties.push(`sig: exportedVars.sigFunction(${JSON.stringify(env.sig)})`);
    return new Function(`${data.output}\nreturn { ${properties.join(', ')} }`)();
  };

  const firstRun = await isFirstRun();
  try {
    const yt = await Innertube.create({
      cache: new UniversalCache(true),
      fetch,
      retrieve_player: true,
    });
    const client = yt.session.context.client;
    // visitorData is not decoration: VISIONOS answers LOGIN_REQUIRED without it
    // and a full-length URL with it, so a session that never got one is worth
    // seeing in the log rather than inferring from a track that stops.
    trackLog.i(
      `InnerTube ready in ${Math.round(performance.now() - started)}ms ` +
        `(${client.clientName} ${client.clientVersion}, player ${yt.session.player?.player_id ?? 'none'}, ` +
        `visitorData ${client.visitorData ? `${String(client.visitorData).slice(0, 16)}…` : 'MISSING'})`,
    );
    return yt;
  } catch (error) {
    // YouTube.js falls back to a locally generated session when /sw.js_data
    // fails on the very first run, and those sessions fail playback later.
    // Dropping its cache makes the next start retry for real (Kira does this).
    if (firstRun) indexedDB.deleteDatabase('youtubei.js');
    trackLog.e(`InnerTube failed to start: ${String(error)}`);
    throw error;
  }
}
