/**
 * The sandboxed iframe that makes anonymous InnerTube calls possible without
 * the extension (pure web, iOS Safari).
 *
 * youtubei answers a normal page origin with 403 — not a CORS failure, a
 * rejection. It answers an opaque origin (`Origin: null`, which is what a
 * `sandbox="allow-scripts"` iframe without `allow-same-origin` sends) with 200
 * and `Access-Control-Allow-Origin: null`.
 *
 * Because the requests leave from the device, the googlevideo URLs they mint
 * are signed for the device's IP, which is the only way audio can play
 * (measured: URLs minted elsewhere answer 403 on the device).
 *
 * The iframe holds no app state and never receives the session cookie.
 */

const READY_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 30_000;

/**
 * Headers a request may carry without triggering a preflight. youtubei
 * answers a preflight with 400, so a custom header (YouTube.js sets
 * `X-Goog-Visitor-Id`, `X-Youtube-Client-*`) must be dropped; everything it
 * carries also travels in the body's `context.client` (as `simpleRequestFetch`
 * does for the extension path).
 */
const SAFELISTED = new Set(['accept', 'accept-language', 'content-language']);

interface Pending {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let iframe: HTMLIFrameElement | null = null;
let ready: Promise<void> | null = null;
let nextId = 0;
const pending = new Map<string, Pending>();
let listening = false;

function isSandboxMessage(value: unknown): value is { type: string; id?: string } {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('message', (event) => {
    // The sandbox's origin is "null", so the window is the identity to check.
    if (!iframe || event.source !== iframe.contentWindow) return;
    const message = event.data;
    if (!isSandboxMessage(message) || !message.id) return;

    const entry = pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(message.id);

    if (message.type === 'rpc:fetch:response') {
      const response = message as unknown as { status: number; statusText: string; headers: Record<string, string>; body: string };
      entry.resolve(
        new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers }),
      );
    } else if (message.type === 'rpc:fetch:error') {
      entry.reject(new Error((message as unknown as { error: string }).error));
    }
  });
}

/** The sandbox document's URL, under whatever base the app is served from. */
function sandboxUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  return new URL(`${base.endsWith('/') ? base : `${base}/`}sandbox.html`, window.location.href).href;
}

function ensureIframe(): HTMLIFrameElement {
  listen();
  if (iframe && document.body.contains(iframe)) return iframe;

  const element = document.createElement('iframe');
  element.setAttribute('sandbox', 'allow-scripts');
  element.setAttribute('aria-hidden', 'true');
  element.tabIndex = -1;
  element.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
  element.src = sandboxUrl();
  document.body.appendChild(element);
  iframe = element;

  ready = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, READY_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== element.contentWindow) return;
      if (!isSandboxMessage(event.data) || event.data.type !== 'rpc:ready') return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve();
    };
    window.addEventListener('message', onMessage);
  });
  return element;
}

/** A `fetch` that runs inside the sandbox, shaped like the global one. */
export async function sandboxFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = request ? request.url : input.toString();
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

  const headers: Record<string, string> = {};
  new Headers(init?.headers ?? request?.headers).forEach((value, key) => {
    if (SAFELISTED.has(key.toLowerCase())) headers[key] = value;
  });

  let body: string | null = null;
  if (init?.body != null) {
    body = typeof init.body === 'string' ? init.body : await new Response(init.body as BodyInit).text();
  } else if (request && method !== 'GET' && method !== 'HEAD') {
    body = await request.text();
  }

  const element = ensureIframe();
  await ready;

  return new Promise<Response>((resolve, reject) => {
    const id = `rpc-${++nextId}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Sandbox request timed out: ${method} ${url}`));
    }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    element.contentWindow?.postMessage({ type: 'rpc:fetch', id, url, method, headers, body }, '*');
  });
}

/** Whether a sandbox can be used at all (there is a document to attach it to). */
export function sandboxAvailable(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

/** Removes the iframe; for tests and for a full sign-out. */
export function disposeSandbox(): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new Error('Sandbox disposed'));
  }
  pending.clear();
  iframe?.remove();
  iframe = null;
  ready = null;
}
