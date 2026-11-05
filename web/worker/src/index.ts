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

/**
 * BotGuard's GenerateIT, which needs YouTube's Origin but not a session. The
 * page's integrity token is only accepted when it was minted from that origin,
 * so without the extension this is the only way to get one.
 *
 * It lives on `/api/jnn/v1/`, not `/youtubei/v1/`, so it carries its own path.
 */
const GENERATE_IT_PATH = '/yt/jnn/GenerateIT';
const GENERATE_IT_UPSTREAM = `${WWW_ORIGIN}/api/jnn/v1/GenerateIT`;

/**
 * How much of a stream an open-ended request is answered with.
 *
 * A media element asks for `bytes=0-` first, and googlevideo answers that with
 * 403; it will serve an explicit range of any size. 1 MB is enough for the
 * element to read the container header and start playing, after which it asks
 * for the offsets it actually wants.
 */
const FIRST_WINDOW = 1_048_576;

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
    // x-goog-api-key and x-user-agent are what BotGuard's GenerateIT sends.
    'Access-Control-Allow-Headers':
      'Content-Type, X-Bitchord-Cookie, X-Bitchord-Auth, X-Goog-AuthUser, X-Goog-PageId, X-Bitchord-Token, X-Goog-Api-Key, X-User-Agent',
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

/**
 * Follows a googlevideo URL's redirects and returns the address it ends at.
 *
 * googlevideo answers a media URL with a 302 when the request reaches it from a
 * different address family than the one the URL was signed for (a phone on
 * IPv6 whose connection falls back to IPv4). Safari refuses to follow that
 * redirect for a media element, so the element must be handed the final URL.
 *
 * Only googlevideo hosts are followed, and only the `Location` is read: no
 * media bytes pass through here.
 */
async function handleResolve(request: Request, env: Env, url: URL): Promise<Response> {
  const target = url.searchParams.get('u');
  if (!target || !/^https:\/\/[a-z0-9-]+\.googlevideo\.com\//.test(target)) {
    return json(request, env, { error: 'u must be a googlevideo URL' }, 400);
  }
  // GET with a one-byte range, not HEAD: googlevideo answers HEAD with 403, so
  // a HEAD never sees the redirect it is looking for. One byte is all this
  // reads; the body is never returned to the caller.
  let current = target;
  for (let hop = 0; hop < 3; hop++) {
    const response = await fetch(current, { method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'manual' });
    // Drain the body so the connection is released; it is at most one byte.
    await response.arrayBuffer().catch(() => undefined);
    if (response.status < 300 || response.status >= 400) {
      return json(request, env, { url: current, status: response.status });
    }
    const location = response.headers.get('Location');
    if (!location) return json(request, env, { url: current, status: response.status });
    current = new URL(location, current).toString();
  }
  return json(request, env, { url: current, status: 302 });
}

/**
 * Streams one media range, for the case where the phone cannot reach
 * googlevideo at all.
 *
 * This is the fallback, not the normal path: audio is signed for the IP that
 * asked for it, so a Worker-fetched URL is usually useless to the phone. But
 * when a network hands the phone an IPv6 address and then routes its traffic
 * over IPv4, googlevideo answers 302 to a host the element will not follow, and
 * no client returns a URL that is not IP-bound. Proxying the bytes is then the
 * only way to play.
 *
 * The Worker mints its own player response, so the URL it fetches is signed
 * for the Worker's own address, and the bytes are streamed straight through.
 * Only the range the element asks for crosses the Worker.
 */
async function handleAudio(request: Request, env: Env, url: URL): Promise<Response> {
  const videoId = url.searchParams.get('v');
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return json(request, env, { error: 'v must be a video id' }, 400);
  }
  // A player response minted here, so the media URL is signed for this Worker.
  // Several clients are tried: which one YouTube will serve varies by IP and by
  // time, and the datacenter addresses a Worker uses are refused more often
  // than a phone's.
  const clients: [string, string][] = [
    ['IOS', '20.10.4'],
    ['ANDROID', '20.10.38'],
    ['ANDROID_VR', '1.65.10'],
    ['VISIONOS', '1.02'],
    ['TVHTML5_SIMPLY', '2.0'],
    ['MWEB', '2.20260205.04.01'],
  ];

  // A signed request when the page has a session: a logged-in player request
  // is the one YouTube reliably serves from a datacenter address, where every
  // anonymous client answers LOGIN_REQUIRED ("confirm you're not a bot").
  //
  // The session arrives in the query, not in headers: the element fetches this
  // URL itself, and a media element cannot send custom headers.
  const cookie = url.searchParams.get('c') ?? request.headers.get('x-bitchord-cookie');
  const auth = url.searchParams.get('a') ?? request.headers.get('x-bitchord-auth');
  const authUser = url.searchParams.get('u') ?? request.headers.get('x-goog-authuser');

  let chosen: { itag?: number; mimeType?: string; url?: string } | undefined;
  let lastStatus = '';
  for (const [clientName, clientVersion] of clients) {
    const headers = youtubeHeaders(MUSIC_ORIGIN);
    headers.set('Content-Type', 'text/plain;charset=UTF-8');
    if (cookie && auth) {
      headers.set('Cookie', cookie);
      headers.set('Authorization', auth);
      if (authUser) headers.set('X-Goog-AuthUser', authUser);
    }
    const player = await fetch(`${MUSIC_ORIGIN}/youtubei/v1/player?prettyPrint=false`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        context: {
          client: { clientName, clientVersion, hl: 'en', gl: 'US' },
          ...(cookie && auth && { user: {} }),
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    });
    const data = (await player.json()) as {
      playabilityStatus?: { status?: string; reason?: string };
      streamingData?: { adaptiveFormats?: { itag?: number; mimeType?: string; url?: string }[] };
    };
    lastStatus = `${clientName}: ${data.playabilityStatus?.status ?? player.status}`;
    const formats = (data.streamingData?.adaptiveFormats ?? []).filter(
      (format) => String(format.mimeType ?? '').startsWith('audio') && format.url,
    );
    chosen = formats.find((format) => format.itag === 140) ?? formats[0];
    if (chosen?.url) break;
  }
  if (!chosen?.url) {
    console.log(`audio ${videoId}: no direct URL (${lastStatus})`);
    return json(request, env, { error: 'no direct audio for this video' }, 502);
  }

  // The stream token the page minted, when it has one. googlevideo serves only
  // the first ~1.1 MB of a stream without it and answers 403 past that, so
  // carrying it through is what lets a whole track play.
  const pot = url.searchParams.get('pot');
  const mediaUrl = new URL(chosen.url);
  if (pot) mediaUrl.searchParams.set('pot', pot);

  // A media element opens with `Range: bytes=0-`, and googlevideo answers an
  // open-ended range with 403 (it reads as "the whole file", which it will not
  // serve in one response). Turning it into a bounded window gets a 206; the
  // element then asks for explicit offsets, which googlevideo does serve.
  const asked = request.headers.get('Range');
  const open = /^bytes=(\d+)-$/.exec(asked ?? '');
  const start = open ? Number(open[1]) : 0;
  const mediaHeaders = new Headers();
  mediaHeaders.set('Range', asked && !open ? asked : `bytes=${start}-${start + FIRST_WINDOW - 1}`);
  const media = await fetch(mediaUrl, { headers: mediaHeaders });
  if (media.status !== 206 && media.status !== 200) {
    console.log(`audio ${videoId}: media answered ${media.status}`);
    await media.body?.cancel().catch(() => undefined);
    return json(request, env, { error: `media answered ${media.status}` }, media.status === 403 ? 403 : 502);
  }
  const out = new Headers(media.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) out.set(key, value);
  out.delete('content-security-policy');
  out.set('accept-ranges', 'bytes');
  return new Response(media.body, { status: media.status, headers: out });
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
  const anonymous = url.pathname === GENERATE_IT_PATH;
  const endpoint = anonymous ? null : signedEndpoint(url.pathname);
  if (!anonymous && !endpoint) {
    return json(request, env, { error: `not a signed endpoint: ${url.pathname}` }, 403);
  }

  const headers = youtubeHeaders(anonymous ? WWW_ORIGIN : MUSIC_ORIGIN);
  if (anonymous) {
    // GenerateIT needs its own `x-goog-api-key` and `x-user-agent`; carry only
    // those through. A browser's `referer`, `sec-ch-ua*` or `accept-encoding`
    // make YouTube answer 403 ("unregistered callers").
    for (const name of ['x-goog-api-key', 'x-user-agent', 'content-type']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
  } else {
    headers.set('Content-Type', 'text/plain;charset=UTF-8');
    const cookie = request.headers.get('x-bitchord-cookie');
    const auth = request.headers.get('x-bitchord-auth');
    if (!cookie || !auth) return json(request, env, { error: 'missing session' }, 401);
    headers.set('Cookie', cookie);
    headers.set('Authorization', auth);
    const authUser = request.headers.get('x-goog-authuser');
    if (authUser) headers.set('X-Goog-AuthUser', authUser);
    const pageId = request.headers.get('x-goog-pageid');
    if (pageId) headers.set('X-Goog-PageId', pageId);
  }

  const target = anonymous ? GENERATE_IT_UPSTREAM : `${MUSIC_ORIGIN}/youtubei/v1/${endpoint}${url.search}`;
  const upstream = await fetch(target, {
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
      if (url.pathname === '/resolve') return await handleResolve(request, env, url);
      if (url.pathname === '/audio') return await handleAudio(request, env, url);
      if (url.pathname.startsWith('/yt/')) return await handleSigned(request, env, url);
      return json(request, env, { error: 'not found' }, 404);
    } catch (error) {
      // Never log the request: it may carry a session cookie.
      console.error(`${url.pathname} failed: ${error instanceof Error ? error.name : 'error'}`);
      return json(request, env, { error: 'upstream failure' }, 502);
    }
  },
} satisfies ExportedHandler<Env>;
