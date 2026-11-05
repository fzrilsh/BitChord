// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A press on Play must not also pause.
 *
 * `togglePlay` used to decide "resume or pause" from `audio.paused` *after*
 * calling `play()` to unlock the element inside the gesture. WebKit sets
 * `paused` to false synchronously when `play()` is called, so that second read
 * saw a playing element and took the pause branch: one press ran play() then
 * pause() in the same tick, and resuming did nothing. Measured 2026-11-05 in
 * WebKit.
 *
 * The decision is now made once, before the element is touched.
 */

const play = vi.fn<() => Promise<void>>();
const pause = vi.fn();

vi.mock('@/playback/automix', () => ({ createAutomixGraph: vi.fn(), analyzer: null }));

/** A media element that behaves like WebKit's: play() clears `paused` at once. */
function fakeElement(): HTMLAudioElement {
  const element = document.createElement('audio');
  Object.defineProperty(element, 'paused', { get: () => paused, configurable: true });
  let paused = true;
  play.mockImplementation(async () => {
    paused = false;
  });
  pause.mockImplementation(() => {
    paused = true;
  });
  element.play = play as unknown as HTMLMediaElement['play'];
  element.pause = pause;
  return element;
}

describe('togglePlay', () => {
  beforeEach(() => {
    vi.resetModules();
    play.mockClear();
    pause.mockClear();
  });

  afterEach(() => vi.clearAllMocks());

  it('resumes without pausing when the element is paused', async () => {
    const { usePlayer, __setAudioForTest } = await import('./player');
    const element = fakeElement();
    __setAudioForTest(element);

    usePlayer.setState({
      nowPlaying: { videoId: 'v', title: 't', artist: 'a', artworkUrl: null, durationSec: 0, streamInfo: null, stream: null },
      status: 'paused',
      index: 0,
    });

    usePlayer.getState().togglePlay();

    expect(play).toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });

  it('pauses without playing when the element is playing', async () => {
    const { usePlayer, __setAudioForTest } = await import('./player');
    const element = fakeElement();
    __setAudioForTest(element);
    await element.play();

    usePlayer.setState({
      nowPlaying: { videoId: 'v', title: 't', artist: 'a', artworkUrl: null, durationSec: 0, streamInfo: null, stream: null },
      status: 'playing',
      index: 0,
    });
    play.mockClear();

    usePlayer.getState().togglePlay();

    expect(pause).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();
  });
});
