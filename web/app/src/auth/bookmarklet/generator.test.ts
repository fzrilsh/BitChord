// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { captureUrl, generateBookmarklet } from './generator';

const base = 'https://fzrilsh.github.io/BitChord';

describe('captureUrl', () => {
  it('uses the hash router, so GitHub Pages never sees a deep path', () => {
    expect(captureUrl({ appBase: base })).toBe(`${base}/#/capture`);
    expect(captureUrl({ appBase: `${base}/` })).toBe(`${base}/#/capture`);
  });
});

describe('generateBookmarklet', () => {
  const bookmarklet = generateBookmarklet({ appBase: base });
  const code = decodeURIComponent(bookmarklet.replace(/^javascript:/, ''));

  it('is a javascript: URL', () => {
    expect(bookmarklet.startsWith('javascript:')).toBe(true);
  });

  it('opens the app itself (the YouTube tab must be the opener, not the other way round)', () => {
    expect(code).toContain(`window.open("${base}/#/capture"`);
  });

  it('reads the same ytcfg fields as the Android probe', () => {
    for (const key of ['LOGGED_IN', 'DELEGATED_SESSION_ID', 'DATASYNC_ID', 'SESSION_INDEX', 'VISITOR_DATA', 'INNERTUBE_CLIENT_VERSION']) {
      expect(code).toContain(key);
    }
  });

  it('posts the cookie jar to the app origin only', () => {
    expect(code).toContain('cookie: document.cookie');
    expect(code).toContain(`w.postMessage(payload, "${base}")`);
  });

  it('tells the user when the popup was blocked instead of failing silently', () => {
    expect(code).toContain('allow popups');
  });
});
