import { PrefetchLink } from '@/components/PrefetchLink';

/** A page-sized message, centred: also the Spotify page's sign-in invitation. */
export const stateStyles = {
  state: 'mx-auto my-20 flex max-w-[420px] flex-col items-center gap-2 px-(--body-gutter) text-center',
  title: 'type-title-2-emphasized',
  detail: 'type-body-tall text-secondary',
  button: 'mt-3 inline-flex h-8 items-center rounded-pill bg-key-bg px-4 type-body-emphasized text-white',
};

/**
 * In place of a YouTube page when requests can't be made at all: the extension
 * isn't installed and no Worker is configured. An invitation, not an error.
 */
export function NeedsExtension({ what = 'YouTube Music' }: { what?: string }) {
  return (
    <div className={stateStyles.state}>
      <p className={stateStyles.title}>Browse {what} with the BitChord extension</p>
      <p className={stateStyles.detail}>
        The extension lets this page reach YouTube Music from your own browser. Addons and lyrics work without it.
      </p>
      <PrefetchLink to="/extension" className={stateStyles.button}>
        Get the Extension
      </PrefetchLink>
    </div>
  );
}

/**
 * In place of a page that needs an account, on the pure-web build: there is no
 * extension to sign in through, so the session comes from the bookmarklet.
 */
export function NeedsSignIn({ what = 'your library' }: { what?: string }) {
  return (
    <div className={stateStyles.state}>
      <p className={stateStyles.title}>Sign in to see {what}</p>
      <p className={stateStyles.detail}>
        Sign in at music.youtube.com, then hand the session to BitChord with the bookmarklet. It stays on this device.
      </p>
      <PrefetchLink to="/sign-in" className={stateStyles.button}>
        Sign In
      </PrefetchLink>
    </div>
  );
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className={stateStyles.state}>
      <p className={stateStyles.title}>Couldn’t load this page</p>
      <p className={stateStyles.detail}>{error instanceof Error ? error.message : String(error)}</p>
      <button className={stateStyles.button} onClick={onRetry}>
        Try Again
      </button>
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className={stateStyles.state}>
      <p className={stateStyles.title}>{title}</p>
      {detail && <p className={stateStyles.detail}>{detail}</p>}
    </div>
  );
}

/** A later page of a long list failed: what's loaded stays, with a way to try again. */
export function LoadMoreError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center gap-2.5 px-(--body-gutter) pt-6 pb-10 type-callout text-secondary">
      <span>Couldn’t load more.</span>
      <button className="type-callout-emphasized text-key" onClick={onRetry}>
        Try Again
      </button>
    </div>
  );
}
