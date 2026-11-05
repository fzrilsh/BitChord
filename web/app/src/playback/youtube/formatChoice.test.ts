import { describe, expect, it } from 'vitest';
import { pickDirectAudio } from './engine';

/**
 * YouTube's AAC fragments report twice their real length in WebKit.
 *
 * The AAC (`audio/mp4`) fragment carries a `sidx` with timescale 1 while its
 * subsegment durations are in 44,100 ticks, and WebKit believes the `sidx` over
 * the `mvhd`. Measured 2026-11-05 on "Teh Hijau" (3:31): `mvhd` 211.023 s,
 * element 421.998 s. The same track's Opus rendition reads 210.981 s.
 *
 * So Opus is preferred whenever the element can decode it.
 */

type Format = Parameters<typeof pickDirectAudio>[0][number];

const format = (over: Partial<Format> & { itag: number; mime_type: string; bitrate: number }): Format =>
  ({ has_audio: true, has_video: false, ...over }) as Format;

const AAC_140 = format({ itag: 140, mime_type: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 131_000 });
const AAC_139 = format({ itag: 139, mime_type: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 49_000 });
const OPUS_251 = format({ itag: 251, mime_type: 'audio/webm; codecs="opus"', bitrate: 130_000 });
const OPUS_250 = format({ itag: 250, mime_type: 'audio/webm; codecs="opus"', bitrate: 70_000 });

const canPlay = (supported: string[]) => (type: string) => (supported.some((s) => type.includes(s)) ? 'probably' : '');

describe('pickDirectAudio', () => {
  it('prefers Opus, whose duration WebKit reads correctly', () => {
    expect(pickDirectAudio([AAC_140, OPUS_251], canPlay(['opus']))?.itag).toBe(251);
  });

  it('takes the highest-bitrate Opus when several are offered', () => {
    expect(pickDirectAudio([OPUS_250, OPUS_251], canPlay(['opus']))?.itag).toBe(251);
  });

  it('falls back to AAC 140 when Opus cannot be decoded', () => {
    expect(pickDirectAudio([AAC_139, AAC_140, OPUS_251], canPlay([]))?.itag).toBe(140);
  });

  it('falls back to the best AAC when 140 is absent', () => {
    expect(pickDirectAudio([AAC_139], canPlay([]))?.itag).toBe(139);
  });

  it('still offers the only format it has, rather than nothing', () => {
    // Better to try an Opus URL on a browser that claimed not to support it than
    // to drop the track: canPlayType is a hint, not a guarantee.
    expect(pickDirectAudio([OPUS_251], canPlay([]))?.itag).toBe(251);
  });

  it('answers undefined for an empty list', () => {
    expect(pickDirectAudio([], canPlay(['opus']))).toBeUndefined();
  });
});
