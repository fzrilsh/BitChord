// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { decodeSession, encodeSession } from './storage';
import type { CapturedSession } from './types';

const session: CapturedSession = {
  cookie: 'SAPISID=abc; SID=def',
  pageId: null,
  dataSyncId: 'UC1||UC1',
  authUser: '2',
  visitorData: 'Cgt2aXNpdG9y',
  clientVersion: '1.20261031.09.00',
  loggedIn: true,
  capturedAt: 1_790_000_000_000,
};

describe('session transfer string', () => {
  it('round-trips a captured session', () => {
    expect(decodeSession(encodeSession(session))).toEqual(session);
  });

  it('carries the cookie jar, which is what the Home Screen app cannot otherwise get', () => {
    const decoded = decodeSession(encodeSession(session));
    expect(decoded?.cookie).toBe(session.cookie);
  });

  it('rejects anything that is not one of its strings', () => {
    expect(decodeSession('')).toBeNull();
    expect(decodeSession('SAPISID=abc')).toBeNull();
    expect(decodeSession('bitchord-session:not-base64!!')).toBeNull();
  });

  it('rejects a string whose payload is signed out', () => {
    const signedOut = btoa(JSON.stringify({ ...session, loggedIn: false }));
    expect(decodeSession(`bitchord-session:${signedOut}`)).toBeNull();
  });

  it('tolerates surrounding whitespace from a paste', () => {
    expect(decodeSession(`  ${encodeSession(session)}\n`)).toEqual(session);
  });
});
