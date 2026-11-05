import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index';

const env = {} as never;

function call(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`https://worker.test${path}`, init), env);
}

afterEach(() => vi.unstubAllGlobals());

describe('Worker', () => {
  it('answers preflights with CORS headers', async () => {
    const response = await call('/yt/browse', { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-headers')).toContain('X-Bitchord-Cookie');
  });

  it('refuses assets that are not on the allow-list', async () => {
    const response = await call(`/asset?u=${encodeURIComponent('https://evil.example/app.js')}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'u must be a YouTube asset this Worker serves' });
  });

  it('refuses signed endpoints outside InnerTube', async () => {
    const response = await call('/yt/account/delete', {
      method: 'POST',
      headers: { 'x-bitchord-cookie': 'SAPISID=x', 'x-bitchord-auth': 'SAPISIDHASH 1_abc' },
    });
    expect(response.status).toBe(403);
  });

  it('refuses a signed call with no session', async () => {
    const response = await call('/yt/browse', { method: 'POST', body: '{}' });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'missing session' });
  });

  it('forwards a signed call with Cookie and Origin set, and the body untouched', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), init: init ?? {} });
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const response = await call('/yt/browse?prettyPrint=false', {
      method: 'POST',
      headers: {
        'x-bitchord-cookie': 'SAPISID=secret; SID=abc',
        'x-bitchord-auth': 'SAPISIDHASH 1700000000_deadbeef',
        'x-goog-authuser': '3',
      },
      body: '{"browseId":"FEmusic_home"}',
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');
    expect(seen).toHaveLength(1);

    const [request] = seen;
    expect(request!.url).toBe('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false');
    const headers = new Headers(request!.init.headers);
    expect(headers.get('cookie')).toBe('SAPISID=secret; SID=abc');
    expect(headers.get('authorization')).toBe('SAPISIDHASH 1700000000_deadbeef');
    expect(headers.get('origin')).toBe('https://music.youtube.com');
    expect(headers.get('x-goog-authuser')).toBe('3');
    expect(request!.init.body).toBe('{"browseId":"FEmusic_home"}');
  });

  it('fetches an allow-listed asset with YouTube Origin and exposes it to any origin', async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init ?? {});
      return new Response(')]}\'\n[["yt.sw.adr"]]', { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const response = await call(`/asset?u=${encodeURIComponent('https://www.youtube.com/sw.js_data')}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(new Headers(seen[0]!.headers).get('origin')).toBe('https://www.youtube.com');
  });

  it('restricts CORS to ALLOWED_ORIGINS when set', async () => {
    const restricted = { ALLOWED_ORIGINS: 'https://fzrilsh.github.io' } as never;
    const response = await worker.fetch(
      new Request('https://worker.test/health', { headers: { Origin: 'https://fzrilsh.github.io' } }),
      restricted,
    );
    expect(response.headers.get('access-control-allow-origin')).toBe('https://fzrilsh.github.io');
  });
});
