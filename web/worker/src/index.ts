/**
 * The BitChord Worker (pure-web build): the two things a page cannot do itself.
 *
 * 1. `/asset` — `sw.js_data` and `/s/player/…/base.js` carry no
 *    `Access-Control-Allow-Origin` for any origin, so YouTube.js cannot read
 *    them from the page or from a sandboxed iframe. Fetched with YouTube's own
 *    Origin they answer 200. These are static files: cached, never logged.
 *
 * 2. `/yt/*` — signed InnerTube calls. `Cookie` is a forbidden request header,
 *    so a page cannot present the session even though it holds the captured
 *    cookie string and can compute SAPISIDHASH. The Worker re-assembles the
 *    `Cookie` and `Origin` headers and forwards.
 *
 * Audio bytes are never proxied here: googlevideo URLs are signed for the
 * requester's IP, so a Worker-fetched stream would be unusable by the phone.
 *
 * Measured on 2026-11-05 (see bitchord-pure-web-ios-revised.md).
 */

interface Env {
  /** Comma-separated app origins allowed to call this Worker. Empty allows any (dev). */
  ALLOWED_ORIGINS?: string;
  /** Optional shared secret; when set, `/yt/*` requires `X-Bitchord-Token`. */
  RELAY_TOKEN?: string;
}

const MUSIC_ORIGIN = 'https://music.youtube.com';
const WWW_ORIGIN = 'https://www.youtube.com';

/** The only assets this Worker will fetch: they are static and carry no ACAO. */
const ASSET_ALLOW = [
  /^https:\/\/www\.youtube\.com\/sw\.js_data$/,
  /^https:\/\/www\.youtube\.com\/s\/player\/[A-Za-z0-9_-]+\/[A-Za-z0-9_./-]+\.js$/,
  /^https:\/\/www\.youtube\.com\/iframe_api$/,
];

/**
 * The signed endpoints BitChord actually uses, named one by one rather than
 * matched by prefix: `account/delete` must not ride in on `account/`.
 */
const SIGNED_ENDPOINTS = new Set([
  'browse',
  'search',
  'player',
  'next',
  'music/get_search_suggestions',
  'account/account_menu',
  'account/accounts_list',
  'like/like',
  'like/removelike',
  'playlist/get_add_to_playlist',
  'browse/edit_playlist',
]);

function signedEndpoint(pathname: string): string | null {
  if (!pathname.startsWith('/yt/')) return null;
  const endpoint = pathname.slice(4);
  return SIGNED_ENDPOINTS.has(endpoint) ? endpoint : null;
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const origin = request.headers.get('Origin');
  const allowOrigin = allowed.length === 0 ? '*' : origin && allowed.includes(origin) ? origin : allowed[0]!;
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, X-Bitchord-Cookie, X-Bitchord-Auth, X-Goog-AuthUser, X-Goog-PageId, X-Bitchord-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Type, Content-Length, X-Upstream-Status',
    Vary: 'Origin',
  };
}

function json(request: Request, env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(request, env) },
  });
}

/** What YouTube expects of its own web client. */
function youtubeHeaders(origin: string): Headers {
  const headers = new Headers();
  headers.set('Origin', origin);
  headers.set('Referer', `${origin}/`);
  headers.set('X-Origin', origin);
  headers.set(
    'User-Agent',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  );
  return headers;
}

async function handleAsset(request: Request, env: Env, url: URL): Promise<Response> {
  const target = url.searchParams.get('u');
  if (!target || !ASSET_ALLOW.some((pattern) => pattern.test(target))) {
    return json(request, env, { error: 'u must be a YouTube asset this Worker serves' }, 400);
  }
  const upstream = await fetch(target, { headers: youtubeHeaders(WWW_ORIGIN) });
  const body = await upstream.arrayBuffer();
  const cacheable = target.includes('/s/player/');
  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/javascript; charset=utf-8',
      'cache-control': cacheable ? 'public, max-age=86400, immutable' : 'public, max-age=300',
      'x-upstream-status': String(upstream.status),
      ...corsHeaders(request, env),
    },
  });
}

/**
 * A signed InnerTube call. The page sends the captured cookie jar and the
 * already-computed SAPISIDHASH in custom headers; this sets the two headers a
 * page cannot (`Cookie`, `Origin`) and forwards the body untouched.
 */
async function handleSigned(request: Request, env: Env, url: URL): Promise<Response> {
  if (env.RELAY_TOKEN && request.headers.get('x-bitchord-token') !== env.RELAY_TOKEN) {
    return json(request, env, { error: 'bad relay token' }, 401);
  }
  const endpoint = signedEndpoint(url.pathname);
  if (!endpoint) {
    return json(request, env, { error: `not a signed endpoint: ${url.pathname}` }, 403);
  }

  const cookie = request.headers.get('x-bitchord-cookie');
  const auth = request.headers.get('x-bitchord-auth');
  if (!cookie || !auth) return json(request, env, { error: 'missing session' }, 401);

  const headers = youtubeHeaders(MUSIC_ORIGIN);
  headers.set('Content-Type', 'text/plain;charset=UTF-8');
  headers.set('Cookie', cookie);
  headers.set('Authorization', auth);
  const authUser = request.headers.get('x-goog-authuser');
  if (authUser) headers.set('X-Goog-AuthUser', authUser);
  const pageId = request.headers.get('x-goog-pageid');
  if (pageId) headers.set('X-Goog-PageId', pageId);

  const upstream = await fetch(`${MUSIC_ORIGIN}/youtubei/v1/${endpoint}${url.search}`, {
    method: 'POST',
    headers,
    body: await request.text(),
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'x-upstream-status': String(upstream.status),
      'cache-control': 'no-store',
      ...corsHeaders(request, env),
    },
  });
}

async function handleWhoami(request: Request, env: Env): Promise<Response> {
  const response = await fetch('https://api.ipify.org?format=json');
  const body = (await response.json()) as { ip?: string };
  return json(request, env, { egressIp: body.ip ?? 'unknown' });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });

    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') return json(request, env, { ok: true });
      if (url.pathname === '/whoami') return await handleWhoami(request, env);
      if (url.pathname === '/asset') return await handleAsset(request, env, url);
      if (url.pathname.startsWith('/yt/')) return await handleSigned(request, env, url);
      return json(request, env, { error: 'not found' }, 404);
    } catch (error) {
      // Never log the request: it may carry a session cookie.
      console.error(`${url.pathname} failed: ${error instanceof Error ? error.name : 'error'}`);
      return json(request, env, { error: 'upstream failure' }, 502);
    }
  },
} satisfies ExportedHandler<Env>;
