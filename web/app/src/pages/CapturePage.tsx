import { useEffect, useRef, useState } from 'react';
import { parseSigningSecret } from '@/auth/bookmarklet/sapisidHash';
import { saveSession } from '@/auth/bookmarklet/storage';
import type { CaptureMessage, CapturedSession } from '@/auth/bookmarklet/types';
import { PageHeader } from '@/components/PageHeader';
import { refreshYtAuth } from '@/extension/useYtAuth';
import { settingsUi } from './settingsStyles';

const YT_MUSIC_ORIGIN = 'https://music.youtube.com';

function isCaptureMessage(value: unknown): value is CaptureMessage {
  const message = value as Partial<CaptureMessage> | null;
  return (
    typeof message === 'object' &&
    message !== null &&
    message.type === 'bitchord:capture' &&
    typeof message.cookie === 'string' &&
    typeof message.cfg === 'object' &&
    message.cfg !== null
  );
}

/**
 * The window the bookmarklet opens on music.youtube.com. It receives the
 * captured session, encrypts and stores it, and says what happened.
 *
 * Only messages from music.youtube.com are accepted, and the payload is checked
 * before anything is stored.
 */
export default function CapturePage() {
  const [status, setStatus] = useState<'waiting' | 'saved' | 'error'>('waiting');
  const [detail, setDetail] = useState('Waiting for the bookmarklet…');
  const saved = useRef(false);

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== YT_MUSIC_ORIGIN) return;
      if (!isCaptureMessage(event.data)) return;
      if (saved.current) return;

      const message = event.data;
      if (!parseSigningSecret(message.cookie)) {
        setStatus('error');
        setDetail('That page is not signed in to YouTube Music (no signing cookie). Sign in there first, then tap the bookmark again.');
        return;
      }
      if (!message.cfg.loggedIn) {
        setStatus('error');
        setDetail('YouTube Music reported the page as signed out. Sign in there first, then tap the bookmark again.');
        return;
      }

      const session: CapturedSession = {
        cookie: message.cookie,
        pageId: message.cfg.pageId,
        dataSyncId: message.cfg.dataSyncId,
        authUser: message.cfg.authUser,
        visitorData: message.cfg.visitorData,
        clientVersion: message.cfg.clientVersion,
        loggedIn: true,
        capturedAt: Date.now(),
      };

      try {
        await saveSession(session);
        saved.current = true;
        // The auth read caches for 30 s; re-read now so every open window notices.
        await refreshYtAuth();
        setStatus('saved');
        setDetail('Session captured. You can close this window and go back to BitChord.');
      } catch (error) {
        setStatus('error');
        setDetail(`Couldn’t store the session: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const tone = status === 'saved' ? 'text-green' : status === 'error' ? 'text-key' : 'text-secondary';

  return (
    <div className={settingsUi.centered}>
      <PageHeader title="Connecting YouTube Music" />
      <div className={settingsUi.body}>
        <div className={settingsUi.group}>
          <div className="px-4 py-5">
            <p className={`type-title-3 ${tone}`}>{detail}</p>
            {status === 'waiting' && (
              <p className={`mt-2 ${settingsUi.rowDetail}`}>
                The bookmarklet on music.youtube.com opens this window. If nothing happens, check that the bookmark was
                tapped on music.youtube.com and that popups are allowed for that site.
              </p>
            )}
            {status === 'saved' && (
              <button className="mt-4 rounded-pill bg-key px-4 py-2 type-body-emphasized text-white" onClick={() => window.close()}>
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
