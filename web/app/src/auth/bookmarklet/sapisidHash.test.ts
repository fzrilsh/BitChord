import { describe, expect, it, vi } from 'vitest';
import { parseSigningSecret, sapisidHash } from './sapisidHash';

describe('parseSigningSecret', () => {
  it('prefers SAPISID, then the __Secure variants, in order', () => {
    expect(parseSigningSecret('SID=a; SAPISID=s1; __Secure-3PAPISID=s3')).toBe('s1');
    expect(parseSigningSecret('SID=a; __Secure-1PAPISID=s1p; __Secure-3PAPISID=s3')).toBe('s3');
    expect(parseSigningSecret('SID=a; __Secure-1PAPISID=s1p')).toBe('s1p');
  });

  it('returns null for a signed-out jar', () => {
    expect(parseSigningSecret('SID=a; SIDCC=b')).toBeNull();
    expect(parseSigningSecret('')).toBeNull();
  });

  it('tolerates spacing and values containing "="', () => {
    expect(parseSigningSecret('  SAPISID = abc==  ; SID=x')).toBe('abc==');
  });
});

describe('sapisidHash', () => {
  it('formats as SAPISIDHASH <seconds>_<40 hex chars>', async () => {
    const hash = await sapisidHash('secret');
    expect(hash).toMatch(/^SAPISIDHASH \d{10}_[0-9a-f]{40}$/);
  });

  it('hashes "<ts> <secret> <origin>" with SHA-1', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const timestamp = Math.floor(Date.now() / 1000);

    const expected = await crypto.subtle.digest(
      'SHA-1',
      new TextEncoder().encode(`${timestamp} secret https://music.youtube.com`),
    );
    const hex = [...new Uint8Array(expected)].map((b) => b.toString(16).padStart(2, '0')).join('');

    await expect(sapisidHash('secret')).resolves.toBe(`SAPISIDHASH ${timestamp}_${hex}`);
    vi.useRealTimers();
  });
});
