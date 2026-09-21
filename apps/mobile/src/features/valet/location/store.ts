import AsyncStorage from '@react-native-async-storage/async-storage';

import { postFix } from '../api/valet';

import { createLocationQueue, type FixStore } from './queue';

/**
 * The app-wide location queue, bound to real storage and the real transport.
 *
 * AsyncStorage rather than `expo-secure-store`: R-FE-10 bans AsyncStorage **for
 * tokens**, and a buffer of perishable coordinates is not a secret. It also has
 * to be writable from the headless OS callback, which secure-store is not built
 * for.
 */
const asyncStorageFixStore: FixStore = {
  read: async () => AsyncStorage.getItem(FIX_QUEUE_KEY),
  write: async (value) => AsyncStorage.setItem(FIX_QUEUE_KEY, value),
};

const FIX_QUEUE_KEY = 'parkease.valet.fixQueue';
const FIX_FAILURE_KEY = 'parkease.valet.fixFailure';
const LAST_FIX_AT_KEY = 'parkease.valet.lastFixAt';

export const valetLocationQueue = createLocationQueue({
  store: asyncStorageFixStore,
  send: postFix,
});

/**
 * When the last position actually arrived from the OS.
 *
 * Survives the queue: a fix that has been drained is gone from the buffer, but
 * the banner still has to say how old the newest one is. Stored as the fix's
 * OWN timestamp, never `Date.now()` at write time — a fix that sat in the queue
 * for two minutes is two minutes old, and saying otherwise is the lie §12.5
 * exists to prevent.
 */
export async function recordLastFixAt(recordedAt: number): Promise<void> {
  await AsyncStorage.setItem(LAST_FIX_AT_KEY, String(recordedAt));
}

export async function readLastFixAt(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(LAST_FIX_AT_KEY);
  if (raw === null) return null;
  // R-VAL-01: a cached value is outside data. A junk key means "no fix yet",
  // never a NaN that renders as "NaN min ago".
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function clearLastFixAt(): Promise<void> {
  await AsyncStorage.removeItem(LAST_FIX_AT_KEY);
}

/**
 * Record that the OS could not give us a position.
 *
 * Written down rather than logged and forgotten, because the UI reads it to say
 * *why* the feed died. A revoked permission and a lost satellite fix look
 * identical on screen otherwise, and they need different instructions.
 */
export async function recordFixFailure(message: string): Promise<void> {
  await AsyncStorage.setItem(FIX_FAILURE_KEY, JSON.stringify({ message, at: Date.now() }));
}

export async function readFixFailure(): Promise<{ message: string; at: number } | null> {
  const raw = await AsyncStorage.getItem(FIX_FAILURE_KEY);
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { message?: unknown }).message === 'string' &&
      typeof (parsed as { at?: unknown }).at === 'number'
    ) {
      return parsed as { message: string; at: number };
    }
    return null;
  } catch {
    // R-VAL-01: a cached value is outside data. A corrupt blob means "no
    // recorded failure", never a crash in a headless context.
    return null;
  }
}

export async function clearFixFailure(): Promise<void> {
  await AsyncStorage.removeItem(FIX_FAILURE_KEY);
}
