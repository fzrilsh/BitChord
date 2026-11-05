/**
 * A YouTube Music session lifted out of the user's own signed-in tab by the
 * bookmarklet. Mirrors the Android app's `CapturedSession` (WebSession.kt): the
 * cookie jar plus who the page being looked at says it is.
 *
 * The identity fields come from the live page's `ytcfg`, not from a later
 * server-side guess. Individual fields are nullable because a personal viewer
 * need not have a channel, and `pageId` is set only while a brand channel is
 * selected.
 */
export interface CapturedSession {
  /** `document.cookie` from music.youtube.com, exactly as the page had it. */
  cookie: string;
  /** `DELEGATED_SESSION_ID` — set only while a brand channel is selected. */
  pageId: string | null;
  /** `DATASYNC_ID`, normalised the way WebSession.kt does. */
  dataSyncId: string | null;
  /** `SESSION_INDEX` — which Google login in the jar. */
  authUser: string | null;
  visitorData: string | null;
  clientVersion: string | null;
  /** Whether the page reported itself signed in at all. */
  loggedIn: boolean;
  /** When it was captured, for staleness checks. */
  capturedAt: number;
}

/** The message the bookmarklet posts to the app's capture window. */
export interface CaptureMessage {
  type: 'bitchord:capture';
  cookie: string;
  cfg: {
    loggedIn: boolean;
    pageId: string | null;
    dataSyncId: string | null;
    authUser: string | null;
    visitorData: string | null;
    clientVersion: string | null;
  };
  at: number;
}
