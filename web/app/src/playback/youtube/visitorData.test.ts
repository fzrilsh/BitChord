import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * visitorData decides whether a track plays in full.
 *
 * YouTube binds a visitorData to the address that asked for it. The session
 * bootstrap arrives through the Worker, so the one it carries was minted for
 * Cloudflare's IP; a player request that presents it from the phone is answered
 * LOGIN_REQUIRED, and VISIONOS — the only client that serves full-length audio —
 * becomes unreachable. Measured 2026-11-05: VISIONOS answers OK and serves
 * every byte range with the device's own visitorData, LOGIN_REQUIRED with the
 * Worker's.
 *
 * These tests pin the shape of the fix: the device's value is read from a
 * sandboxed youtubei call and cached, and the bootstrap still goes through the
 * Worker (a sandbox cannot read /sw.js_data — it carries no ACAO).
 */

const sandboxFetch = vi.fn();

vi.mock('./sandbox/bridge', () => ({
  sandboxFetch: (...args: unknown[]) => sandboxFetch(...args),
  sandboxAvailable: () => true,
}));

vi.mock('@/extension/bridge', () => ({ getBridge: () => null }));
vi.mock('@/extension/useYtAuth', () => ({
  ensureYtAuth: async () => null,
  identityOf: () => 'anonymous',
  noteMusicIdentity: () => {},
}));
vi.mock('@/config', () => ({ config: { workerUrl: 'https://worker.test' } }));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('deviceVisitorData', () => {
  it('reads the device’s visitorData from a sandboxed youtubei call', async () => {
    sandboxFetch.mockResolvedValue(
      new Response(JSON.stringify({ responseContext: { visitorData: 'DEVICE-VD' } }), { status: 200 }),
    );
    const { deviceVisitorData } = await import('./innertube');
    await expect(deviceVisitorData()).resolves.toBe('DEVICE-VD');
    const [url, init] = sandboxFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/youtubei/v1/');
    expect(String(init.body)).toContain('"clientName":"WEB"');
  });

  it('caches the answer: one request per page, not one per track', async () => {
    sandboxFetch.mockResolvedValue(
      new Response(JSON.stringify({ responseContext: { visitorData: 'DEVICE-VD' } }), { status: 200 }),
    );
    const { deviceVisitorData } = await import('./innertube');
    await Promise.all([deviceVisitorData(), deviceVisitorData(), deviceVisitorData()]);
    expect(sandboxFetch).toHaveBeenCalledTimes(1);
  });

  it('answers null rather than throwing when the call fails', async () => {
    sandboxFetch.mockRejectedValue(new Error('Load failed'));
    const { deviceVisitorData } = await import('./innertube');
    await expect(deviceVisitorData()).resolves.toBeNull();
  });

  it('answers null when the response carries no visitorData', async () => {
    sandboxFetch.mockResolvedValue(new Response(JSON.stringify({ responseContext: {} }), { status: 200 }));
    const { deviceVisitorData } = await import('./innertube');
    await expect(deviceVisitorData()).resolves.toBeNull();
  });
});
