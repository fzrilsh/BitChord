// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The bridge talks to a sandboxed iframe over postMessage. happy-dom has no
 * real iframe, so the tests stand in a fake `contentWindow` and dispatch the
 * messages the sandbox document would send.
 */
describe('sandboxFetch', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  interface Stub {
    sent: Record<string, unknown>[];
    contentWindow: Window;
  }

  /** A fake iframe window: records what was posted and replies as the sandbox would. */
  function stubIframe(reply: (message: Record<string, unknown>) => unknown): Stub {
    const sent: Record<string, unknown>[] = [];
    const contentWindow = {
      postMessage: (message: Record<string, unknown>) => {
        sent.push(message);
        const response = reply(message);
        if (response) {
          window.dispatchEvent(new MessageEvent('message', { data: response, source: contentWindow as unknown as Window }));
        }
      },
    } as unknown as Window;

    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(contentWindow);
    // The iframe never really loads, so the bridge's ready wait is resolved by
    // dispatching `rpc:ready` below.
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
    return { sent, contentWindow };
  }

  function ready(contentWindow: Window): void {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'rpc:ready' }, source: contentWindow }));
  }

  it('sends a simple request (text/plain, safelisted headers only) and rebuilds the response', async () => {
    const { sandboxFetch } = await import('./bridge');
    const { sent, contentWindow } = stubIframe((message) =>
      message.type === 'rpc:fetch'
        ? {
            type: 'rpc:fetch:response',
            id: message.id,
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            body: '{"contents":{}}',
          }
        : null,
    );

    const promise = sandboxFetch('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
      method: 'POST',
      headers: { 'X-Custom': 'dropped', 'Accept-Language': 'en' },
      body: '{"browseId":"FEmusic_home"}',
    });

    await Promise.resolve();
    ready(contentWindow);

    const response = await promise;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ contents: {} });

    const call = sent.find((message) => message.type === 'rpc:fetch');
    expect(call).toBeDefined();
    expect(call!.url).toBe('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false');
    expect(call!.method).toBe('POST');
    expect(call!.body).toBe('{"browseId":"FEmusic_home"}');
    // Only safelisted headers survive: a custom one would trigger a preflight,
    // which youtubei answers with 400.
    expect(call!.headers).toEqual({ 'Accept-Language': 'en' });
  });

  it('rejects when the sandbox reports an error', async () => {
    const { sandboxFetch } = await import('./bridge');
    const { contentWindow } = stubIframe((message) =>
      message.type === 'rpc:fetch' ? { type: 'rpc:fetch:error', id: message.id, error: 'Failed to fetch' } : null,
    );

    const promise = sandboxFetch('https://music.youtube.com/youtubei/v1/browse');
    await Promise.resolve();
    ready(contentWindow);

    await expect(promise).rejects.toThrow('Failed to fetch');
  });

  it('ignores a reply that came from another window', async () => {
    const { sandboxFetch } = await import('./bridge');
    const { contentWindow } = stubIframe(() => null);

    const promise = sandboxFetch('https://music.youtube.com/youtubei/v1/browse');
    await Promise.resolve();
    ready(contentWindow);

    // Same shape as a real reply, but from the app's own window.
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'rpc:fetch:response', id: 'rpc-1', status: 200 }, source: window }));

    const settled = await Promise.race([promise.then(() => 'settled'), Promise.resolve('pending')]);
    expect(settled).toBe('pending');
  });
});
