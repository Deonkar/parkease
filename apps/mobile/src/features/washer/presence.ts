import { WASH_ONLINE_HEARTBEAT_WINDOW_SECONDS } from '@parkease/contracts/washer';

import { warn } from '@/lib/log';

/**
 * What "online" means for a washer, as orchestration with the GPS and the
 * network injected — the `submitProof` pattern — so fake timers can test it.
 *
 * Two server facts force the shape. `setWasherAvailabilitySchema` refuses
 * `isOnline: true` without a location, and the dispatch candidate query drops
 * any washer whose `last_seen_at` is older than
 * `WASH_ONLINE_HEARTBEAT_WINDOW_SECONDS`. So going online is a fix plus a
 * PATCH, and staying online is the same PATCH with a fresh fix, repeated.
 *
 * No `react-native` and no `expo-location` here, so the node test environment
 * reaches every branch. `useWasherPresence` wires the real dependencies.
 */

/**
 * Half the server's window, so two beats land inside every window and one lost
 * beat is survivable. Derived from the contract constant: if the server ever
 * shortens its window, this follows on the same day.
 */
export const HEARTBEAT_INTERVAL_MS = (WASH_ONLINE_HEARTBEAT_WINDOW_SECONDS * 1000) / 2;

export interface Fix {
  readonly lat: number;
  readonly lng: number;
}

export type LocateOutcome =
  | { readonly ok: true; readonly fix: Fix }
  | { readonly ok: false; readonly reason: 'permission_denied' };

export type BeatResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'permission_denied' | 'location_failed' }
  /** `cause` is the rejected PATCH, so a caller can tell a 403 from a dead network. */
  | { readonly ok: false; readonly reason: 'unreachable'; readonly cause: unknown };

export interface PresenceDeps {
  /** A fresh foreground fix. Never prompts — asking is the caller's job, once. */
  locate(): Promise<LocateOutcome>;
  send(isOnline: boolean, fix?: Fix): Promise<void>;
  /** Every heartbeat after the first, so the screen can say "Reconnecting…". */
  onBeat(result: BeatResult): void;
}

export interface PresenceHandle {
  /** Stops beating, then tells the server. Offline is always the last PATCH. */
  stop(): Promise<BeatResult>;
  /**
   * Stops beating WITHOUT telling the server — for teardown, where the session
   * may already be gone. The server drops the washer once the window lapses.
   */
  halt(): void;
}

export type StartResult =
  | { readonly ok: true; readonly handle: PresenceHandle }
  | Exclude<BeatResult, { readonly ok: true }>;

/**
 * One beat: a fresh fix, then the PATCH. Every failure is logged here and
 * returned typed, never thrown — a heartbeat that could reject would need a
 * catch at every call site, and the one that was forgotten would be silent.
 */
async function beat(deps: PresenceDeps, isStopped: () => boolean): Promise<BeatResult> {
  let located: LocateOutcome;
  try {
    located = await deps.locate();
  } catch (error) {
    warn('washer.presence: no location fix for the heartbeat', error);
    return { ok: false, reason: 'location_failed' };
  }

  if (!located.ok) {
    warn('washer.presence: location permission is not granted');
    return located;
  }

  // Stopped while the GPS was answering: a late `isOnline: true` must never
  // land after the offline PATCH, or it puts the partner back in the pool.
  if (isStopped()) return { ok: true };

  try {
    await deps.send(true, located.fix);
    return { ok: true };
  } catch (error) {
    warn('washer.presence: availability PATCH did not land', error);
    return { ok: false, reason: 'unreachable', cause: error };
  }
}

/**
 * Goes online, then keeps the washer online until stopped.
 *
 * The first beat IS the going-online PATCH, and it must land before any
 * heartbeat is scheduled: the switch only reads "online" once the server has
 * agreed. After that a failed beat is reported and superseded by the next one,
 * never retried — each beat is a new fact about where the partner is.
 *
 * Beats are chained with `setTimeout` after each one settles, not
 * `setInterval`, so a slow GPS can never stack two beats on top of each other.
 *
 * ponytail: FOREGROUND ONLY. JS timers stop when Android backgrounds the app,
 * so a washer who switches apps stops beating and falls out of dispatch after
 * `WASH_ONLINE_HEARTBEAT_WINDOW_SECONDS` (90s) while their switch still reads
 * online. The upgrade path is an `expo-task-manager` background location task,
 * as valet's `useBackgroundLocation` does; `startPresence`'s contract stays.
 */
export async function startPresence(deps: PresenceDeps): Promise<StartResult> {
  let stopped = false;
  const isStopped = () => stopped;

  const first = await beat(deps, isStopped);
  if (!first.ok) return first;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;

  const schedule = () => {
    timer = setTimeout(() => {
      timer = null;
      inFlight = beat(deps, isStopped).then((result) => {
        inFlight = null;
        if (stopped) return;
        deps.onBeat(result);
        schedule();
      });
    }, HEARTBEAT_INTERVAL_MS);
  };

  const halt = () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  schedule();

  return {
    ok: true,
    handle: {
      halt,
      stop: async () => {
        halt();
        // Wait out a beat already in flight so its PATCH cannot overtake ours.
        if (inFlight !== null) await inFlight;
        try {
          await deps.send(false);
          return { ok: true };
        } catch (error) {
          warn('washer.presence: could not tell the server we went offline', error);
          return { ok: false, reason: 'unreachable', cause: error };
        }
      },
    },
  };
}
