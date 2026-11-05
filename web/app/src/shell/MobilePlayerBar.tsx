import { PauseIcon, PlayIcon } from '@/components/icons/Transport';
import { sizedArtwork } from '@/lib/artwork';
import { usePlayer } from '@/state/player';
import { useUi } from '@/state/ui';

/**
 * The player on a phone: the desktop pill is hidden below `sm`, and the
 * full-screen player only opens on a tap, so without this a track started
 * from search or Home had no controls and no way in.
 *
 * One row: artwork, title and artist, play/pause. Tapping the row (anywhere
 * but the button) opens the full-screen player.
 */
export function MobilePlayerBar() {
  const nowPlaying = usePlayer((s) => s.nowPlaying);
  const status = usePlayer((s) => s.status);
  const togglePlay = usePlayer((s) => s.togglePlay);
  const setFullScreen = useUi((s) => s.setFullScreen);

  if (!nowPlaying) return null;
  const playing = status === 'playing' || status === 'buffering';
  const artwork = nowPlaying.artworkUrl ? sizedArtwork(nowPlaying.artworkUrl, 96) : null;

  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[calc(var(--z-web-chrome)-1)] sm:hidden">
      <div
        className="pointer-events-auto flex items-center gap-3 rounded-[14px] bg-header-material px-2 py-2 shadow-lg backdrop-blur-xl"
        role="region"
        aria-label="Player"
      >
        <button
          className="flex min-w-0 flex-1 items-center gap-3 text-start"
          onClick={() => setFullScreen(true)}
          aria-label="Open player"
        >
          {artwork ? (
            <img src={artwork} alt="" className="size-11 flex-none rounded-[8px] object-cover" referrerPolicy="no-referrer" />
          ) : (
            <span className="size-11 flex-none rounded-[8px] bg-quinary" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate type-body-emphasized text-primary">{nowPlaying.title}</span>
            <span className="block truncate type-callout text-secondary">{nowPlaying.artist}</span>
          </span>
        </button>
        <button
          className="grid size-11 flex-none place-items-center rounded-full text-primary"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={togglePlay}
        >
          {playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
        </button>
      </div>
    </div>
  );
}
