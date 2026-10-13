import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { type Query, onlineManager } from '@tanstack/react-query';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import { useSyncExternalStore } from 'react';

/**
 * Offline handling (§21.6, S-150), built on TanStack Query's own machinery rather than beside it:
 *
 * - **Online state.** NetInfo drives `onlineManager`, so every query pauses instead of failing
 *   while the phone has no network, and refetches on reconnect. The banner reads the same state.
 * - **Persisted cache.** The screens a person opens with no signal (their bookings, earnings,
 *   notifications) are written to storage and drawn from it on a cold start offline. Under the
 *   session prefix, so sign-out clears it with everything else the signed-in user left.
 * - **Queued intents.** A mutation sent offline pauses (`networkMode: 'online'`) and replays on
 *   reconnect, in the order it was made (one scope), carrying the Idempotency-Key minted when
 *   the person acted (R-FE-05) — so a replay the server already applied answers its stored
 *   result rather than acting twice. A replay that fails reaches the screen's own error handler.
 */

/** A connection counts once the OS says it is up and has not found it unable to reach out. */
export const isOnlineState = (state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>) =>
  state.isConnected !== false && state.isInternetReachable !== false;

let connected = false;

/** Feeds NetInfo into TanStack once, at startup. */
export function connectOnlineManager(): void {
  if (connected) return;
  connected = true;
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(isOnlineState(state));
    }),
  );
}

/** Whether the app believes it is online; re-renders on change. */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
    () => true,
  );
}

/** The query families drawn from storage when there is no network. */
const PERSISTED: readonly (readonly string[])[] = [
  ['driver', 'bookings'],
  ['notifications', 'feed'],
  ['owner', 'dashboard'],
  ['owner', 'earnings'],
  ['valet', 'earnings'],
  ['washer', 'earnings'],
];

export function shouldPersistQuery(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  if (query.state.status !== 'success') return false;
  return PERSISTED.some((prefix) => prefix.every((part, i) => query.queryKey[i] === part));
}

/** Older than a day, a saved screen is more misleading than an empty one. */
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const QUERY_CACHE_STORAGE_KEY = 'parkease.query-cache';

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: createAsyncStoragePersister({
    storage: AsyncStorage,
    key: QUERY_CACHE_STORAGE_KEY,
    throttleTime: 2_000,
  }),
  maxAge: PERSIST_MAX_AGE_MS,
  dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
};
