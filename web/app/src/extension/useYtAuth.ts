import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { DetectedExtension, YtAuthState } from '@bitchord/shared/bridge';
import type { CapturedSession } from '@/auth/bookmarklet/types';
import { queryClient } from '@/lib/queryClient';
import { extensionQueryKey, useExtension } from './useExtension';

/**
 * Who YouTube requests act as (prompt §5.3). The extension owns the session;
 * this is the page's copy of the names and pictures it reports, kept current
 * three ways: a read on start, the extension's pushes (Bridge.subscribe), and
 * a re-read when the tab regains focus, for the pushes a sleeping worker
 * missed.
 */

export const ytAuthQueryKey = ['yt', 'auth'] as const;

const SIGNED_OUT: YtAuthState = { browserSignedIn: false, connected: true, signedIn: false, accounts: [], active: null, problem: null };

function detected(): DetectedExtension | null {
  return queryClient.getQueryData<DetectedExtension | null>(extensionQueryKey) ?? null;
}

function supportsAuth(extension: DetectedExtension | null): boolean {
  return !!extension?.info.capabilities.includes('yt.auth');
}

/** The current state, for code outside React (the music API, the player). */
export function ytAuthSnapshot(): YtAuthState {
  return queryClient.getQueryData<YtAuthState>(ytAuthQueryKey) ?? SIGNED_OUT;
}

/** A key for "who is asking", which changes whenever the answers YouTube gives would. */
export function identityOf(state: YtAuthState): string {
  return state.signedIn && state.active ? state.active.id : 'anonymous';
}

let lastIdentity: string | null = null;
/**
 * Who the cached ['music', …] queries were fetched as (getMusicClient notes
 * it). Not the same as the last state adopted: a browse request that ran
 * before the auth read came back (or after it failed) went out anonymous, and
 * that has to be noticed when the real identity arrives.
 */
let musicIdentity: string | null = null;

export function noteMusicIdentity(identity: string): void {
  musicIdentity ??= identity;
  if (musicIdentity !== identity) resetMusic();
  musicIdentity = identity;
}

function resetMusic(): void {
  musicIdentity = null;
  void queryClient.cancelQueries({ queryKey: ['music'] }).then(() => queryClient.resetQueries({ queryKey: ['music'] }));
}

/**
 * Takes in a new state. When the identity changes (sign-in, sign-out, a
 * channel switch), everything read as the old identity is dropped: the home
 * feed, the library, playlists, and the resolver's verdicts.
 */
function adopt(state: YtAuthState): void {
  queryClient.setQueryData(ytAuthQueryKey, state);
  const identity = identityOf(state);
  if (lastIdentity !== null && identity !== lastIdentity) {
    // Loaded on demand: the resolver pulls in BotGuard, which the shell shouldn't.
    void import('@/playback/youtube/resolver').then((m) => m.onSessionChanged());
  }
  if (musicIdentity !== null && identity !== musicIdentity) resetMusic();
  lastIdentity = identity;
}

/**
 * The captured bookmarklet session, as the same `YtAuthState` the extension
 * reports. The page only knows what the capture recorded — a name or picture
 * would need an InnerTube call, which the sign-in page does not make.
 */
function bookmarkletState(session: CapturedSession): YtAuthState {
  const authUser = session.authUser ?? '0';
  const pageId = session.pageId;
  const channel = {
    id: `${authUser}:${pageId ?? 'own'}`,
    name: 'YouTube Music',
    handle: null,
    avatarUrl: null,
    brand: pageId !== null,
  };
  return {
    browserSignedIn: true,
    connected: true,
    signedIn: session.loggedIn,
    accounts: [{ authUser, name: 'YouTube Music', email: null, avatarUrl: null, channels: [channel] }],
    active: { ...channel, authUser },
    problem: null,
  };
}

async function readAuth(refresh: boolean): Promise<YtAuthState> {
  const extension = detected();
  if (extension && supportsAuth(extension)) {
    const state = await extension.bridge.call('yt.authState', { refresh }, { timeoutMs: 20_000 });
    adopt(state);
    return state;
  }

  // No extension (iOS Safari, or a browser that cannot install one): the
  // session comes from the bookmarklet capture instead.
  const { loadSession } = await import('@/auth/bookmarklet/storage');
  const session = await loadSession();
  const state = session?.loggedIn ? bookmarkletState(session) : SIGNED_OUT;
  adopt(state);
  return state;
}

/** Waits for the extension and the first auth read, so the first browse request already knows who is asking. */
export async function ensureYtAuth(): Promise<YtAuthState> {
  const cached = queryClient.getQueryData<YtAuthState>(ytAuthQueryKey);
  if (cached) return cached;
  return queryClient.fetchQuery({ queryKey: ytAuthQueryKey, queryFn: () => readAuth(false), staleTime: 30_000 });
}

/**
 * Re-reads the auth state after the captured session changed (the capture page
 * stores it in another window). Dropping the query rather than invalidating it
 * makes the next read synchronous with the new state: a stale SIGNED_OUT would
 * otherwise stay for its 30 s, and every page already open would keep showing
 * "sign in" with a session in hand.
 */
export async function refreshYtAuth(): Promise<YtAuthState> {
  queryClient.removeQueries({ queryKey: ytAuthQueryKey });
  return queryClient.fetchQuery({ queryKey: ytAuthQueryKey, queryFn: () => readAuth(false), staleTime: 30_000 });
}

export type YtAuthStatus = { state: 'checking' } | { state: 'unavailable' } | { state: 'ready'; auth: YtAuthState };

export function useYtAuth(): YtAuthStatus {
  const extension = useExtension();
  const present = extension.state === 'present' ? extension.extension : null;
  const supported = supportsAuth(present);
  // Without the extension the bookmarklet session is the source, so the read
  // still runs once the detection has settled.
  const enabled = supported || extension.state === 'missing';
  const query = useQuery({
    queryKey: ytAuthQueryKey,
    queryFn: () => readAuth(false),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  useEffect(() => {
    if (!present || !supported) return;
    return present.bridge.subscribe((event) => {
      if (event.event === 'yt.authState') adopt(event.data);
    });
  }, [present, supported]);

  if (extension.state === 'checking' || (enabled && query.isPending)) return { state: 'checking' };
  // An extension that can't do auth, on a browser that could install one: the
  // Extension page explains the upgrade. Pure web always has a state to report.
  if (!supported && extension.state === 'present') return { state: 'unavailable' };
  return { state: 'ready', auth: query.data ?? SIGNED_OUT };
}

/** Switches the channel requests act as. */
export function useSelectChannel() {
  return useMutation({
    mutationFn: async (channelId: string) => {
      const extension = detected();
      if (!extension) throw new Error('The extension is not installed');
      return extension.bridge.call('yt.selectChannel', { channelId });
    },
    onSuccess: adopt,
  });
}

/** Re-reads the accounts from YouTube rather than the extension's cache. */
export function useRefreshYtAuth() {
  return useMutation({ mutationFn: () => readAuth(true) });
}

/** Connect or disconnect BitChord from the browser's YouTube session (it stays signed in to Google). */
export function useSetConnected() {
  return useMutation({
    mutationFn: async (connected: boolean) => {
      const extension = detected();
      if (!extension) throw new Error('The extension is not installed');
      return extension.bridge.call('yt.setConnected', { connected });
    },
    onSuccess: adopt,
  });
}
