import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientsFor, excludeClient, onSessionChanged } from './resolver';

/**
 * The client order is not cosmetic: it decides which URL the media element is
 * handed. Two bugs are locked down here.
 *
 * 1. Signed in, the web clients answer with SABR or a URL that has to be
 *    deciphered by the player script — and iOS refuses that script. On the
 *    direct path the phone clients must therefore come first, or signing in
 *    takes playback away.
 * 2. A client that refused a track sits out for ten minutes, so the next walk
 *    must not offer it again.
 */

afterEach(() => {
  onSessionChanged();
  vi.restoreAllMocks();
});

describe('clientsFor', () => {
  it('starts the direct path with VISIONOS, which serves full-length URLs', () => {
    expect(clientsFor('video', false, true)[0]).toBe('VISIONOS');
  });

  it('offers the phone clients on the direct path, and never MWEB (its redirect iOS will not follow)', () => {
    const order = clientsFor('video', false, true);
    expect(order).toContain('IOS');
    expect(order).toContain('ANDROID');
    expect(order).not.toContain('MWEB');
  });

  it('signed in on the direct path, reaches a phone client before any web client', () => {
    const order = clientsFor('video', true, true);
    const phone = Math.min(order.indexOf('IOS'), order.indexOf('ANDROID'));
    const web = Math.min(order.indexOf('YTMUSIC'), order.indexOf('WEB'));
    expect(phone).toBeGreaterThanOrEqual(0);
    expect(phone).toBeLessThan(web);
  });

  it('signed in on the SABR path, still leads with the web clients', () => {
    expect(clientsFor('video', true, false).slice(0, 2)).toEqual(['YTMUSIC', 'WEB']);
  });

  it('drops a client that just refused the track', () => {
    expect(clientsFor('video', false, true)).toContain('IOS');
    excludeClient('video', 'IOS', 'streaming failed');
    expect(clientsFor('video', false, true)).not.toContain('IOS');
  });

  it('keeps the exclusion per identity: a signed-in walk still tries IOS', () => {
    excludeClient('video', 'IOS', 'streaming failed');
    expect(clientsFor('video', true, true)).toContain('IOS');
  });

  it('forgets every exclusion when the session changes', () => {
    excludeClient('video', 'IOS', 'streaming failed');
    onSessionChanged();
    expect(clientsFor('video', false, true)).toContain('IOS');
  });
});
