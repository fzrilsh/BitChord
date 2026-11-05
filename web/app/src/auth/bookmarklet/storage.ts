import { openDB, type IDBPDatabase } from 'idb';
import type { CapturedSession } from './types';

/**
 * The captured session, encrypted before it is stored.
 *
 * The cookie jar is a Google login: anything that can read it can act as the
 * user. It is encrypted with AES-GCM under a non-extractable key kept in the
 * same IndexedDB — so a copy of the database alone (an extension, a backup, a
 * stray sync) is not a usable session, and the key can never be exported by
 * script. It does not defend against code running on this origin; nothing in a
 * browser can.
 */

const DB_NAME = 'bitchord:session';
const DB_VERSION = 1;
const STORE = 'session';
const RECORD_KEY = 'yt';
const KEY_KEY = 'yt-key';

interface StoredRecord {
  /** The GCM nonce; typed to the ArrayBuffer Web Crypto takes, not a shared buffer. */
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
  capturedAt: number;
}

let db: Promise<IDBPDatabase> | null = null;

function database(): Promise<IDBPDatabase> {
  db ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    },
  });
  return db;
}

async function encryptionKey(): Promise<CryptoKey> {
  const handle = await database();
  const existing = (await handle.get(STORE, KEY_KEY)) as CryptoKey | undefined;
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await handle.put(STORE, key, KEY_KEY);
  return key;
}

export async function saveSession(session: CapturedSession): Promise<void> {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const plaintext = new TextEncoder().encode(JSON.stringify(session));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const record: StoredRecord = { iv, data, capturedAt: session.capturedAt };
  await (await database()).put(STORE, record, RECORD_KEY);
}

export async function loadSession(): Promise<CapturedSession | null> {
  try {
    const handle = await database();
    const record = (await handle.get(STORE, RECORD_KEY)) as StoredRecord | undefined;
    if (!record) return null;
    const key = await encryptionKey();
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, key, record.data);
    return JSON.parse(new TextDecoder().decode(plaintext)) as CapturedSession;
  } catch {
    // A key that no longer matches (storage cleared halfway, a schema change)
    // reads as "no session", and the sign-in page offers a fresh capture.
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await (await database()).delete(STORE, RECORD_KEY);
}

/**
 * The session as one opaque string, for carrying it to a different browsing
 * context.
 *
 * iOS keeps Safari and an installed home-screen app in separate storage, so a
 * capture made in one is invisible to the other. The system clipboard is the
 * one channel they share, and this is what travels over it.
 *
 * The string holds the cookie jar in the clear: it is only ever on the user's
 * own clipboard, and the destination encrypts it on arrival. Treat it as the
 * password it is.
 */
export function encodeSession(session: CapturedSession): string {
  const bytes = new TextEncoder().encode(JSON.stringify(session));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `bitchord-session:${btoa(binary)}`;
}

/** Reads a string from {@link encodeSession}; null for anything else. */
export function decodeSession(text: string): CapturedSession | null {
  const prefix = 'bitchord-session:';
  const trimmed = text.trim();
  if (!trimmed.startsWith(prefix)) return null;
  try {
    const binary = atob(trimmed.slice(prefix.length));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CapturedSession>;
    if (typeof parsed.cookie !== 'string' || parsed.loggedIn !== true) return null;
    return {
      cookie: parsed.cookie,
      pageId: parsed.pageId ?? null,
      dataSyncId: parsed.dataSyncId ?? null,
      authUser: parsed.authUser ?? null,
      visitorData: parsed.visitorData ?? null,
      clientVersion: parsed.clientVersion ?? null,
      loggedIn: true,
      capturedAt: typeof parsed.capturedAt === 'number' ? parsed.capturedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

/** Whether the captured session is older than [days]; Google rotates session cookies. */
export function isStale(session: CapturedSession, days = 30): boolean {
  return Date.now() - session.capturedAt > days * 24 * 60 * 60_000;
}
