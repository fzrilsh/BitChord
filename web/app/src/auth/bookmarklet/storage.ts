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

/** Whether the captured session is older than [days]; Google rotates session cookies. */
export function isStale(session: CapturedSession, days = 30): boolean {
  return Date.now() - session.capturedAt > days * 24 * 60 * 60_000;
}
