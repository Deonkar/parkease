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
 * Half the server's window, measured from each beat's START (not from when the
 * last one settled), so two beats start inside every window and a single lost
 * beat leaves the next one landing at the window's edge instead of a whole
 * interval past it. Derived from the contract constant: if the server ever
 * shortens its window, this follows on the same day.
 */
export const HEARTBEAT_INTERVAL_MS = (WASH_ONLINE_HEARTBEAT_WINDOW_SECONDS * 1000) / 2;

/**
 * How long a beat waits for the GPS. A third of the interval, so the fix and
 * the PATCH that follows it (bounded by the API client's own timeout) both fit
 * inside one interval. Without a bound, a GPS that never answers — a basement
 * car park, which is where washers work — stops the heartbeat in silence while
 * the rail still reads online.
 */
export const LOCATE_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS / 3;

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

type BeatFailure = Exclude<BeatResult, { readonly ok: true }>;

/**
 * Why presence is not working, in words a screen can act on. `unreachable` is
 * split into the server's own refusals by `useWasherPresence`, which can read
 * the HTTP error; this module cannot.
 */
export type PresenceError =
  | 'permission_denied'
  | 'location_failed'
  | 'not_verified'
  | 'not_registered'
  | 'unreachable';

export interface PresenceDeps {
  /** A fresh foreground fix. Never prompts — asking is the caller's job, once. */
  locate(): Promise<LocateOutcome>;
  send(isOnline: boolean, fix?: Fix): Promise<void>;
  /** Every heartbeat after the first, so the screen can say what is wrong. */
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

export type StartResult = { readonly ok: true; readonly handle: PresenceHandle } | BeatFailure;

/**
 * A fix, or a typed reason there is none — within `LOCATE_TIMEOUT_MS`. Never
 * rejects: a heartbeat that could reject would need a catch at every call
 * site, and the one that was forgotten would be silent.
 */
async function locateWithin(deps: PresenceDeps): Promise<LocateOutcome | BeatFailure> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timed_out'>((resolve) => {
    timer = setTimeout(() => {
      resolve('timed_out');
    }, LOCATE_TIMEOUT_MS);
  });

  try {
    const located = await Promise.race([deps.locate(), timedOut]);
    if (located === 'timed_out') {
      warn('washer.presence: the GPS did not answer in time');
      return { ok: false, reason: 'location_failed' };
    }
    if (!located.ok) warn('washer.presence: location permission is not granted');
    return located;
  } catch (error) {
    warn('washer.presence: no location fix for the heartbeat', error);
    return { ok: false, reason: 'location_failed' };
  } finally {
    clearTimeout(timer);
  }
}

/** The online PATCH. Never rejects, for the same reason as `locateWithin`. */
async function sendOnline(deps: PresenceDeps, fix: Fix): Promise<BeatResult> {
  try {
    await deps.send(true, fix);
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
 * Each beat is scheduled only after the previous one settles, so two can never
 * overlap; the delay subtracts the time the previous one took, so a slow beat
 * does not push the next one back.
 *
 * ponytail: FOREGROUND ONLY. JS timers stop when Android backgrounds the app,
 * so a washer who switches apps stops beating and falls out of dispatch after
 * `WASH_ONLINE_HEARTBEAT_WINDOW_SECONDS` (90s) while their switch still reads
 * online. The upgrade path is an `expo-task-manager` background location task,
 * as valet's `useBackgroundLocation` does; `startPresence`'s contract stays.
 */
export async function startPresence(deps: PresenceDeps): Promise<StartResult> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** An online PATCH that is on the wire right now. */
  let landing: Promise<BeatResult> | null = null;

  const runBeat = async (): Promise<BeatResult> => {
    const located = await locateWithin(deps);
    if (!located.ok) return located;

    // Stopped while the GPS was answering: a late `isOnline: true` must never
    // follow the offline PATCH, or it puts the partner back in the pool.
    if (stopped) return { ok: true };

    landing = sendOnline(deps, located.fix);
    const result = await landing;
    landing = null;
    return result;
  };

  const schedule = (lastStartedAt: number) => {
    const delay = Math.max(0, HEARTBEAT_INTERVAL_MS - (Date.now() - lastStartedAt));
    timer = setTimeout(() => {
      timer = null;
      const startedAt = Date.now();
      void runBeat().then((result) => {
        if (stopped) return;
        deps.onBeat(result);
        schedule(startedAt);
      });
    }, delay);
  };

  const halt = () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const firstStartedAt = Date.now();
  const first = await runBeat();
  if (!first.ok) return first;
  schedule(firstStartedAt);

  return {
    ok: true,
    handle: {
      halt,
      stop: async () => {
        halt();
        // An online PATCH already on the wire must land before the offline
        // one is sent, or the two race and `true` can arrive second. A beat
        // still waiting on the GPS is not waited for: it sees `stopped` and
        // never sends, so a dead GPS cannot hold the partner online.
        if (landing !== null) await landing;
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
