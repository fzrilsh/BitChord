import { useCallback, useEffect, useRef, useState } from 'react';
import { appBase, generateBookmarklet } from '@/auth/bookmarklet/generator';
import { clearSession, loadSession } from '@/auth/bookmarklet/storage';
import type { CapturedSession } from '@/auth/bookmarklet/types';
import { refreshYtAuth } from '@/extension/useYtAuth';
import { PageHeader } from '@/components/PageHeader';
import { settingsUi } from './settingsStyles';

/**
 * Signing in without the extension: the user signs in to YouTube Music in
 * their own tab, then taps a bookmarklet that hands the session over.
 *
 * There is no other way to reach the session: it lives on music.youtube.com's
 * origin, and the app cannot read it from there.
 */
export default function SignInPage() {
  const [session, setSession] = useState<CapturedSession | null>(null);
  const [copied, setCopied] = useState(false);
  const dragRef = useRef<HTMLAnchorElement>(null);

  const bookmarklet = generateBookmarklet({ appBase: appBase() });

  useEffect(() => {
    // The capture happens in another window, so read the store fresh rather
    // than trusting a cached "signed out".
    void (async () => {
      setSession(await loadSession());
      await refreshYtAuth();
    })();
  }, []);

  // React refuses to render a `javascript:` href (it swaps in a thrower), so
  // the draggable link's address is set on the element itself.
  useEffect(() => {
    dragRef.current?.setAttribute('href', bookmarklet);
  }, [bookmarklet]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard needs a gesture and a secure context; the code is on screen anyway.
      setCopied(false);
    }
  }, [bookmarklet]);

  const disconnect = useCallback(async () => {
    await clearSession();
    setSession(null);
    await refreshYtAuth();
  }, []);

  return (
    <div className={settingsUi.centered}>
      <PageHeader title="Sign in to YouTube Music" />
      <div className={settingsUi.body}>
        {session?.loggedIn ? (
          <div className={settingsUi.group}>
            <div className="px-4 py-5">
              <p className="type-title-3 text-green">Signed in</p>
              <p className={`mt-1 ${settingsUi.rowDetail}`}>
                Captured {new Date(session.capturedAt).toLocaleString()}
                {session.authUser !== null && ` · account ${Number(session.authUser) + 1}`}
                {session.pageId && ' · brand channel'}
              </p>
              <button
                className="mt-4 rounded-pill bg-quinary px-4 py-2 type-body-emphasized text-key"
                onClick={() => void disconnect()}
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={settingsUi.group}>
              <ol className="flex list-decimal flex-col gap-2 px-4 py-5 ps-9 type-body-tall text-secondary">
                <li>
                  Open <span className="text-primary">music.youtube.com</span> in this browser and sign in.
                </li>
                <li>Save the button below as a bookmark.</li>
                <li>
                  Go back to <span className="text-primary">music.youtube.com</span> and tap that bookmark.
                </li>
                <li>A window opens here with the result.</li>
              </ol>
            </div>

            <div className={`${settingsUi.group} mt-4`}>
              <div className="px-4 py-5">
                <p className={settingsUi.rowDetail}>
                  The button is a <span className="text-primary">bookmarklet</span>: a bookmark whose address is a small
                  program. Tapping it runs on the page you are on and hands your YouTube Music session to BitChord.
                </p>
                <a
                  ref={dragRef}
                  className="mt-4 block rounded-[10px] bg-key px-4 py-3 text-center type-title-3-emphasized text-white"
                  draggable
                  onClick={(event) => event.preventDefault()}
                >
                  BitChord · Connect YouTube Music
                </a>
                <button className="mt-3 rounded-pill bg-quinary px-4 py-2 type-body-emphasized" onClick={() => void copy()}>
                  {copied ? 'Copied' : 'Copy the bookmarklet instead'}
                </button>
                <details className="mt-4">
                  <summary className={`cursor-pointer ${settingsUi.rowDetail}`}>Show the code</summary>
                  <pre className="mt-2 overflow-x-auto rounded-[10px] bg-quaternary p-3 type-callout">{bookmarklet}</pre>
                </details>
              </div>
            </div>

            <p className={settingsUi.footer}>
              On iPhone, Safari cannot drag a bookmarklet to the bookmarks bar: copy it, make any bookmark for
              music.youtube.com, then edit that bookmark and paste this in place of its address.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
