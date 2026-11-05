/**
 * The bookmarklet, as a `javascript:` URL the user saves as a bookmark.
 *
 * It runs on music.youtube.com, where `document.cookie` holds the session and
 * `ytcfg` knows which account and channel the page is showing. It then opens
 * the app's capture page and posts them across.
 *
 * The direction matters: music.youtube.com sends
 * `Cross-Origin-Opener-Policy: same-origin-allow-popups`, which severs
 * `window.opener` when *the app* opens the YouTube tab. A popup the YouTube tab
 * opens is allowed to reach its opener, so the bookmarklet opens the app, not
 * the other way round.
 *
 * Ported from the Android probe (YtMusicLoginScreen.kt:YTCFG_PROBE) and its
 * capture (WebSession.kt:CapturedSession).
 */

export interface BookmarkletOptions {
  /** The app's origin and path, without a trailing slash, e.g. `https://fzrilsh.github.io/BitChord`. */
  appBase: string;
  /** The router's capture route, hash-routed by default. */
  capturePath?: string;
}

export function captureUrl({ appBase, capturePath = '/capture' }: BookmarkletOptions): string {
  const base = appBase.replace(/\/+$/, '');
  // Hash routing: GitHub Pages cannot rewrite deep paths to index.html.
  return `${base}/#${capturePath}`;
}

export function generateBookmarklet(options: BookmarkletOptions): string {
  const base = options.appBase.replace(/\/+$/, '');
  const target = captureUrl(options);
  const code = `(function(){
  var w = window.open(${JSON.stringify(target)}, 'bitchord_capture', 'width=440,height=680');
  if (!w) { alert('BitChord: allow popups for music.youtube.com, then tap the bookmark again.'); return; }
  var get = function(k){
    try { var v = window.ytcfg && window.ytcfg.get(k); return (v === undefined || v === null || v === '') ? null : String(v); }
    catch (e) { return null; }
  };
  var payload = {
    type: 'bitchord:capture',
    cookie: document.cookie,
    cfg: {
      loggedIn: get('LOGGED_IN') === 'true',
      pageId: get('DELEGATED_SESSION_ID'),
      dataSyncId: get('DATASYNC_ID'),
      authUser: get('SESSION_INDEX'),
      visitorData: get('VISITOR_DATA'),
      clientVersion: get('INNERTUBE_CLIENT_VERSION')
    },
    at: Date.now()
  };
  var send = function(){
    try { w.postMessage(payload, ${JSON.stringify(base)}); }
    catch (e) { w.location.href = ${JSON.stringify(target)} + '?error=' + encodeURIComponent(String(e)); }
  };
  if (w.document.readyState === 'complete') send();
  else w.addEventListener('load', send, { once: true });
  setTimeout(send, 1500);
})();`;
  return `javascript:${encodeURIComponent(code)}`;
}

/** The app's own base URL, path included, for building the bookmarklet. */
export function appBase(): string {
  const base = import.meta.env.BASE_URL || '/';
  const path = `${window.location.origin}${base}`.replace(/\/+$/, '');
  return path;
}
